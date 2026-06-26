# 任务书：添加 sub2api token 池集成

> 优先级：高 | 预计工作量：1 小时 | 审核人：CTO

---

## 零、你要做什么

**你的任务是写代码，不是分析。**

代码路径：`A:\Github\codex_register\`

你需要完成以下工作：

1. **新建文件** `src/sub2api.ts` — sub2api API 封装模块
2. **修改文件** `src/config.ts` — 新增 sub2api 配置项
3. **修改文件** `src/cpa-registration.ts` — 注册成功后同时导入 sub2api
4. **修改文件** `src/index.ts` — 经典模式注册成功后同时导入 sub2api

完成后执行 `cd A:/Github/codex_register && npm run build` 验证构建。

---

## 一、背景

当前项目注册成功后只导入 CPA（`cpa-codex.ts`）。需要新增 sub2api 作为第二个 token 池后端，注册成功后**同时**导入 CPA 和 sub2api，两边都有 token。

---

## 二、参考代码（只看以下行号）

**代码路径：** `A:\Github\codex_register\`

| 文件 | 只看这些行 | 参考什么 |
|------|-----------|--------|
| `src/cpa-codex.ts` | 全文（199 行） | **核心参考** — sub2api.ts 的写法照这个模式来 |
| `src/config.ts` | 第 6-96 行 | 配置项定义方式（AppConfigFile + AppConfig + DEFAULT_CONFIG） |
| `src/cpa-registration.ts` | 第 240-270 行 | CPA 入库成功后的流程，sub2api 导入要插在这里 |
| `src/index.ts` | 第 1290-1310 行 | CLI 命令写法 |

**不要读的文件：** `src/openai.ts`、`src/sentinel.ts`、任何 DOCX 文档

---

## 三、sub2api API 说明

sub2api 已经部署好了，不需要你部署。

### 导入 Codex token 接口

```
POST {sub2apiBaseUrl}/api/v1/admin/openai/create-from-codex-pat
Authorization: Bearer {sub2apiToken}
Content-Type: application/json

Body:
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",   // 注册成功拿到的 access_token
  "name": "+573224652519 / xxx@coroabet777.com",  // 备注（手机号+邮箱）
  "concurrency": 3,                               // 并发数，默认 3
  "priority": 50                                  // 优先级，默认 50
}

成功响应 (200/201):
{
  "id": "...",
  "name": "...",
  "platform": "openai",
  "type": "oauth"
}
```

### 认证方式
- 请求头：`Authorization: Bearer {sub2apiToken}`
- `sub2apiToken` 是 sub2api 管理员登录后的 JWT token
- 由用户在 config.json 中配置

---

## 四、具体改动

### 4.1 新建 `src/sub2api.ts`

照着 `src/cpa-codex.ts` 的模式写：

```typescript
import {Agent, fetch as undiciFetch, type Dispatcher} from "undici";

let cachedDispatcher: Dispatcher | null = null;

function getSub2apiDispatcher(): Dispatcher {
    if (!cachedDispatcher) {
        cachedDispatcher = new Agent({connect: {rejectUnauthorized: false}});
    }
    return cachedDispatcher;
}

function buildHeaders(token: string): Record<string, string> {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
}

export interface Sub2apiImportResult {
    success: boolean;
    status: number;
    body: string;
    accountId?: string;
}

// 核心方法：导入 access_token 到 sub2api
export async function importCodexToken(
    baseUrl: string,
    adminToken: string,
    accessToken: string,
    name: string,
    options?: { concurrency?: number; priority?: number },
    timeoutMs = 20000,
): Promise<Sub2apiImportResult> {
    // POST /api/v1/admin/openai/create-from-codex-pat
    // 参考 cpa-codex.ts 的 requestCodexAuthUrl 写法
    // 返回 { success, status, body, accountId }
}
```

### 4.2 修改 `src/config.ts`

在 `AppConfigFile`、`AppConfig`、`DEFAULT_CONFIG` 中新增：

```typescript
// AppConfigFile
sub2apiBaseUrl?: unknown;
sub2apiToken?: unknown;
sub2apiEnabled?: unknown;

// AppConfig
sub2apiBaseUrl: string;
sub2apiToken: string;
sub2apiEnabled: boolean;

// DEFAULT_CONFIG
sub2apiBaseUrl: "",
sub2apiToken: "",
sub2apiEnabled: false,
```

在 `loadConfig()` 函数中新增解析逻辑（参考现有的 `cliproxyApiBaseUrl` 的写法）。

config.json 示例：
```json
"sub2apiEnabled": true,
"sub2apiBaseUrl": "http://10.10.10.20:8080",
"sub2apiToken": "eyJhbGciOiJSUzI1NiIs..."
```

### 4.3 修改 `src/cpa-registration.ts`

在 CPA 入库成功后（约第 310 行，`reportStatus("success")` 之前），添加：

```typescript
// 导入 sub2api（如果启用）
if (appConfig.sub2apiEnabled && appConfig.sub2apiToken && accessToken) {
    try {
        const { importCodexToken } = await import("./sub2api.js");
        const result = await importCodexToken(
            appConfig.sub2apiBaseUrl,
            appConfig.sub2apiToken,
            accessToken,
            `${phoneNumber} / ${bindEmail}`,
        );
        if (result.success) {
            console.log(`[CPA] ⑤ ✓ sub2api 导入成功`);
        } else {
            console.warn(`[CPA] ⑤ ⚠ sub2api 导入失败: ${result.status} ${result.body.slice(0, 200)}`);
        }
    } catch (e) {
        console.warn(`[CPA] ⑤ ⚠ sub2api 导入异常: ${(e as Error).message}`);
    }
}
```

注意：sub2api 导入失败不应影响主流程，用 try-catch 包裹，失败只 warn 不 throw。

### 4.4 修改 `src/index.ts`

在经典模式（`--codex-cpa`）中，CPA 入库成功后也加同样的 sub2api 导入逻辑。

---

## 五、验收标准

1. `npm run build` 构建成功
2. `sub2apiEnabled: false` 时，行为不变（不影响现有功能）
3. `sub2apiEnabled: true` 时，注册成功后日志显示 `[CPA] ⑤ ✓ sub2api 导入成功`
4. sub2api 导入失败不影响主流程（不 throw，只 warn）
5. 不修改 `cpa-codex.ts` 和 `openai.ts`

---

## 六、报告要求

完成后将报告写到 `A:\Github\codex_register\任务\任务报告\sub2api集成报告.md`，包含：
- 新增/修改了哪些文件的哪些行
- 构建结果
- 测试：手动调用 sub2api API 验证连通性
