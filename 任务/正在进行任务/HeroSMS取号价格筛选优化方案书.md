# 方案书：HeroSMS 取号价格区间筛选 + fixedPrice 精确锁定

> 优先级：高 | 预计工作量：1 小时 | 审核人：CTO

---

## 一、问题背景

### 1.1 当前行为

HeroSMS API 的 `getNumberV2` 只支持 `maxPrice`（最高价），不支持 `minPrice`（最低价）。

设 `priceTiers=[0.05, 0.055, 0.06, ...]`，调用 `getNumberV2(maxPrice=0.05, fixedPrice=false)` 时，API 可能返回一个 **$0.03** 的号码 — 因为 $0.03 ≤ $0.05，满足 "最高价" 限制。

### 1.2 问题影响

- 低价号码（如 $0.03）通常是垃圾号 — 别人用剩下的、平台还没下架的
- 库存低于 1000 的国家同理，号码质量差
- 当前配置只用了巴西（country=73, cost=$0.045），价格低于最低 tier 0.045，永远拿不到 0.05 档位的号码

### 1.3 真实 API 数据（2026-06-20 实测）

`getPrices?service=dr` 返回示例：

```json
{
  "33": { "dr": { "cost": 0.05, "count": 3144, "physicalCount": 2012 } },
  "16": { "dr": { "cost": 0.03, "count": 149552, "physicalCount": 1611 } },
  "73": { "dr": { "cost": 0.045, "count": 876030, "physicalCount": 6731 } }
}
```

用 `minPrice=0.05, maxPrice=0.08, minStock=1000` 筛选后：

| Country | 国家 | cost | count | physical |
|---------|------|------|-------|----------|
| 33 | 哥伦比亚 | 0.05 | 3,144 | 2,012 |
| 31 | 南非 | 0.05 | 3,030 | 2,911 |
| 2 | 哈萨克斯坦 | 0.05 | 1,596 | 550 |
| 41 | 喀麦隆 | 0.05 | 1,649 | 991 |
| 50 | 奥地利 | 0.075 | 65,188 | 8,539 |
| 48 | 荷兰 | 0.075 | 3,304 | 1,063 |
| 37 | 摩洛哥 | 0.075 | 2,245 | 1,520 |

共 7 个国家合格，自动覆盖多国 — 不再需要手动维护 `heroSMSCountries`。

---

## 二、技术分析

### 2.1 关键 API 参数：`fixedPrice`

| 参数组合 | 行为 |
|---------|------|
| `maxPrice=0.05, fixedPrice=false`（当前） | API 返回 ≤ $0.05 的任意号码（可能 $0.03） |
| `maxPrice=0.05, fixedPrice=true`（新方案） | API **只返回恰好 $0.05 的号码** |

`fixedPrice=true` 配合 `getPrices` 查询到的精确价格，等效实现了 `minPrice`。

### 2.2 当前代码架构

```
config.json
    ↓
createSMSBroker()              ← src/sms/index.ts（价格阶梯 × 多国矩阵遍历）
    ↓
wrappedProvider.requestActivation()   ← 遍历 (tier, country) 组合
    ↓
heroProvider.requestPhoneNumber()     ← src/sms/heroSMS.ts
    ↓
GET hero-sms.com/...?action=getNumberV2&service=dr&country=X&maxPrice=Y&fixedPrice=false
    ↓
ActivationBroker               ← src/sms/activation-broker.ts（租赁生命周期管理）
```

三层架构：
1. **`SmsProvider`**（provider.ts）— 基础接口，6 个方法
2. **`HeroSmsProvider`**（heroSMS.ts）— HeroSMS API 实现 + 验证码轮询
3. **`ActivationBroker`**（activation-broker.ts）— 租赁管理、号码复用（3 次成功/3 次失败后轮换）、统计
4. **`createSMSBroker()`**（index.ts）— 价格阶梯 + 多国遍历策略，包装成 `ActivationBroker`

### 2.3 相关文件清单

| 文件 | 当前职责 | 是否改动 |
|------|----------|----------|
| `src/sms/heroSMS.ts` | HeroSMS API 客户端 | **新增** `getPrices()` 方法 |
| `src/sms/index.ts` | 价格阶梯 + 多国遍历 | **重写** 取号逻辑 |
| `src/sms/activation-broker.ts` | 租赁生命周期管理 | 不改动 |
| `src/sms/provider.ts` | 基础接口 | 不改动 |
| `src/config.ts` | 配置加载 | **新增** 2 个字段 |
| `config.json` | 运行配置 | **新增** 2 个值 |

---

## 三、具体改动方案

### 3.1 文件 1：`src/config.ts`

新增 2 个配置字段：

```typescript
// AppConfig 接口新增：
heroSMSMinPrice: number;    // 最低价（美元），低于此价的号码不取
heroSMSMinStock: number;    // 最低库存，低于此数的国家跳过（垃圾号）

// DEFAULT_CONFIG 新增：
heroSMSMinPrice: 0.05,
heroSMSMinStock: 1000,

// loadConfig 中新增解析：
heroSMSMinPrice:
  typeof parsed.heroSMSMinPrice === "number" && Number.isFinite(parsed.heroSMSMinPrice)
    ? parsed.heroSMSMinPrice
    : DEFAULT_CONFIG.heroSMSMinPrice,
heroSMSMinStock:
  typeof parsed.heroSMSMinStock === "number" && Number.isFinite(parsed.heroSMSMinStock)
    ? parsed.heroSMSMinStock
    : DEFAULT_CONFIG.heroSMSMinStock,
```

### 3.2 文件 2：`src/sms/heroSMS.ts`

#### 3.2.1 新增导出类型

```typescript
export interface HeroSmsCountryPrice {
  countryId: number;
  cost: number;
  count: number;
  physicalCount: number;
}
```

#### 3.2.2 `HeroSmsProvider` 接口新增方法

```typescript
export interface HeroSmsProvider extends SmsProvider<...> {
  // ... 原有方法 ...
  getPrices(service: string): Promise<HeroSmsCountryPrice[]>;
}
```

#### 3.2.3 `createHeroSmsProvider()` 新增实现

```typescript
async getPrices(service: string): Promise<HeroSmsCountryPrice[]> {
  const payload = await requestHeroSmsApi(config, "getPrices", { service });
  // API 返回格式：{ "33": { "dr": { "cost": 0.05, "count": 3144, "physicalCount": 2012 } } }
  const results: HeroSmsCountryPrice[] = [];
  for (const [countryId, services] of Object.entries(payload as Record<string, any>)) {
    const data = services?.[service];
    if (data && typeof data.cost === "number") {
      results.push({
        countryId: Number(countryId),
        cost: data.cost,
        count: data.count ?? 0,
        physicalCount: data.physicalCount ?? 0,
      });
    }
  }
  return results;
}
```

### 3.3 文件 3：`src/sms/index.ts`（核心改动）

#### 3.3.1 函数签名变更

```typescript
// 当前：
export const createSMSBroker = (option: HeroSMSBrokerOption) => { ... }

// 新增参数：
type HeroSMSBrokerOption = {
  // ... 原有字段 ...
  minPrice?: number;    // 新增：最低价
  minStock?: number;    // 新增：最低库存
}
```

#### 3.3.2 重写 `wrappedProvider.requestActivation()`

**当前逻辑**（盲试阶梯）：
```
for tier in [0.045, 0.056, 0.06, ...]:
  for country in [73]:
    getNumberV2(country, maxPrice=tier, fixedPrice=false)
    → 可能拿到 $0.03 的垃圾号
```

**新逻辑**（先查再取）：
```
1. 查缓存: getPricesCache 有效（< 60秒）？→ 用缓存
   无缓存？→ 调 heroProvider.getPrices("dr") → 缓存结果

2. 筛选:
   candidates = prices.filter(p =>
     p.cost >= minPrice &&
     p.cost <= maxPrice &&
     p.count >= minStock
   )

3. 排序: candidates.sort((a, b) => a.cost - b.cost || b.count - a.count)
   （价格升序，同价时库存大的优先）

4. 逐个尝试:
   for candidate in candidates:
     try:
       heroProvider.requestPhoneNumber({
         service: "dr",
         country: candidate.countryId,
         maxPrice: candidate.cost,      // 用 getPrices 返回的精确价格
         fixedPrice: true,              // 锁定价格！
       })
       → 成功 → 缓存 cursor → 返回
     catch NO_NUMBERS:
       清除缓存 → continue
     catch other:
       throw

5. 全部失败 → 清除缓存 → 重新查 getPrices → 再试一轮（最多 2 轮）

6. 仍失败 → 回退到原 priceTiers + countries 逻辑（fallback）
```

#### 3.3.3 缓存机制

```typescript
let pricesCache: HeroSmsCountryPrice[] | null = null;
let pricesCacheTime = 0;
const PRICES_CACHE_TTL_MS = 60_000; // 60秒

async function getCachedPrices(service: string, forceRefresh = false): Promise<HeroSmsCountryPrice[]> {
  if (!forceRefresh && pricesCache && (Date.now() - pricesCacheTime) < PRICES_CACHE_TTL_MS) {
    return pricesCache;
  }
  const prices = await heroProvider.getPrices(service);
  pricesCache = prices;
  pricesCacheTime = Date.now();
  return prices;
}

function invalidatePricesCache(): void {
  pricesCache = null;
  pricesCacheTime = 0;
}
```

#### 3.3.4 Fallback 机制

如果 `getPrices` 调用失败（网络错误、API 异常），自动回退到当前的 `priceTiers × countries` 矩阵遍历逻辑，确保不影响正常运行。

```
getPrices 失败？
  → log 警告
  → 走原有 priceTiers + countries 逻辑
  → fixedPrice=false（和当前行为一致）
```

### 3.4 文件 4：`config.json`

```diff
  "heroSMSMaxPrice": 0.08,
+ "heroSMSMinPrice": 0.05,
+ "heroSMSMinStock": 1000,
  "heroSMSPriceTiers": [0.045, 0.056, 0.06, 0.065, 0.07, 0.075, 0.08],
- "heroSMSCountries": [73],
+ "heroSMSCountries": [73],
```

`heroSMSPriceTiers` 和 `heroSMSCountries` 保留，作为 fallback 参数。

---

## 四、不动的部分

| 组件 | 原因 |
|------|------|
| `activation-broker.ts` | 租赁生命周期管理（复用、轮换、统计）完全不涉及价格逻辑 |
| `provider.ts` | 基础接口不需要变 |
| `heroSMS.ts` 的 `waitForVerificationCode` | 验证码轮询逻辑独立于取号逻辑 |
| `heroSMS.ts` 的 `requestPhoneNumber` | 底层 API 调用不变，只是调用参数变化 |
| 所有调用 `smsBroker.getActivation()` 的地方 | 上层调用方不感知内部逻辑变化 |

---

## 五、取号流程对比

### 改动前
```
config: priceTiers=[0.045,0.056,...] countries=[73]
                ↓
        ┌── tier=0.045, country=73(Brazil) ──→ getNumberV2(maxPrice=0.045, fixedPrice=false)
        │                                       → 拿到 $0.045 的号码（垃圾号区间）
        │   tier=0.056, country=73 ──→ getNumberV2(maxPrice=0.056, fixedPrice=false)
        │                               → 拿到 $0.045 的号码（仍然低于 0.056）
        └── ...
```

### 改动后
```
config: minPrice=0.05, maxPrice=0.08, minStock=1000
                ↓
        getPrices("dr") → 全量价格数据
                ↓
        筛选: 0.05 ≤ cost ≤ 0.08 且 count ≥ 1000
                ↓
        排序: [Colombia $0.05, S.Africa $0.05, Kazakhstan $0.05, ...]
                ↓
        ┌── country=33(Colombia), cost=0.05 ──→ getNumberV2(maxPrice=0.05, fixedPrice=true)
        │                                       → 锁定 $0.05，不可能拿到 $0.03
        │   成功 → 返回
        │   没号 → 尝试下一个国家
        └── country=31(S.Africa), cost=0.05 ──→ getNumberV2(maxPrice=0.05, fixedPrice=true)
                                                → ...
```

---

## 六、并发安全性

多个 worker 同时调用 `getActivation()` 时：

- **getPrices 缓存**：所有 worker 共享同一个缓存，60 秒内只查一次 API
- **取号冲突**：两个 worker 可能同时尝试同一个国家，一个成功一个拿到 `NO_NUMBERS` → 失败的自动尝试下一个国家
- **缓存刷新**：任何 `NO_NUMBERS` 错误都会清除缓存，下次调用重新查价格（因为某个国家库存可能已耗尽）

---

## 七、验收标准

1. `npm run build` 构建成功，无错误
2. 取号日志显示 `[heroSMS] getPrices 筛选: N 个国家合格` 而不是盲试阶梯
3. 取号日志显示 `fixedPrice=true` 和精确价格
4. 号码实际成本（`activationCost`）≥ `heroSMSMinPrice`（$0.05）
5. 库存 < 1000 的国家不出现在候选列表中
6. `getPrices` 失败时能自动 fallback 到 priceTiers 逻辑
7. 并发模式（`concurrency > 1`）正常运行

---

## 八、报告要求

完成后将报告写到 `A:\Github\codex_register\任务\任务报告\取号价格筛选优化报告.md`，包含：

- 改动了哪些文件的哪些行
- 改动前后的代码对比
- `getPrices` 真实 API 返回数据和筛选结果
- 构建结果
- getPrices 缓存策略说明
- Fallback 机制说明
- 是否有遗留问题

---

## 九、参考资源

| 资源 | 说明 |
|------|------|
| `A:\OpenAPi_Docs\hero-sms\SMS-Activate.md` | getPrices / getNumberV2 API 文档 |
| `A:\OpenAPi_Docs\hero-sms\INDEX.md` | HeroSMS API 总索引 |
| `src/sms/heroSMS.ts` | 当前 HeroSMS API 客户端实现 |
| `src/sms/index.ts` | 当前价格阶梯 + 多国遍历逻辑 |
| `src/sms/activation-broker.ts` | 租赁生命周期管理（不改动） |
| `src/config.ts` | 配置加载 |
| `config.json` | 运行配置 |
