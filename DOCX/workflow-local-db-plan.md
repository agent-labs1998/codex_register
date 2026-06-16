# 本地工作流与 SQLite 持久化落地方案

## 背景

当前项目主要由 `src/index.ts` 中的固定脚本流程驱动：执行 CPA 注册、写 token 文件、输出日志。这样有几个问题：

- 可选步骤不容易跳过，例如 Plus 试用探测。
- 批量注册缺少正式的 run / attempt 状态记录。
- 成功账号、密码、token、CPA auth 文件名等信息只散落在日志和文本 token 文件里。
- 后续排查失败原因、统计成功率、导出 token 都不方便。

目标是在当前单体项目基础上，先做一个轻量级本地工作流层和本地数据库，不引入 byte-v-forge 全套服务。

---

## 推荐方案

### 1. 新增本地数据库模块

新增文件：

```text
src/local-db.ts
```

使用 Node 22 内置 SQLite：

```ts
import { DatabaseSync } from "node:sqlite";
```

这样不需要新增 `sqlite3`、`better-sqlite3` 等原生 npm 依赖。

默认数据库路径：

```text
data/codex-register.sqlite
```

同时把下面目录加入 `.gitignore`：

```text
data/
```

### 2. 数据表设计

#### `workflow_runs`

记录每一次工作流运行。

字段建议：

- `id`
- `workflow`
- `status`
- `started_at`
- `finished_at`
- `success_count`
- `failure_count`
- `options_json`
- `last_error`

#### `registration_attempts`

记录每一次注册尝试。

字段建议：

- `id`
- `run_id`
- `status`
- `phone`
- `email`
- `password`
- `sms_activation_id`
- `sms_country`
- `sms_cost`
- `cpa_status`
- `cpa_auth_file`
- `error`
- `started_at`
- `finished_at`

#### `accounts`

记录成功账号。

字段建议：

- `id`
- `phone`
- `email`
- `password`
- `access_token`
- `token_expires_at`
- `cpa_auth_file`
- `cpa_base_url`
- `created_at`
- `updated_at`
- `status`

### 3. 数据库 helper 函数

在 `src/local-db.ts` 中提供小型 API：

```ts
createWorkflowRun()
finishWorkflowRun()
createAttempt()
updateAttempt()
saveAccount()
listAccounts()
listRuns()
exportTokens()
```

所有写入使用 prepared statements。

---

## 工作流改造

### 1. 抽出 CPA 注册函数

当前 `--codex-cpa` 的主要逻辑在 `src/index.ts` 里。建议将它抽成返回结构化结果的函数。

返回类型类似：

```ts
interface CodexCpaResult {
  status: "ok" | "no_trial" | "failed";
  phone: string;
  email: string;
  password: string;
  accessToken?: string;
  cpaAuthFile?: string;
  error?: string;
}
```

要求：

- 保留现有日志。
- 保留现有 `--codex-cpa` 单次运行行为。
- 同时让 workflow 可以拿到结构化字段并写入 SQLite。

关键文件：

```text
src/index.ts
```

### 2. 新增 workflow CLI 参数

建议新增参数：

```bash
--workflow codex-cpa-register
--count N
--skip-probe-trial
--skip-gp-plus
--db-path <path>
--delay-ms <ms>
```

示例：

```bash
npm run dev -- --workflow codex-cpa-register --count 10 --skip-probe-trial --token-out tokens.txt
```

### 3. 参数优先级

保持当前配置文件不乱动：

```text
CLI 参数 > 环境变量 > config.json
```

`--skip-probe-trial` 应该能在运行时跳过 JP 试用探测，即使 `config.json` 里配置了 `probeTrialProxyJp`。

---

## 批量流程

当前 `main()` 遇到 `--codex-cpa` 后只执行一次。workflow 模式下应支持循环。

流程：

1. 创建 `workflow_runs` 行。
2. 按 `--count` 循环。
3. 每次创建 `registration_attempts` 行。
4. 调用一次 CPA 注册。
5. 成功：
   - 写入 `accounts`
   - 标记 attempt 为 `ok`
   - `success_count + 1`
6. 失败：
   - 写入错误信息
   - 标记 attempt 为 `failed`
   - `failure_count + 1`
7. 轮间等待 `loopDelayMs` 或 `--delay-ms`。
8. 最终更新 `workflow_runs` 状态。

---

## 成功账号持久化

每个成功账号保存：

- 手机号
- 绑定邮箱
- 密码（来自 `--password` 或 `config.json.defaultPassword`）
- access token
- token 过期时间（从 JWT exp 解析）
- CPA auth 文件名
- CPA base URL
- 创建时间 / 更新时间
- 状态

同时保留现在的 `--token-out` 文本追加行为，避免破坏已有脚本。

---

## 查询和导出命令

可以先做轻量命令：

```bash
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-export-tokens tokens_export.txt
```

如果后续变复杂，再拆成：

```text
src/db-cli.ts
```

---

## 验证方式

### 1. 构建

```bash
npm run build
```

### 2. 跑 1 个 workflow

```bash
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial --token-out test_tokens.txt
```

验证：

- 控制台出现 `[POOL-RESULT] status=ok ...`
- `test_tokens.txt` 有 JWT
- `data/codex-register.sqlite` 存在
- `--db-list-accounts` 能看到 phone / email / password / token 元数据

### 3. 跑短批量

```bash
npm run dev -- --workflow codex-cpa-register --count 2 --skip-probe-trial --token-out test_tokens.txt
```

验证：

- `workflow_runs.success_count` 正确增加
- 失败 attempt 有错误详情
- 成功账号能去重或更新

---

## 并发注册（后续阶段）

### 1. 目标

当前默认仍是串行注册。后续要支持并发抢号注册，核心目标是：

- 同时获取 N 个号码
- 并行发起 OpenAI 注册
- 哪个号码先收到验证码，就优先使用哪个
- 超时号码独立释放，不阻塞其它 worker

当前已先落一个简化版保护策略：“**巡视释放模式**”。

---

### 0. 巡视释放模式（已落地）

当前版本已在 CPA 短信等待阶段加入 deadline 保护：

- 若在 deadline 内未收到验证码，立即判定失败
- 立即触发号码释放流程
- 程序会主动调用供应商取消接口尝试立即回收号码
- 不再继续挂住无效号码占用余额
- 当前版本已支持“失败后从零重建 worker/邮箱/设备指纹”，不复用脏状态

当前默认逻辑：

```text
等待 SMS
超过 deadline 仍未收到验证码
  -> 立即失败
  -> 立即换号/释放
```

该模式目标：

- 避免号码长时间挂死
- 避免余额被无效号码长期占用
- 尽早回笼失败资源

---

### 2. 前提条件

并发注册不是“多开几个 async function”，而必须满足下面条件：

- 每个 worker 有唯一 `worker_id`
- 每个号码绑定到一个 worker
- 每个邮箱绑定到一个 worker
- 每个 activation 只能属于一个 worker
- 每个阶段有独立超时
- 所有结果最终写入同一个数据库

---

### 3. 最小数据模型扩展

在 `registration_attempts` 中扩展字段：

- `worker_id`
- `sms_deadline_at`
- `email_deadline_at`
- `phase`
- `cancel_reason`

建议新增表：

#### `worker_slots`

记录当前 worker 调度状态。

字段建议：

- `worker_id`
- `run_id`
- `attempt_id`
- `status`
- `phone`
- `activation_id`
- `bind_email`
- `started_at`
- `sms_deadline_at`
- `email_deadline_at`

---

### 4. worker 状态机

每个 worker 应该有明确状态：

```text
IDLE
ACQUIRING_PHONE
REGISTERING
WAITING_SMS
SMS_RECEIVED
CPA_OAUTH
WAITING_EMAIL_OTP
EMAIL_OTP_RECEIVED
CPA_SUBMIT
SUCCESS
FAILED
TIMED_OUT
CANCELLED
```

不允许在 catch 中无规则地跳阶段。  
所有状态变化必须写入数据库和日志。

---

### 5. 并发调度器

并发控制应基于任务队列 + 并发上限：

```text
TaskQueue
  - pending
  - running
  - concurrency
```

控制规则：

- 每次最多只有 `--concurrency N` 个 worker 运行
- 成功 / 失败 / 超时后释放 slot
- slot 释放后才派发下一个任务
- 不允许无限堆积 worker

---

### 6. 资源绑定规则

#### 号码绑定

每个号码只能分配给一个 worker：

```text
worker-07 -> +57aaaa -> activation_id=1001
worker-12 -> +57bbbb -> activation_id=1002
```

如果号码超时或失败：

- 标记 worker 为 `TIMED_OUT` / `FAILED`
- 执行号码 cancel/withdraw（如果官方支持）
- 释放 worker slot

#### 邮箱绑定

每个临时邮箱只能绑定一个 worker：

```text
worker-07 -> tmpaaa@coroabet777.com
worker-12 -> tmpbbb@coroabet777.com
```

---

### 7. 延迟短信处理策略

延迟短信是并发场景里最容易出错的地方，必须提前定义规则。

#### 方案 A：保守模式（默认推荐）

```text
短信等待 120s
超时后标记 worker TIMED_OUT
取消号码后不再接受该号码的迟到短信
```

优点：

- 状态清晰
- 不会串号

缺点：

- 会错过部分延迟短信

#### 方案 B：宽收模式

```text
短信主等待期 90s
超时后进入 grace period 30s
grace period 内收到短信仍继续
grace period 结束后彻底放弃
```

优点：

- 可兜住部分延迟

缺点：

- 实现更复杂
- 需要 worker 与号码维护两层状态

#### 方案 C：失败号码归档，不还原 worker

```text
主流程已超时并释放 worker
迟到短信只记入历史，不影响已释放 worker
```

---

### 8. 每个阶段建议超时

| 阶段 | 建议超时 |
|------|---------|
| 取号 | 15s |
| OpenAI 注册 | 20s |
| 短信等待 | 90s ~ 120s |
| 邮箱 OTP | 90s |
| CPA 入库 | 60s |

超时后必须：

- 标记 attempt/error
- 回收资源
- 释放 worker slot
- 写入 DB

---

### 9. CLI 参数建议

后续并发模式建议新增：

```bash
--workflow codex-cpa-register
--count 100
--concurrency 20
--sms-timeout-ms 120000
--email-timeout-ms 90000
--cpa-timeout-ms 60000
--grace-period-ms 30000
```

示例：

```bash
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 20 --skip-probe-trial --token-out tokens.txt
```

---

### 10. 并发验证方式

并发模式应验证以下场景：

1. 20 个 worker 同时在线
2. 其中 5 个快速收到验证码
3. 15 个超时后正常释放
4. 延迟短信不会污染其它 worker
5. 成功账号写入 `accounts`
6. 所有 attempt 写入 `registration_attempts`
7. `workflow_runs` 统计正确

验证重点：

- worker_id、phone、activation_id、email 是否一一对应
- 超时号码是否正确释放
- 迟到短信是否不会串到别的 worker
- 并发结束后 slot 是否全部释放

---

### 11. 并发阶段落地顺序

建议分阶段落地：

#### 第 1 阶段

先完成：

- workflow 串行版本
- SQLite
- run / attempt / accounts

#### 第 2 阶段

再做：

- worker slot 表
- 状态机
- 任务队列
- 并发调度器

#### 第 3 阶段

再做：

- grace period
- 延迟短信兜底
- 更完善的并发监控命令

---

## 注意事项

- 并发注册不要和 Plus 订阅逻辑混在一起。
- 不要把多个 worker 共享一个号码或邮箱。
- 不要把“窗口数量”理解为并发能力，真正的并发能力取决于状态机和资源调度。
- 先保证串行稳定，再做并发。
- `test_tokens.txt` 有 JWT
- `data/codex-register.sqlite` 存在
- `--db-list-accounts` 能看到 phone / email / password / token 元数据

### 3. 跑短批量

```bash
npm run dev -- --workflow codex-cpa-register --count 2 --skip-probe-trial --token-out test_tokens.txt
```

验证：

- `workflow_runs.success_count` 正确增加
- 失败 attempt 有错误详情
- 成功账号能去重或更新

---

## 注意事项

1. 不要把密钥、密码、API key 硬编码进源码。
2. 新配置必须来自 `config.json`、环境变量或 CLI 参数。
3. 不在本阶段实现 Plus 订阅自动化，只做跳过和状态记录。
4. 先保持当前已跑通的 CPA 注册链路稳定，再做并发优化。
5. SQLite 数据库目录 `data/` 不提交 git。
