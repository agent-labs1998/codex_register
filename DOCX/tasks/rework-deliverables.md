# 返工交付物清单

## 一、修复后的源码

### 完全重写的文件
1. **src/cpa-registration.ts**
   - 支持外部注入资源（RegistrationTask 接口）
   - 完整执行 7 个步骤的注册闭环
   - 通过 onStatusChange 回调驱动状态机
   - 每个步骤都有独立的错误处理

2. **src/worker-scheduler.ts**
   - 使用新的 RegistrationTask 接口
   - 实现真正的 worker 状态机驱动
   - 每个 worker 独立获取号码和邮箱
   - 实时更新 worker_slots 和 registration_attempts
   - 使用信号量控制并发
   - 失败时自动释放号码

3. **src/concurrent-registration.ts**
   - 删除所有 TODO 和临时返回
   - 完整执行注册闭环
   - 每个号码独立运行完整流程
   - 超时自动取消并释放资源
   - 成功后写入 accounts 表

### 增强的文件
4. **src/local-db.ts**
   - worker_slots 表添加 4 个新字段：
     - finished_at
     - last_error
     - cancel_reason
     - retry_count
   - updateWorkerSlot() 支持新字段
   - 终态时自动记录 finished_at

### 更新的文件
5. **src/index.ts**
   - 串行模式使用新的 RegistrationTask 接口
   - 并发模式使用新的 WorkerScheduler
   - 并发抢号模式使用新的 runConcurrentRegistration

---

## 二、更新后的文档

### 新增文档
1. **DOCX/rework-completion-report.md**
   - 返工完成报告
   - 已修复的问题
   - 设计变更
   - 验收标准检查
   - 测试命令

2. **DOCX/rework-quick-reference.md**
   - 返工后快速参考卡
   - 使用命令
   - 数据库结构
   - Worker 状态机详解

3. **DOCX/rework-summary.md**
   - 返工总结
   - 核心设计变更
   - 还不完美的地方

4. **DOCX/rework-deliverables.md**
   - 本交付物清单

### 更新文档
5. **DOCX/接手清单.md**
   - 标记返工完成
   - 添加返工内容引用

6. **DOCX/docs-index.md**
   - 添加新文档引用
   - 更新更新历史

---

## 三、可执行的测试命令

### 3.1 串行模式
```bash
# 单次执行
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt

# 批量执行
npm run dev -- --workflow codex-cpa-register --count 3 --skip-probe-trial --token-out tokens.txt
```

### 3.2 并发模式
```bash
# 3 个 worker，共执行 5 次
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --skip-probe-trial --token-out tokens.txt
```

### 3.3 并发抢号模式
```bash
# 同时获取 3 个号码
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

### 3.4 数据库查询
```bash
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-export-tokens tokens_export.txt
```

---

## 四、已修复的问题

### ✅ 问题 1：并发抢号必须完成完整闭环
- 删除所有 TODO 和临时返回
- 完整执行：准备邮箱 → 等待 SMS → phone signup → CPA OAuth → callback → auth 文件 → access token

### ✅ 问题 2：worker/phone/email/attempt 必须强绑定
- 定义 RegistrationTask 接口
- 每个步骤都实时更新 worker_slots 和 registration_attempts

### ✅ 问题 3：cpa-registration 必须支持外部注入资源
- 不再内部创建 smsBroker
- 接受外部注入的 RegistrationTask

### ✅ 问题 4：worker 状态机必须逐步驱动
- 通过 onStatusChange 回调逐步驱动状态
- 每个步骤都写入数据库

### ✅ 问题 5：local-db 必须补齐字段
- 添加 finished_at、last_error、cancel_reason、retry_count

### ✅ 问题 6：tokens.txt 降级为可选导出产物
- 数据库作为主存储
- tokens.txt 只在指定 --token-out 时写入

### ✅ 问题 7：失败号码必须可自动释放
- 超时自动取消号码
- 失败自动释放资源

### ✅ 问题 8：不得硬编码密钥
- 所有敏感信息来自 config.json / 环境变量 / CLI 参数

---

## 五、设计变更说明

### 5.1 RegistrationTask 接口
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

### 5.2 Worker 状态机
```
IDLE → ACQUIRING_PHONE → WAITING_SMS → SMS_RECEIVED
  → REGISTERING → CPA_OAUTH → CPA_SUBMIT
  → WAITING_EMAIL_OTP → SUCCESS / FAILED / TIMED_OUT
```

### 5.3 并发控制
- 使用信号量（Semaphore）控制并发数
- 每个 worker 独立运行完整流程
- 失败时自动释放号码和资源

---

## 六、验收标准检查

### ✅ 验收 1：号码与 worker 绑定
- 每个号码都有唯一 workerId
- 不存在号码漂移/复用冲突

### ✅ 验收 2：邮箱与 worker 绑定
- 每个 worker 有独立 bindEmail
- 不存在邮箱串线

### ✅ 验收 3：完整闭环
收到验证码后完成了：
- CPA OAuth ✅
- callback 提交 ✅
- auth 文件拉取 ✅
- access token 获取 ✅

### ✅ 验收 4：数据库可追溯
- 所有 attempt 都写入 registration_attempts ✅
- 所有 worker 都写入 worker_slots ✅
- 所有成功账号都写入 accounts ✅

### ✅ 验收 5：资源可释放
- 超时号码自动取消 ✅
- 失败 worker 自动释放 ✅

---

## 七、还不完美的地方

### 7.1 邮箱准备时机
- 当前在获取号码前准备邮箱
- 如果邮箱准备失败，号码会浪费
- 未来可以优化为：先获取号码，再准备邮箱

### 7.2 错误重试机制
- 当前失败后直接标记为 failed
- 未来可以添加自动重试机制（retry_count 字段已预留）

### 7.3 试用探测集成
- 当前跳过了试用探测
- 未来可以集成到完整闭环中

### 7.4 资源池管理
- 当前每次都需要重新获取邮箱
- 未来可以实现邮箱池

---

## 八、结论

本次返工成功完成了以下目标：

1. ✅ 并发抢号完整闭环
2. ✅ worker/phone/email/attempt 强绑定
3. ✅ 状态机逐步驱动
4. ✅ 资源可追溯
5. ✅ 资源可释放
6. ✅ 去除 TODO

项目已从"半成品骨架"升级到"可验证、可追溯、可释放"的闭环实现。
