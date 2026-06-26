# 任务书：添加 sub2api 作为 CPA 备用入库后端

> 优先级：高 | 预计工作量：1.5 小时 | 审核人：CTO

---

## 零、你要做什么

**你的任务是写代码，不是分析。**

代码路径：`A:\Github\codex_register\`

你需要完成以下工作：

1. **新建文件** `src/sub2api.ts` — sub2api API 封装（授权URL→交换code→入库）
2. **修改文件** `src/config.ts` — 新增 sub2api 配置项和 `tokenBackend` 开关
3. **修改文件** `src/cpa-registration.ts` — 根据 `tokenBackend` 开关选择用 CPA 还是 sub2api
4. **修改文件** `src/index.ts` — 经典模式同步支持

完成后执行 `cd A:/Github/codex_register && npm run build` 验证构建。

---

## 一、背景

当前注册流程的入库环节（步骤 5-9）全部走 CPA。CPA 最近封号严重，需要 sub2api 作为备用后端。

通过 config.json 的 `tokenBackend` 开关切换，注册流程（步骤 1-4）完全不动。

**当前流程（全部走 CPA）：**
```
1. HeroSMS 取号
2. 打开 ChatGPT 授权页 → 提交手机号注册
3. OpenAI 发短信 → 收到验证码 → 提交验证码
4. 提交密码
5. 获取 CPA OAuth 授权链接        ← CPA
6. OAuth 流程中绑定新邮箱 → 收邮箱验证码 → 提交
7. 拿到 callback URL（带 code）
8. 提交给 CPA → CPA 用 code 换 token ← CPA
9. 拉取 auth 文件 → 拿到 access_token ← CPA
```

**切换到 sub2api 后（步骤 5/8/9 换成 sub2api）：**
```
1. HeroSMS 取号                    ← 不变
2. 打开 ChatGPT 授权页 → 提交手机号注册  ← 不变
3. OpenAI 发短信 → 收到验证码 → 提交    ← 不变
4. 提交密码                         ← 不变
5. 获取 sub2api OAuth 授权链接      ← 换成 sub2api
6. OAuth 流程中绑定新邮箱 → 收邮箱验证码 → 提交  ← 不变
7. 拿到 callback URL（带 code）     ← 不变
8. 提交给 sub2api → sub2api 用 code 换 token ← 换成 sub2api
9. sub2api 创建账户入库             ← 换成 sub2api
```

---

## 二、参考代码（只看以下行号）

**代码路径：** `A:\Github\codex_register\`

| 文件 | 只看这些行 | 参考什么 |
|------|-----------|--------|
| `src/cpa-codex.ts` | 全文（199 行） | **核心参考** — sub2api.ts 的写法照这个模式来（HTTP 请求、dispatcher、超时处理） |
| `src/config.ts` | 第 6-96 行 | 配置项定义方式 |
| `src/cpa-registration.ts` | 第 160-320 行 | CPA OAuth 入库完整流程（5-9 步），sub2api 要替换这里的逻辑 |
| `src/index.ts` | 第 82-200 行 | 经典模式的 CPA 流程 |

---

## 三、sub2api API 说明

sub2api 已经部署好了（`http://10.10.10.20:8081`），不需要你部署。

### 步骤 5：获取授权 URL

```
POST {sub2apiBaseUrl}/api/v1/admin/openai/generate-auth-url
Authorization: Bearer {sub2apiToken}
Content-Type: application/json

成功响应 (200):
{
  "auth_url": "https://auth.openai.com/...",
  "session_id": "xxx"
}
```

### 步骤 8：用 code 换 token

```
POST {sub2apiBaseUrl}/api/v1/admin/openai/exchange-code
Authorization: Bearer {sub2apiToken}
Content-Type: application/json

Body:
{
  "session_id": "步骤5返回的session_id",
  "code": "callback URL 里的 code 参数",
  "state": "callback URL 里的 state 参数"
}

成功响应 (200):
{
  "access_token": "...",
  "refresh_token": "rt.xxx..."
}
```

### 步骤 9：创建账户入库

```
POST {sub2apiBaseUrl}/api/v1/admin/openai/create-from-oauth
Authorization: Bearer {sub2apiToken}
Content-Type: application/json

Body:
{
  "refresh_token": "步骤8返回的refresh_token",
  "group_ids": [14]
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

---

## 四、具体改动

### 4.1 新建 `src/sub2api.ts`

照着 `src/cpa-codex.ts` 的模式写，包含 3 个核心方法：

```typescript
import {Agent, fetch as undiciFetch, type Dispatcher} from "undici";

let cachedDispatcher: Dispatcher | null = null;
function getSub2apiDispatcher(): Dispatcher { /* 同 cpa-codex.ts */ }
function buildHeaders(token: string): Record<string, string> { /* Bearer token */ }

// 步骤 5：获取授权 URL
export async function generateAuthUrl(
    baseUrl: string, adminToken: string, timeoutMs = 20000
): Promise<{ authUrl: string; sessionId: string }> {
    // POST /api/v1/admin/openai/generate-auth-url
}

// 步骤 8：用 code 换 token
export async function exchangeCode(
    baseUrl: string, adminToken: string,
    sessionId: string, code: string, state: string,
    timeoutMs = 30000
): Promise<{ accessToken: string; refreshToken: string }> {
    // POST /api/v1/admin/openai/exchange-code
}

// 步骤 9：创建账户入库
export async function createFromOAuth(
    baseUrl: string, adminToken: string,
    refreshToken: string, groupIds?: number[],
    timeoutMs = 20000
): Promise<{ success: boolean; status: number; body: string; accountId?: string }> {
    // POST /api/v1/admin/openai/create-from-oauth
}
```

### 4.2 修改 `src/config.ts`

在 `AppConfigFile`、`AppConfig`、`DEFAULT_CONFIG` 中新增：

```typescript
// 新增字段
tokenBackend: "cpa" | "sub2api";    // 选择入库后端
sub2apiBaseUrl: string;               // sub2api 地址
sub2apiToken: string;                 // sub2api JWT token
sub2apiGroupIds: number[];            // sub2api 分组 ID

// 默认值
tokenBackend: "cpa",
sub2apiBaseUrl: "",
sub2apiToken: "",
sub2apiGroupIds: [14],
```

config.json 示例：
```json
"tokenBackend": "cpa",
"sub2apiBaseUrl": "http://10.10.10.20:8081",
"sub2apiToken": "eyJhbGciOiJSUzI1NiIs...",
"sub2apiGroupIds": [14]
```

### 4.3 修改 `src/cpa-registration.ts`

**核心改动：** 在步骤 5（CPA OAuth）处，根据 `tokenBackend` 开关分流。

```
如果 tokenBackend === "sub2api"：
  5. sub2api.generateAuthUrl() → 拿到 authUrl
  6. 绑定邮箱（代码不变，复用现有的 authLoginViaCpaAuthorizeURL）
  7. 拿到 callback URL
  8. sub2api.exchangeCode() → 拿到 refreshToken
  9. sub2api.createFromOAuth() → 入库
  10. 从 accounts 表写入 accessToken

如果 tokenBackend === "cpa"（默认）：
  走现有逻辑不变
```

**注意：**
- `authLoginViaCpaAuthorizeURL` 不改，它处理的是 OpenAI 的 OAuth 流程，跟 CPA/sub2api 无关
- 只替换获取授权 URL、提交 callback、入库这三步
- sub2api 失败时应 fallback 到 CPA（如果 CPA 也配置了的话），或者直接报错

### 4.4 修改 `src/index.ts`

经典模式（`--codex-cpa`）中同步支持 `tokenBackend` 开关。

---

## 五、验收标准

1. `npm run build` 构建成功
2. `tokenBackend: "cpa"` 时，行为完全不变
3. `tokenBackend: "sub2api"` 时，走 sub2api 的 3 个 API 完成入库
4. 日志显示 `[sub2api]` 前缀的步骤输出
5. 不修改 `openai.ts`、`cpa-codex.ts`
6. 注册流程（步骤 1-4）完全不动

---

## 六、报告要求

完成后将报告写到 `A:\Github\codex_register\任务\任务报告\sub2api集成报告.md`，包含：
- 新增/修改了哪些文件
- 构建结果
- 两种模式（cpa/sub2api）的切换测试
