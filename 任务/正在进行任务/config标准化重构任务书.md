# 任务书：config.json 标准化重构

> 优先级：高 | 预计工作量：30 分钟 | 审核人：CTO

---

## 零、你要做什么

**你的任务是写代码，不是分析。**

代码路径：`A:\Github\codex_register\`

将 config.json 中的入库后端配置从平铺式改为模块化结构。每个后端独立配置块，互不干扰，方便后续扩展。

完成后执行 `cd A:/Github/codex_register && npm run build` 验证构建。

---

## 一、当前问题

配置平铺，看不出哪个字段属于哪个后端：
```json
"cliproxyApiBaseUrl": "http://10.10.10.20:8317",
"cliproxyApiManagementKey": "123456@Aa",
"sub2apiBaseUrl": "http://10.10.10.20:8081",
"sub2apiEmail": "admin@sub2api.local",
"sub2apiPassword": "admin123456",
"sub2apiGroupIds": [14],
"tokenBackend": "cpa"
```

---

## 二、目标结构

```json
"tokenBackend": "cpa",

"cpa": {
  "baseUrl": "http://10.10.10.20:8317",
  "managementKey": "123456@Aa",
  "autoUploadAuth": true
},

"sub2api": {
  "baseUrl": "http://10.10.10.20:8081",
  "email": "admin@sub2api.local",
  "password": "admin123456",
  "groupIds": [14]
}
```

**注意：** `cliproxyApiAutoUploadAuth` 也要移到 `cpa` 块里。

---

## 三、参考代码（只看以下行号）

| 文件 | 只看这些行 | 参考什么 |
|------|-----------|--------|
| `src/config.ts` | 全文 | 配置定义和加载逻辑 |
| `src/cpa-registration.ts` | 第 80-90 行 | 读取 cpaBase、cpaKey 的位置 |
| `src/index.ts` | 第 85-90 行 | 经典模式读取 CPA 配置 |
| `src/cpa-codex.ts` | 全文 | CPA API 封装，使用 baseUrl 和 managementKey |

---

## 四、具体改动

### 4.1 修改 `src/config.ts`

**AppConfigFile 接口：** 删除平铺字段，改为嵌套对象

```typescript
// 删除这些：
cliproxyApiAutoUploadAuth?: unknown;
cliproxyApiBaseUrl?: unknown;
cliproxyApiManagementKey?: unknown;
sub2apiBaseUrl?: unknown;
sub2apiEmail?: unknown;
sub2apiPassword?: unknown;
sub2apiGroupIds?: unknown;

// 改为：
cpa?: {
    baseUrl?: unknown;
    managementKey?: unknown;
    autoUploadAuth?: unknown;
};
sub2api?: {
    baseUrl?: unknown;
    email?: unknown;
    password?: unknown;
    groupIds?: unknown;
};
```

**AppConfig 接口：** 同样改为嵌套

```typescript
// 删除平铺字段，改为：
cpa: {
    baseUrl: string;
    managementKey: string;
    autoUploadAuth: boolean;
};
sub2api: {
    baseUrl: string;
    email: string;
    password: string;
    groupIds: number[];
};
```

**DEFAULT_CONFIG：** 同样改

```typescript
cpa: {
    baseUrl: "",
    managementKey: "",
    autoUploadAuth: false,
},
sub2api: {
    baseUrl: "",
    email: "",
    password: "",
    groupIds: [14],
},
```

**loadConfig() 函数：** 解析嵌套对象

```typescript
cpa: {
    baseUrl: normalizeString(parsed.cpa?.baseUrl, DEFAULT_CONFIG.cpa.baseUrl),
    managementKey: normalizeString(parsed.cpa?.managementKey, DEFAULT_CONFIG.cpa.managementKey),
    autoUploadAuth: normalizeBoolean(parsed.cpa?.autoUploadAuth, DEFAULT_CONFIG.cpa.autoUploadAuth),
},
sub2api: {
    baseUrl: normalizeString(parsed.sub2api?.baseUrl, DEFAULT_CONFIG.sub2api.baseUrl),
    email: normalizeString(parsed.sub2api?.email, DEFAULT_CONFIG.sub2api.email),
    password: normalizeString(parsed.sub2api?.password, DEFAULT_CONFIG.sub2api.password),
    groupIds: normalizeNumberArray(parsed.sub2api?.groupIds, DEFAULT_CONFIG.sub2api.groupIds),
},
```

### 4.2 修改 `src/cpa-registration.ts`

所有 `appConfig.cliproxyApiBaseUrl` 改为 `appConfig.cpa.baseUrl`：
- 第 82 行：`const cpaBase = appConfig.cpa.baseUrl || "";`
- 第 83 行：`const cpaKey = appConfig.cpa.managementKey || "";`
- `appConfig.cliproxyApiAutoUploadAuth` → `appConfig.cpa.autoUploadAuth`

所有 `appConfig.sub2apiBaseUrl` 改为 `appConfig.sub2api.baseUrl`：
- `appConfig.sub2apiBaseUrl` → `appConfig.sub2api.baseUrl`
- `appConfig.sub2apiEmail` → `appConfig.sub2api.email`
- `appConfig.sub2apiPassword` → `appConfig.sub2api.password`
- `appConfig.sub2apiGroupIds` → `appConfig.sub2api.groupIds`

### 4.3 修改 `src/index.ts`

同样的替换：
- `appConfig.cliproxyApiBaseUrl` → `appConfig.cpa.baseUrl`
- `appConfig.cliproxyApiManagementKey` → `appConfig.cpa.managementKey`
- `appConfig.sub2apiBaseUrl` → `appConfig.sub2api.baseUrl`
- `appConfig.sub2apiEmail` → `appConfig.sub2api.email`
- `appConfig.sub2apiPassword` → `appConfig.sub2api.password`
- `appConfig.sub2apiGroupIds` → `appConfig.sub2api.groupIds`

**注意：** 经典模式中 `--cpa-base`、`--cpa-key` CLI 参数保留，作为运行时覆盖。config.json 提供默认值。

### 4.4 不修改的文件

- `src/cpa-codex.ts` — 不改（它接收参数，不直接读 config）
- `src/sub2api.ts` — 不改（同上）
- `src/openai.ts` — 不改

---

## 五、验收标准

1. `npm run build` 构建成功
2. 新格式 config.json 正确加载
3. `tokenBackend: "cpa"` 时，走 `cpa.baseUrl` 和 `cpa.managementKey`
4. `tokenBackend: "sub2api"` 时，走 `sub2api.baseUrl` 等
5. CLI 参数 `--cpa-base`、`--cpa-key` 仍然可用（优先级高于 config）
6. 不修改 cpa-codex.ts、sub2api.ts、openai.ts

---

## 六、报告要求

完成后将报告写到 `A:\Github\codex_register\任务\任务报告\config标准化重构报告.md`
