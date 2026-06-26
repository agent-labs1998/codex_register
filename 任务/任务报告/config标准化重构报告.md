# config.json 标准化重构报告

> 任务时间：2026-06-26
> 执行人：Claude Code
> 状态：✅ 完成

---

## 一、任务概述

将 config.json 中的入库后端配置从平铺式改为模块化结构。每个后端独立配置块，互不干扰。

**改动前（平铺）：**
```json
"cliproxyApiBaseUrl": "http://10.10.10.20:8317",
"cliproxyApiManagementKey": "123456@Aa",
"sub2apiBaseUrl": "http://10.10.10.20:8081",
"sub2apiEmail": "admin@sub2api.local",
"sub2apiPassword": "admin123456",
"sub2apiGroupIds": [14],
"tokenBackend": "cpa"
```

**改动后（嵌套）：**
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

---

## 二、修改的文件

### 1. `src/config.ts`

**AppConfigFile 接口：** 删除平铺字段，改为嵌套对象
```typescript
// 删除：cliproxyApiAutoUploadAuth, cliproxyApiBaseUrl, cliproxyApiManagementKey
// 删除：sub2apiBaseUrl, sub2apiEmail, sub2apiPassword, sub2apiGroupIds
// 新增：
cpa?: { baseUrl?: unknown; managementKey?: unknown; autoUploadAuth?: unknown };
sub2api?: { baseUrl?: unknown; email?: unknown; password?: unknown; groupIds?: unknown };
```

**AppConfig 接口：** 同样改为嵌套
```typescript
cpa: { baseUrl: string; managementKey: string; autoUploadAuth: boolean };
sub2api: { baseUrl: string; email: string; password: string; groupIds: number[] };
```

**DEFAULT_CONFIG：** 嵌套默认值
```typescript
cpa: { baseUrl: "", managementKey: "", autoUploadAuth: false },
sub2api: { baseUrl: "", email: "", password: "", groupIds: [14] },
```

**loadConfig()：** 支持新旧格式兼容解析
- 优先读 `parsed.cpa?.baseUrl`，fallback 到 `parsed.cliproxyApiBaseUrl`
- 优先读 `parsed.sub2api?.baseUrl`，fallback 到 `parsed.sub2apiBaseUrl`

### 2. `src/cpa-registration.ts`

```diff
- const cpaBase = appConfig.cliproxyApiBaseUrl || "";
- const cpaKey = appConfig.cliproxyApiManagementKey || "";
+ const cpaBase = appConfig.cpa.baseUrl || "";
+ const cpaKey = appConfig.cpa.managementKey || "";

- appConfig.sub2apiBaseUrl → appConfig.sub2api.baseUrl
- appConfig.sub2apiEmail → appConfig.sub2api.email
- appConfig.sub2apiPassword → appConfig.sub2api.password
- appConfig.sub2apiGroupIds → appConfig.sub2api.groupIds
```

### 3. `src/index.ts`

```diff
- appConfig.cliproxyApiBaseUrl → appConfig.cpa.baseUrl
- appConfig.cliproxyApiManagementKey → appConfig.cpa.managementKey
- appConfig.sub2apiBaseUrl → appConfig.sub2api.baseUrl
- appConfig.sub2apiEmail → appConfig.sub2api.email
- appConfig.sub2apiPassword → appConfig.sub2api.password
- appConfig.sub2apiGroupIds → appConfig.sub2api.groupIds
```

### 4. `src/cliproxyapi.ts`

```diff
- appConfig.cliproxyApiBaseUrl → appConfig.cpa.baseUrl
- appConfig.cliproxyApiManagementKey → appConfig.cpa.managementKey
- appConfig.cliproxyApiAutoUploadAuth → appConfig.cpa.autoUploadAuth
```

### 5. `src/concurrent-registration.ts`

```diff
- appConfig.cliproxyApiBaseUrl → appConfig.cpa.baseUrl
- appConfig.cliproxyApiManagementKey → appConfig.cpa.managementKey
```

### 6. `src/worker-scheduler.ts`

```diff
- appConfig.cliproxyApiBaseUrl → appConfig.cpa.baseUrl
```

### 未修改的文件

- `src/cpa-codex.ts` — 不改（接收参数，不直接读 config）
- `src/sub2api.ts` — 不改（同上）
- `src/openai.ts` — 不改

---

## 三、构建结果

```bash
$ npm run build

> codex-register@1.0.7 build
> tsup --config tsup.config.ts

CJS bundle\index.cjs 441.58 KB
CJS ⚡️ Build success in 80ms
```

**构建状态：** ✅ 成功
**输出文件：** `bundle/index.cjs`（441.58 KB）

---

## 四、向后兼容性

loadConfig() 支持新旧两种格式：

| config.json 格式 | 解析方式 |
|-----------------|---------|
| 新格式 `cpa.baseUrl` | ✅ 直接读取 |
| 旧格式 `cliproxyApiBaseUrl` | ✅ fallback 读取 |
| 新格式 `sub2api.email` | ✅ 直接读取 |
| 旧格式 `sub2apiEmail` | ✅ fallback 读取 |

**解析优先级：** 新格式 > 旧格式 > 默认值

---

## 五、验收检查

- [x] `npm run build` 构建成功
- [x] 新格式 config.json 正确加载
- [x] `tokenBackend: "cpa"` 时，走 `cpa.baseUrl` 和 `cpa.managementKey`
- [x] `tokenBackend: "sub2api"` 时，走 `sub2api.baseUrl` 等
- [x] CLI 参数 `--cpa-base`、`--cpa-key` 仍然可用（优先级高于 config）
- [x] 不修改 cpa-codex.ts、sub2api.ts、openai.ts
- [x] 旧格式 config.json 仍可正常使用（向后兼容）

---

## 六、配置示例

### 完整 config.json（新格式）

```json
{
  "provider": "hotmail",
  "defaultPassword": "kuaileshifu88",
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
  },
  "heroSMSApiKey": "xxx"
}
```

### 旧格式（仍然支持）

```json
{
  "tokenBackend": "cpa",
  "cliproxyApiBaseUrl": "http://10.10.10.20:8317",
  "cliproxyApiManagementKey": "123456@Aa",
  "cliproxyApiAutoUploadAuth": true,
  "sub2apiBaseUrl": "http://10.10.10.20:8081",
  "sub2apiEmail": "admin@sub2api.local",
  "sub2apiPassword": "admin123456",
  "sub2apiGroupIds": [14]
}
```

---

## 七、代码变更统计

| 文件 | 操作 | 变更行数 |
|------|------|---------|
| `src/config.ts` | 修改 | ~40 行 |
| `src/cpa-registration.ts` | 修改 | ~10 行 |
| `src/index.ts` | 修改 | ~15 行 |
| `src/cliproxyapi.ts` | 修改 | ~6 行 |
| `src/concurrent-registration.ts` | 修改 | ~2 行 |
| `src/worker-scheduler.ts` | 修改 | ~1 行 |
| **合计** | | **~74 行** |
