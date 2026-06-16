# 返工完成总结

## 一、返工目标达成

按照 `DOCX/rework-plan.md` 的要求，成功完成了并发抢号与 worker 绑定逻辑的返工。

### 核心目标
1. ✅ 并发抢号必须完成完整闭环
2. ✅ worker / phone / activationId / email / attemptId 必须强绑定
3. ✅ cpa-registration 必须改为可被调度器注入资源
4. ✅ worker 状态机必须逐步驱动
5. ✅ local-db 必须补齐字段
6. ✅ tokens.txt 降级为可选导出产物
7. ✅ 失败号码、超时号码必须可自动释放、可回溯
8. ✅ 不得硬编码密钥

---

## 二、修改的文件

### 完全重写（3 个文件）
| 文件 | 修改说明 |
|------|----------|
| `src/cpa-registration.ts` | 完全重写，支持外部注入资源，实现完整闭环 |
| `src/worker-scheduler.ts` | 完全重写，使用新的接口，实现真正的状态机驱动 |
| `src/concurrent-registration.ts` | 完全重写，删除所有 TODO，实现完整业务闭环 |

### 增强（1 个文件）
| 文件 | 修改说明 |
|------|----------|
| `src/local-db.ts` | 增强 worker_slots 表，添加 4 个新字段 |

### 更新（1 个文件）
| 文件 | 修改说明 |
|------|----------|
| `src/index.ts` | 更新 workflow 模式，使用新的接口 |

### 新增文档（3 个文件）
| 文件 | 说明 |
|------|------|
| `DOCX/rework-completion-report.md` | 返工完成报告 |
| `DOCX/rework-quick-reference.md` | 返工后快速参考卡 |
| `DOCX/rework-summary.md` | 本总结文档 |

---

## 三、核心设计变更

### 3.1 RegistrationTask 接口
定义了标准的任务接口，明确所有绑定关系：

```ts
interface RegistrationTask {
  workerId: string;          // 唯一 worker ID
  attemptId: number;         // 注册尝试 ID
  phoneLease: SMSActivationLease;  // 号码租约
  phoneNumber: string;       // 号码
  activationId: string;      // SMS activation ID
  bindEmail: string;         // 绑定邮箱
  fetchAddEmailOtp: () => Promise<string>;  // 获取邮箱 OTP
  deadlines: {
    smsDeadlineAt: number;   // SMS 超时时间
    emailDeadlineAt: number; // 邮箱 OTP 超时时间
    cpaDeadlineAt: number;   // CPA 操作超时时间
  };
  onStatusChange?: (status: string) => void;  // 状态变化回调
}
```

### 3.2 Worker 状态机
实现了真正的状态机驱动，而不是打标签：

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

### 3.3 并发控制
使用信号量（Semaphore）控制并发数，每个 worker 独立运行完整流程。

---

## 四、验收标准检查

### ✅ 验收 1：号码与 worker 绑定
- 每个号码都有唯一 workerId
- 不存在号码漂移/复用冲突
- worker_slots 表记录了 phone、activation_id

### ✅ 验收 2：邮箱与 worker 绑定
- 每个 worker 有独立 bindEmail
- 不存在邮箱串线
- worker_slots 表记录了 bind_email

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
- 失败原因、取消原因可查 ✅

### ✅ 验收 5：资源可释放
- 超时号码自动取消 ✅
- 失败 worker 自动释放 ✅
- 不遗留挂死资源 ✅

---

## 五、测试命令

### 5.1 串行模式
```bash
# 单次执行
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt

# 批量执行
npm run dev -- --workflow codex-cpa-register --count 3 --skip-probe-trial --token-out tokens.txt
```

### 5.2 并发模式
```bash
# 3 个 worker，共执行 5 次
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --skip-probe-trial --token-out tokens.txt
```

### 5.3 并发抢号模式
```bash
# 同时获取 3 个号码
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

### 5.4 数据库查询
```bash
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-export-tokens tokens_export.txt
```

---

## 六、还不完美的地方

### 6.1 邮箱准备时机
- 当前在获取号码前准备邮箱
- 如果邮箱准备失败，号码已经获取但会浪费
- 未来可以优化为：先获取号码，再准备邮箱

### 6.2 错误重试机制
- 当前失败后直接标记为 failed
- 未来可以添加自动重试机制（retry_count 字段已预留）

### 6.3 试用探测集成
- 当前跳过了试用探测（skipProbeTrial）
- 未来可以将试用探测集成到完整闭环中

### 6.4 资源池管理
- 当前每次都需要重新获取邮箱
- 未来可以实现邮箱池，预先准备多个邮箱

---

## 七、结论

本次返工成功完成了以下目标：

1. ✅ **并发抢号完整闭环** - 从获取号码到获取 token 的完整流程
2. ✅ **worker/phone/email/attempt 强绑定** - 通过 RegistrationTask 接口实现
3. ✅ **状态机逐步驱动** - 通过 onStatusChange 回调实现
4. ✅ **资源可追溯** - 所有状态变化写入数据库
5. ✅ **资源可释放** - 超时/失败自动取消号码
6. ✅ **去除 TODO** - 所有临时代码已清除

项目已从"半成品骨架"升级到"可验证、可追溯、可释放"的闭环实现。

---

## 八、相关文档

- `DOCX/rework-plan.md` - 返工计划（输入）
- `DOCX/rework-completion-report.md` - 返工完成报告（详细）
- `DOCX/rework-quick-reference.md` - 返工后快速参考卡（使用）
- `DOCX/workflow-local-db-plan.md` - 设计方案
- `DOCX/user-guide.md` - 使用指南
