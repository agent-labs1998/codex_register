# Codex-Register Workflow 模式

## 新增功能

### 1. SQLite 数据库
- 自动创建 `data/codex-register.sqlite`
- 存储：workflow 运行记录、注册尝试、成功账号、worker slots

### 2. Workflow 模式
批量执行 CPA 注册，自动记录所有结果。

#### 串行模式（默认）
```bash
# 执行 1 次 workflow
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt

# 执行 10 次 workflow
npm run dev -- --workflow codex-cpa-register --count 10 --skip-probe-trial --token-out tokens.txt

# 指定数据库路径
npm run dev -- --workflow codex-cpa-register --count 5 --db-path my-db.sqlite

# 自定义延迟
npm run dev -- --workflow codex-cpa-register --count 3 --delay-ms 5000
```

#### 并发模式
```bash
# Worker 调度模式：每个 worker 独立运行（默认）
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt

# 并发抢号模式：同时获取多个号码，先收到验证码的优先使用
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --concurrent-pool --token-out tokens.txt

# 并发 10 个 worker，共执行 100 次
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 10 --skip-probe-trial --token-out tokens.txt

# 自定义超时时间
npm run dev -- --workflow codex-cpa-register --count 50 --concurrency 10 \
  --sms-timeout-ms 90000 \
  --email-timeout-ms 60000 \
  --cpa-timeout-ms 45000
```

#### 并发模式说明
- **Worker 调度模式**（默认）：每个 worker 独立运行完整的注册流程，适合稳定的批量注册
- **并发抢号模式**（`--concurrent-pool`）：同时获取多个号码，先收到验证码的优先使用，适合快速抢号

#### 参数说明
- `--workflow codex-cpa-register`：指定 workflow 名称
- `--count N`：执行次数（默认 1）
- `--concurrency N`：并发数（默认 1，串行模式）
- `--concurrent-pool`：使用并发抢号模式（仅并发模式）
- `--token-out tokens.txt`：token 输出文件
- `--skip-probe-trial`：跳过试用探测
- `--db-path <path>`：数据库路径（默认 `data/codex-register.sqlite`）
- `--delay-ms <ms>`：每次执行间隔（默认使用 config.json 的 loopDelayMs，仅串行模式）
- `--sms-timeout-ms <ms>`：SMS 等待超时（默认 120000ms，仅并发模式）
- `--email-timeout-ms <ms>`：邮箱 OTP 等待超时（默认 90000ms，仅并发模式）
- `--cpa-timeout-ms <ms>`：CPA 操作超时（默认 60000ms，仅并发模式）

### 3. 数据库查询命令

#### 查看成功账号
```bash
npm run dev -- --db-list-accounts
```

输出示例：
```
[db] 账号列表 (共 1 个):

  ID: 1
  Phone: +573001234567
  Email: tmpabc@coroabet777.com
  Status: active
  Created: 2026-06-16 10:30:00
  Token: eyJhbGciOiJSUzI1NiIs...
```

#### 查看运行记录
```bash
npm run dev -- --db-list-runs
```

输出示例：
```
[db] 运行记录 (共 1 条):

  ID: 1
  Workflow: codex-cpa-register
  Status: completed
  Started: 2026-06-16 10:30:00
  Finished: 2026-06-16 10:35:00
  Success: 8
  Failure: 2
```

#### 查看 worker 状态
```bash
# 查看所有 worker 统计
npm run dev -- --db-list-workers

# 查看特定 run 的活跃 workers
npm run dev -- --db-list-workers --run-id 1
```

输出示例：
```
[db] Run 1 活跃 workers (共 3 个):

  Worker: worker-001
  Status: waiting_sms
  Phone: +573001234567
  Email: tmpabc@coroabet777.com
  Started: 2026-06-16 10:30:00

  Worker: worker-002
  Status: acquiring_phone
  Phone: -
  Email: -
  Started: 2026-06-16 10:30:05
```

#### 导出 token 到文件
```bash
npm run dev -- --db-export-tokens tokens_export.txt
```

### 4. Worker 状态机

每个 worker 有明确的状态流转：

```
IDLE
  ↓
ACQUIRING_PHONE (获取号码)
  ↓
REGISTERING (发起 OpenAI 注册)
  ↓
WAITING_SMS (等待验证码)
  ↓
SMS_RECEIVED (收到验证码)
  ↓
CPA_OAUTH (CPA OAuth 登录)
  ↓
WAITING_EMAIL_OTP (等待邮箱验证码)
  ↓
EMAIL_OTP_RECEIVED (收到邮箱验证码)
  ↓
CPA_SUBMIT (提交 CPA)
  ↓
SUCCESS / FAILED / TIMED_OUT / CANCELLED
```

### 5. 数据库结构

#### workflow_runs
| 字段 | 说明 |
|------|------|
| id | 主键 |
| workflow | workflow 名称 |
| status | running/completed/failed/partial |
| started_at | 开始时间 |
| finished_at | 结束时间 |
| success_count | 成功次数 |
| failure_count | 失败次数 |
| options_json | 运行参数（JSON） |
| last_error | 最后错误信息 |

#### registration_attempts
| 字段 | 说明 |
|------|------|
| id | 主键 |
| run_id | 关联的 workflow_run |
| status | pending/running/ok/failed |
| phone | 手机号 |
| email | 邮箱 |
| password | 密码 |
| sms_activation_id | SMS activation ID |
| cpa_auth_file | CPA auth 文件名 |
| error | 错误信息 |
| started_at | 开始时间 |
| finished_at | 结束时间 |

#### accounts
| 字段 | 说明 |
|------|------|
| id | 主键 |
| phone | 手机号（唯一） |
| email | 邮箱 |
| password | 密码 |
| access_token | ChatGPT access token |
| token_expires_at | token 过期时间 |
| cpa_auth_file | CPA auth 文件名 |
| cpa_base_url | CPA API 地址 |
| status | active/inactive |
| created_at | 创建时间 |
| updated_at | 更新时间 |

#### worker_slots
| 字段 | 说明 |
|------|------|
| worker_id | 主键（如 worker-001） |
| run_id | 关联的 workflow_run |
| attempt_id | 关联的 registration_attempt |
| status | idle/acquiring_phone/registering/waiting_sms/... |
| phone | 绑定的手机号 |
| activation_id | SMS activation ID |
| bind_email | 绑定的邮箱 |
| started_at | 开始时间 |
| sms_deadline_at | SMS 等待截止时间 |
| email_deadline_at | 邮箱 OTP 等待截止时间 |

### 6. 并发调度器特性

- **资源绑定**：每个号码/邮箱只能分配给一个 worker
- **超时控制**：SMS、邮箱 OTP、CPA 操作都有独立超时
- **状态追踪**：所有状态变化写入数据库
- **失败释放**：超时或失败后立即释放 worker slot
- **并发限制**：最多 N 个 worker 同时运行（由 `--concurrency` 控制）

### 7. 并发抢号模式特性

- **同时获取多个号码**：一次性获取 N 个号码
- **并行发起注册**：所有号码同时发起 OpenAI 注册
- **先到先用**：谁先收到验证码，就优先使用谁
- **超时取消**：其余号码超时后自动取消，释放资源
- **快速抢号**：适合号码稀缺、需要快速注册的场景

使用示例：
```bash
# 同时获取 5 个号码，先收到验证码的优先使用
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

### 8. 兼容性

- ✅ 保留原有单次运行能力（`--codex-cpa` 不受影响）
- ✅ 保留原有 `--token-out` 文件追加行为
- ✅ 串行模式和并发模式可自由切换
- ✅ 新功能是增量添加，不影响现有流程

---

## 快速开始

### 场景 1：单次注册（原有功能）
```bash
npm run dev -- --codex-cpa --token-out tokens.txt
```

### 场景 2：批量注册（串行）
```bash
# 执行 5 次，每次间隔使用默认值
npm run dev -- --workflow codex-cpa-register --count 5 --token-out tokens.txt

# 执行 10 次，跳过试用探测，自定义延迟
npm run dev -- --workflow codex-cpa-register --count 10 --skip-probe-trial --delay-ms 3000 --token-out tokens.txt
```

### 场景 3：并发注册（Worker 调度）
```bash
# 5 个 worker，共执行 20 次
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt

# 10 个 worker，执行 100 次，自定义超时
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 10 \
  --sms-timeout-ms 90000 \
  --skip-probe-trial \
  --token-out tokens.txt
```

### 场景 4：快速抢号（并发抢号模式）
```bash
# 同时获取 5 个号码，先收到验证码的优先使用
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 \
  --concurrent-pool \
  --skip-probe-trial \
  --token-out tokens.txt
```

### 场景 5：查看数据库
```bash
# 查看成功账号
npm run dev -- --db-list-accounts

# 查看运行记录
npm run dev -- --db-list-runs

# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 1

# 导出 token
npm run dev -- --db-export-tokens tokens_export.txt
```

---

## 参考文档

- `DOCX/workflow-local-db-plan.md` - 设计方案
- `DOCX/upgrade-summary.md` - 升级总结
- `DOCX/quick-reference.md` - 快速参考卡
- `DOCX/task-report.md` - 任务报告书
