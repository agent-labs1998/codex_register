# 任务书：HeroSMS 取号价格筛选优化

> 优先级：高 | 预计工作量：1 小时 | 审核人：CTO

---

## 一、问题背景

当前 HeroSMS 取号逻辑使用 `fixedPrice=false`，导致 API 返回低于预期价格的垃圾号码。

**当前配置：** `priceTiers = [0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08]`

**当前行为：**
```
调用 getNumberV2(maxPrice=0.05, fixedPrice=false)
→ API 返回 cost=0.03 的号码（垃圾号，成功率极低）
→ 浪费钱，验证码也收不到
```

**目标行为：**
```
1. 先调 getPrices 查所有国家的价格和库存
2. 筛选出价格在 [最低价, 最高价] 区间内 且 库存 >= 最低库存 的国家
3. 按价格从低到高排序
4. 用 fixedPrice=true 精确取号
5. 没号了？重新查价格，找下一个符合条件的国家
```

---

## 二、HeroSMS API 说明

### getPrices API
```
GET https://hero-sms.com/stubs/handler_api.php?api_key={KEY}&action=getPrices&service=dr
```

返回格式（实测数据）：
```json
{
  "16": { "dr": { "cost": 0.03, "count": 149746 } },
  "33": { "dr": { "cost": 0.05, "count": 3144 } },
  "73": { "dr": { "cost": 0.045, "count": 1358078 } },
  "50": { "dr": { "cost": 0.075, "count": 65188 } }
}
```

- key 是国家 ID
- `cost`：该国家号码的单价
- `count`：可用号码库存

### getNumberV2 API（现有）
```
GET ?action=getNumberV2&service=dr&country={ID}&maxPrice={PRICE}&fixedPrice=true
```

- `fixedPrice=true` 时，只返回恰好等于 `maxPrice` 价格的号码
- `fixedPrice=false` 时，返回 `<= maxPrice` 的所有号码（包含垃圾号）

---

## 三、需要阅读的代码文件

| 文件 | 看什么 |
|------|--------|
| `src/sms/index.ts` | **核心文件** — 当前的阶梯取号逻辑（createSMSBroker），需要重写 requestActivation |
| `src/sms/heroSMS.ts` | HeroSMS API 封装，了解 requestPhoneNumber、现有的 API 调用方式 |
| `src/sms/activation-broker.ts` | ActivationBroker 类，了解 getActivation 流程 |
| `src/config.ts` | 配置定义，了解 heroSMS 相关配置项 |
| `config.json` | 当前配置值（heroSMSCountry、heroSMSCountries、heroSMSPriceTiers 等） |

---

## 四、具体改动要求

### 4.1 config.ts — 新增配置项

在 `AppConfigFile` 接口、`AppConfig` 接口、`DEFAULT_CONFIG` 中新增：

```typescript
heroSMSMinStock: number;    // 最低库存阈值，低于此数量的国家跳过
heroSMSMaxPrice: number;    // 最高价（已有 heroSMSMaxPrice，复用）
```

- `heroSMSMinStock` 默认值：`1000`
- 价格区间的最低价由 `priceTiers` 数组的第一个值决定
- 价格区间的最高价由 `priceTiers` 数组的最后一个值决定

config.json 中添加：
```json
"heroSMSMinStock": 1000
```

### 4.2 heroSMS.ts — 新增 getPrices 方法

在 `createHeroSmsProvider` 返回的对象中新增 `getPrices` 方法：

```typescript
async getPrices(service: string = "dr"): Promise<Map<number, { cost: number; count: number }>>
```

实现：
1. 调用 `requestHeroSmsApi(config, "getPrices", { service })`
2. 解析返回的 JSON（key 是国家 ID，value 包含 cost 和 count）
3. 返回 `Map<countryId, { cost, count }>`

参考现有的 `requestHeroSmsApi` 调用方式（约第 745 行）。

### 4.3 index.ts — 重写 createSMSBroker（核心改动）

**新逻辑：**

```typescript
export const createSMSBroker = (option: HeroSMSBrokerOption) => {
  const minPrice = tiers[0];                    // priceTiers 第一个值 = 最低价
  const maxPrice = tiers[tiers.length - 1];     // priceTiers 最后一个值 = 最高价
  const minStock = option.minStock ?? 1000;     // 最低库存阈值

  // 每次取号前：查价格 → 筛选 → 排序 → 精确取号
  async function requestActivation(): Promise<HeroSmsActivation> {
    // 第一步：查价格
    const prices = await heroProvider.getPrices("dr");
    
    // 第二步：筛选
    const candidates: Array<{ country: number; cost: number; count: number }> = [];
    for (const [countryId, info] of prices) {
      if (info.cost >= minPrice && info.cost <= maxPrice && info.count >= minStock) {
        candidates.push({ country: countryId, cost: info.cost, count: info.count });
      }
    }
    
    if (candidates.length === 0) {
      throw new Error(`HeroSMS 无可用国家 (区间 ${minPrice}-${maxPrice}, 最低库存 ${minStock})`);
    }
    
    // 第三步：按价格升序排序
    candidates.sort((a, b) => a.cost - b.cost);
    
    console.log(`[heroSMS] 可用国家: ${candidates.map(c => `${c.country}($${c.cost}, ${c.count}个)`).join(', ')}`);
    
    // 第四步：逐个尝试 fixedPrice=true 取号
    let lastErr: unknown = null;
    for (const candidate of candidates) {
      try {
        console.log(`[heroSMS] 尝试取号 country=${candidate.country} fixedPrice=$${candidate.cost}`);
        const activation = await heroProvider.requestPhoneNumber({
          service: "dr",
          country: candidate.country,
          maxPrice: candidate.cost,
          fixedPrice: true,    // 精确价格，不拿垃圾号
        });
        console.log(`[heroSMS] 取号成功 country=${candidate.country} phone=+${activation.phoneNumber} cost=${activation.activationCost ?? candidate.cost}`);
        return activation;
      } catch (err) {
        lastErr = err;
        const msg = String((err as Error)?.message ?? err);
        console.warn(`[heroSMS] country=${candidate.country} 失败: ${msg.slice(0, 80)}`);
        // 这个国家没号了，试下一个
        continue;
      }
    }
    
    // 所有国家都失败，重新查价格（可能价格变动了）
    throw lastErr ?? new Error(`HeroSMS 所有国家取号失败`);
  }
  
  // ... 返回 ActivationBroker
};
```

### 4.4 index.ts — 更新 HeroSMSBrokerOption 类型

新增可选字段：
```typescript
minStock?: number;  // 最低库存阈值
```

### 4.5 更新所有 createSMSBroker 调用点

在以下位置传入 `minStock` 配置：
- `src/index.ts` 中的 `createSMSBroker` 调用（约第 55-64 行和第 929-938 行）
- `src/worker-scheduler.ts` 中的调用（约第 51-60 行）
- `src/concurrent-registration.ts` 中的调用（约第 58-67 行）

添加：`minStock: appConfig.heroSMSMinStock`

---

## 五、缓存策略

getPrices 查询结果应**缓存**，避免每次取号都查一次 API：
- 缓存时长：**60 秒**
- 取号失败（所有国家都没号）时，**清空缓存**重新查
- 缓存变量放在 `createSMSBroker` 闭包内

```typescript
let cachedPrices: Map<number, { cost: number; count: number }> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

async function getPricesWithCache(): Promise<Map<number, { cost: number; count: number }>> {
  const now = Date.now();
  if (cachedPrices && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedPrices;
  }
  cachedPrices = await heroProvider.getPrices("dr");
  cacheTimestamp = now;
  return cachedPrices;
}

function invalidatePriceCache() {
  cachedPrices = null;
  cacheTimestamp = 0;
}
```

---

## 六、验收标准

1. `npm run build` 构建成功
2. 日志中出现 `[heroSMS] 可用国家: 33($0.05, 3144个), 50($0.075, 65188个)` — 显示筛选结果
3. 取到的号码 cost 精确等于 `fixedPrice` 设定值（不会出现 0.03 的垃圾号）
4. `heroSMSMinStock=1000` 配置生效（低于 1000 库存的国家被跳过）
5. 缓存生效（连续取号时不会每次都调 getPrices）

---

## 七、真实 API 参考数据

以下是实测的 `getPrices?service=dr` 返回（2026-06-20）：

| Country | 国家 | cost | count |
|---------|------|------|-------|
| 16 | 英格兰 | 0.03 | 149746 |
| 33 | 哥伦比亚 | 0.05 | 3144 |
| 73 | 巴西 | 0.045 | 1358078 |
| 31 | 南非 | 0.05 | 3030 |
| 50 | 奥地利 | 0.075 | 65188 |
| 48 | 荷兰 | 0.075 | 3304 |
| 37 | 摩洛哥 | 0.075 | 2245 |

以配置 `priceTiers=[0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08]` 和 `minStock=1000` 为例：
- 筛选结果：哥伦比亚(0.05)、南非(0.05)、奥地利(0.075)、荷兰(0.075)
- 英格兰(0.03) 被过滤（低于最低价 0.05）
- 巴西(0.045) 被过滤（低于最低价 0.05）
- 摩洛哥(0.075) 被过滤（库存 2245 < 不对，2245 >= 1000，会入选）

---

## 八、注意事项

1. **不要删除现有的 priceTiers 配置** — 它的首尾值分别作为最低价和最高价
2. **countries 配置可以保留** — 但新逻辑不再依赖它来遍历，而是通过 getPrices 自动发现
3. **缓存很重要** — HeroSMS API 有频率限制，不能每次取号都查
4. **fixedPrice=true 是关键** — 确保拿到的号码价格精确等于 API 报价
5. **只改 src/sms/index.ts 和 src/config.ts** — heroSMS.ts 只需新增一个 getPrices 方法

---

## 九、报告要求

完成后将报告写到 `A:\Github\codex_register\任务\任务报告\HeroSMS价格筛选优化报告.md`，包含：
- 改动了哪些文件的哪些行
- 构建结果
- 测试：实际调用一次 getPrices 看筛选结果
- 测试：实际取号看 cost 是否精确
