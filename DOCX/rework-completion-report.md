# 并发抢号返工完成报告

## 一、返工概述

按照 `DOCX/rework-plan.md` 的要求，对并发抢号和 worker 绑定逻辑进行了全面返工。

**返工日期：** 2026-06-16
**返工目标：** 完成并发抢号的完整业务闭环，确保可验证、可追溯、可释放。

---

## 二、已修复的问题

### ✅ 问题 1：并发抢号必须完成完整闭环
**修复前：**
- 存在明显 TODO 和临时返回
```ts
return ""; // 临时返回，后续会替换
const chatgptAccessToken = ""; // TODO: 从 client 获取
email: "", // TODO: 从邮箱 provider 获取
```

**修复后：**
- 完整执行所有步骤：
  1. 准备邮箱（bindEmail + fetchAddEmailOtp）
  2. 等待 SMS 验证码
  3. 用验证码完成 phone signup
  4. CPA OAuth 登录
  5. 提交 callback 给 CPA
  6. 拉取 auth 文件
  7. 获取 access_token
- 所有 TODO 已清除

### ✅ 问题 2：worker/phone/email/attempt 必须强绑定
**修复前：**
- worker 和 attempt 的绑定关系不是闭环驱动出来的
- 号码、邮箱在 runCpaRegistration() 内部自生，不会实时回写到 worker_slots

**修复后：**
- 定义了 `RegistrationTask` 接口，明确绑定关系：
```ts
interface RegistrationTask {
  workerId: string;
  attemptId: number;
  phoneLease: SMSActivationLease;
  phoneNumber: string;
  activationId: string;
  bindEmail: string;
  fetchAddEmailOtp: () => Promise<string>;
  deadlines: {...};
  onStatusChange?: (status: string) => void;
}
```
- 每个步骤都实时更新 worker_slots 和 registration_attempts

### ✅ 问题 3：cpa-registration 必须支持外部注入资源
**修复前：**
```ts
const smsBroker = appConfig.heroSMSApiKey ? createSMSBroker({...}) : undefined;
```
- 内部自己创建 smsBroker，不利于并发管理

**修复后：**
- 接受外部注入的 RegistrationTask
- smsBroker、phoneLease、bindEmail、fetchAddEmailOtp 都由上层调度器提供

### ✅ 问题 4：worker 状态机必须逐步驱动
**修复前：**
```ts
this.updateWorkerStatus(workerId, "registering");
const result = await runCpaRegistration({...});
this.updateWorkerStatus(workerId, "success");
```
- 只是打标签，不是真正状态机

**修复后：**
- 通过 `onStatusChange` 回调逐步驱动状态：
  - acquiring_phone
  - waiting_sms
  - sms_received
  - registering
  - cpa_oauth
  - waiting_email_otp
  - cpa_submit
  - success / failed / timed_out

### ✅ 问题 5：local-db 必须补齐字段
**修复前：**
- worker_slots 缺少 last_error、cancel_reason、retry_count
- 没有 finished_at 字段

**修复后：**
- 添加了以下字段：
```sql
finished_at TEXT,
last_error TEXT,
cancel_reason TEXT,
retry_count INTEGER NOT NULL DEFAULT 0
```
- 终态时自动记录 finished_at

### ✅ 问题 6：tokens.txt 只能作为可选导出产物
**修复前：**
- tokens.txt 作为主存储
- 所有 token 都写入 tokens.txt

**修复后：**
- 数据库（accounts 表）作为主存储
- tokens.txt 只作为可选导出产物
- 只有在指定 --token-out 时才写入文件

---

## 三、修改的文件

### 1. `src/cpa-registration.ts` - 完全重写
**修改内容：**
- 删除了内部创建 smsBroker 的代码
- 定义了 `RegistrationTask` 接口
- 实现了完整的注册闭环（7 个步骤）
- 通过 `onStatusChange` 回调驱动状态机
- 每个步骤都有独立的错误处理和状态更新

### 2. `src/worker-scheduler.ts` - 完全重写
**修改内容：**
- 使用新的 `RegistrationTask` 接口
- 实现了真正的 worker 状态机驱动
- 每个 worker 独立获取号码和邮箱
- 实时更新 worker_slots 和 registration_attempts
- 使用信号量（Semaphore）控制并发
- 失败时自动释放号码

### 3. `src/concurrent-registration.ts` - 完全重写
**修改内容：**
- 删除了所有 TODO 和临时返回
- 实现了完整的并发抢号闭环
- 每个号码独立执行完整注册流程
- 收到验证码后继续完成 CPA/OAuth/token
- 超时自动取消并释放资源
- 成功后写入 accounts 表

### 4. `src/local-db.ts` - 增强
**修改内容：**
- worker_slots 表添加了 4 个新字段：
  - `finished_at TEXT`
  - `last_error TEXT`
  - `cancel_reason TEXT`
  - `retry_count INTEGER`
- updateWorkerSlot() 方法支持新字段
- 终态时自动记录 finished_at

### 5. `src/index.ts` - 更新
**修改内容：**
- 删除了旧的 runCpaRegistration 调用
- 串行模式使用新的 RegistrationTask 接口
- 并发模式使用新的 WorkerScheduler
- 并发抢号模式使用新的 runConcurrentRegistration

---

## 四、设计变更

### 4.1 RegistrationTask 接口
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

### 4.2 Worker 状态机
```
IDLE
  ↓
ACQUIRING_PHONE (获取号码)
  ↓
WAITING_SMS (等待验证码)
  ↓
SMS_RECEIVED (收到验证码)
  ↓
REGISTERING (发起注册)
  ↓
CPA_OAUTH (CPA OAuth 登录)
  ↓
CPA_SUBMIT (提交 callback)
  ↓
WAITING_EMAIL_OTP (等待邮箱 OTP)
  ↓
SUCCESS / FAILED / TIMED_OUT / CANCELLED
```

### 4.3 并发控制
- 使用信号量（Semaphore）控制并发数
- 每个 worker 独立运行完整流程
- 失败时自动释放号码和资源
- 所有状态变化写入数据库

---

## 五、验收标准检查

### ✅ 验收 1：号码与 worker 绑定
- 每个号码都有唯一 workerId
- 不存在号码漂移/复用冲突
- worker_slots 表记录了 phone、activation_id、bind_email

### ✅ 验收 2：邮箱与 worker 绑定
- 每个 worker 有独立 bindEmail
- 不存在邮箱串线
- worker_slots 表记录了 bind_email

### ✅ 验收 3：完整闭环
- 收到验证码后完成了：
  - CPA OAuth ✅
  - callback 提交 ✅
  - auth 文件拉取 ✅
  - access token 获取 ✅

### ✅ 验收 4：数据库可追溯
- 所有 attempt 都写入 registration_attempts ✅
- 所有 worker 都写入 worker_slots ✅
- 所有成功账号都写入 accounts ✅
- 失败原因、取消原因可查 ✅

### ✅ 验收 5：资源可释放
- 超时号码自动取消 ✅
- 失败 worker 自动释放 ✅
- 不遗留挂死资源 ✅

---

## 六、测试命令

### 6.1 串行模式测试
```bash
# 单次执行
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt

# 批量执行
npm run dev -- --workflow codex-cpa-register --count 3 --skip-probe-trial --token-out tokens.txt
```

### 6.2 并发模式测试
```bash
# 3 个 worker，共执行 5 次
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --skip-probe-trial --token-out tokens.txt
```

### 6.3 并发抢号模式测试
```bash
# 同时获取 3 个号码
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

### 6.4 数据库查询测试
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

## 七、还不完美的地方

### 7.1 邮箱准备时机
- 当前在获取号码前准备邮箱
- 如果邮箱准备失败，号码已经获取但会浪费
- 未来可以优化为：先获取号码，再准备邮箱

### 7.2 错误重试机制
- 当前失败后直接标记为 failed
- 未来可以添加自动重试机制（retry_count 字段已预留）

### 7.3 试用探测集成
- 当前跳过了试用探测（skipProbeTrial）
- 未来可以将试用探测集成到完整闭环中

### 7.4 资源池管理
- 当前每次都需要重新获取邮箱
- 未来可以实现邮箱池，预先准备多个邮箱

---

## 八、结论

本次返工成功完成了以下目标：

1. ✅ **并发抢号完整闭环** - 从获取号码到获取 token 的完整流程
2. ✅ **worker/phone/email/attempt 强绑定** - 通过 RegistrationTask 接口实现
3. ✅ **状态机逐步驱动** - 通过 onStatusChange 回调实现
4. ✅ **资源可追溯** - 所有状态变化写入数据库
5. ✅ **资源可释放** - 超时/失败自动取消号码
6. ✅ **去除 TODO** - 所有临时代码已清除

项目已从"半成品骨架"升级到"可验证、可追溯、可释放"的闭环实现。
