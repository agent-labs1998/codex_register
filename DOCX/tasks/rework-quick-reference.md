# 返工后快速参考卡

## 主要变化

### 1. cpa-registration.ts - 完全重写
**变化：**
- 不再内部创建 smsBroker
- 接受外部注入的 RegistrationTask
- 完整执行 7 个步骤
- 通过 onStatusChange 回调驱动状态机

**新接口：**
```ts
interface RegistrationTask {
  workerId: string;
  attemptId: number;
  phoneLease: SMSActivationLease;
  phoneNumber: string;
  activationId: string;
  bindEmail: string;
  fetchAddEmailOtp: () => Promise<string>;
  deadlines: {
    smsDeadlineAt: number;
    emailDeadlineAt: number;
    cpaDeadlineAt: number;
  };
  onStatusChange?: (status: string) => void;
}
```

### 2. worker-scheduler.ts - 完全重写
**变化：**
- 使用新的 RegistrationTask 接口
- 每个 worker 独立获取号码和邮箱
- 实时更新 worker_slots 和 registration_attempts
- 使用信号量控制并发
- 失败时自动释放号码

**Worker 状态机：**
```
IDLE → ACQUIRING_PHONE → WAITING_SMS → SMS_RECEIVED
  → REGISTERING → CPA_OAUTH → CPA_SUBMIT
  → WAITING_EMAIL_OTP → SUCCESS / FAILED / TIMED_OUT
```

### 3. concurrent-registration.ts - 完全重写
**变化：**
- 删除所有 TODO 和临时返回
- 完整执行注册闭环
- 每个号码独立运行
- 超时自动取消并释放资源
- 成功后写入 accounts 表

### 4. local-db.ts - 增强
**新增字段：**
```sql
worker_slots 表新增：
  - finished_at TEXT
  - last_error TEXT
  - cancel_reason TEXT
  - retry_count INTEGER
```

---

## 使用命令

### 串行模式
```bash
# 单次执行
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt

# 批量执行
npm run dev -- --workflow codex-cpa-register --count 5 --skip-probe-trial --token-out tokens.txt
```

### 并发模式（Worker 调度）
```bash
# 3 个 worker，共执行 10 次
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 3 --skip-probe-trial --token-out tokens.txt
```

### 并发抢号模式
```bash
# 同时获取 3 个号码，先收到验证码的优先使用
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

### 数据库查询
```bash
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-export-tokens tokens_export.txt
```

---

## 验收标准

### ✅ 已满足
1. 每个号码必须有唯一 workerId
2. 每个 worker 必须绑定 phone/email/attempt/result
3. 收到验证码后必须能继续完成 CPA OAuth、callback、auth 文件拉取、access token 获取
4. 所有 attempt/worker/account 必须写入 SQLite
5. 超时号码必须自动取消并释放资源
6. 并发结束后不能遗留挂死资源
7. 不得硬编码密钥

---

## 数据库结构

### worker_slots 表
```sql
CREATE TABLE worker_slots (
  worker_id TEXT PRIMARY KEY,
  run_id INTEGER NOT NULL,
  attempt_id INTEGER,
  status TEXT NOT NULL DEFAULT 'idle',
  phone TEXT,
  activation_id TEXT,
  bind_email TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  sms_deadline_at TEXT,
  email_deadline_at TEXT,
  last_error TEXT,
  cancel_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0
);
```

### registration_attempts 表
```sql
CREATE TABLE registration_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  phone TEXT,
  email TEXT,
  password TEXT,
  sms_activation_id TEXT,
  sms_country TEXT,
  sms_cost TEXT,
  cpa_status TEXT,
  cpa_auth_file TEXT,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
```

### accounts 表
```sql
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  access_token TEXT NOT NULL,
  token_expires_at TEXT,
  cpa_auth_file TEXT,
  cpa_base_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active'
);
```

---

## Worker 状态机详解

### 状态说明
| 状态 | 说明 |
|------|------|
| idle | 空闲，等待分配任务 |
| acquiring_phone | 正在获取号码 |
| waiting_sms | 已获取号码，等待验证码 |
| sms_received | 已收到验证码 |
| registering | 正在发起 OpenAI 注册 |
| cpa_oauth | 正在进行 CPA OAuth 登录 |
| cpa_submit | 正在提交 callback 给 CPA |
| waiting_email_otp | 正在等待邮箱 OTP |
| success | 注册成功 |
| failed | 注册失败 |
| timed_out | 超时 |
| cancelled | 已取消 |

### 状态流转
```
IDLE
  ↓ (获取号码)
ACQUIRING_PHONE
  ↓ (等待验证码)
WAITING_SMS
  ↓ (收到验证码)
SMS_RECEIVED
  ↓ (发起注册)
REGISTERING
  ↓ (CPA OAuth)
CPA_OAUTH
  ↓ (提交 callback)
CPA_SUBMIT
  ↓ (等待邮箱 OTP)
WAITING_EMAIL_OTP
  ↓ (获取 token)
SUCCESS
```

---

## 错误处理

### 号码获取失败
- 状态：failed
- 错误信息：获取号码失败的具体原因
- 资源释放：无（号码未获取）

### SMS 超时
- 状态：timed_out
- 错误信息：SMS verification timeout
- 资源释放：自动取消号码

### 注册失败
- 状态：failed
- 错误信息：失败的具体原因
- 资源释放：自动取消号码

### CPA 失败
- 状态：failed
- 错误信息：CPA 操作失败的具体原因
- 资源释放：自动取消号码

---

## 测试场景

### 场景 1：正常流程
```bash
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt
```
预期：worker 状态从 idle -> acquiring_phone -> waiting_sms -> sms_received -> ... -> success

### 场景 2：SMS 超时
```bash
npm run dev -- --workflow codex-cpa-register --count 1 --sms-timeout-ms 10000
```
预期：worker 状态从 idle -> acquiring_phone -> waiting_sms -> timed_out

### 场景 3：并发抢号
```bash
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool
```
预期：3 个号码同时获取，先收到验证码的优先使用，其余超时取消

---

## 参考文档

- `DOCX/rework-plan.md` - 返工计划
- `DOCX/rework-completion-report.md` - 返工完成报告
- `DOCX/workflow-local-db-plan.md` - 设计方案
- `DOCX/user-guide.md` - 使用指南
