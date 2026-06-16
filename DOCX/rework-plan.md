# 并发抢号返工审查报告

## 一、总体结论

当前工业化升级已经完成了**骨架和数据库层**，但“并发抢号”部分还**不成熟**，不能直接当成稳定生产功能使用。

当前状态更准确的描述是：

- `workflow + SQLite`：✅ 基本可用
- `worker-scheduler`：⚠️ 半成熟，绑定/状态机不够完整
- `concurrent-registration`：❌ 未闭环，有明显 TODO
- `local-db`：✅ 结构可用，但仍需和业务强绑定
- `cpa-registration`：✅ 单条链路可用，但需要被上层正确调度

---

## 二、逐文件审查

## 1. `src/concurrent-registration.ts`

### 结论：**半成品，不能直接上线**

### 关键问题

#### 问题 1：注册流程没有真正闭合
代码里存在明显 TODO：

```ts
return ""; // 临时返回，后续会替换
const chatgptAccessToken = ""; // TODO: 从 client 获取
email: "", // TODO: 从邮箱 provider 获取
```

这意味着：

- 收到验证码后，没有继续完成 CPA OAuth
- 没有完成邮箱绑定
- 没有完成 CPA 入库
- 没有拿到 access token
- 没有回写 worker/email 信息

#### 问题 2：注册发起方式不合理
当前代码直接用空 OTP 回调发起注册：

```ts
await client.authPhoneSignupHTTP(phoneLease.phoneNumber, async () => {
  return "";
});
```

这不符合 OpenAI 注册真实流程。当前版本不能真正完成一次完整业务。

#### 问题 3：缺少邮箱绑定
并发抢号当前完全没有把 `bindEmail` / `fetchAddEmailOtp` 绑进去。CPA 模式必须有邮箱绑定，否则后续 OAuth 会失败。

#### 问题 4：缺少 worker 绑定
虽然有 phoneLease，但没有看到：

```text
workerId -> phoneLease
workerId -> bindEmail
workerId -> attemptId
workerId -> result
```

只做到“号码池”不算并发抢号，最多算并发取号。

#### 问题 5：结果回写不完整
当前只写 token 文件，没有稳定回写：

- `registration_attempts`
- `accounts`
- `worker_slots`

---

## 2. `src/worker-scheduler.ts`

### 结论：**调度壳子有了，但调度深度不足**

### 关键问题

#### 问题 1：worker 状态机只更新了表象
虽然有：

```ts
this.updateWorkerStatus(workerId, "registering");
```

但实际注册是由：

```ts
runCpaRegistration(...)
```

一次性完成的，worker 并没有真正逐步驱动以下阶段：

- acquiring_phone
- registering
- waiting_sms
- sms_received
- cpa_oauth
- waiting_email_otp
- email_otp_received
- cpa_submit
- success

当前更像是“状态标签”，不是真正状态机。

#### 问题 2：资源绑定不强
`runWorker()` 里创建了 `attemptId`，但实际号码、邮箱、activationId 是后面 `runCpaRegistration()` 内部自生的，不会实时回写到 `worker_slots`。

所以会出现：

```text
DB 里有 worker
DB 里有 attempt
但 worker 和 attempt 的绑定关系不是闭环驱动出来的
```

#### 问题 3：调度循环不够稳
当前调度循环是：

```ts
while (taskIndex < this.config.count) {
  ...
  await new Promise(r => setTimeout(r, 100));
}
```

这种轮询式调度容易出现：

- 活跃 worker 判定不精确
- 任务空转
- 难以扩展成真正的任务队列

建议改成标准的 task queue + semaphore。

---

## 3. `src/local-db.ts`

### 结论：**数据结构可用，但仍缺几个关键字段**

### 关键问题

#### 问题 1：`worker_slots` 和 `registration_attempts` 绑定不够
现在虽然有 `attempt_id`，但没有稳定维护以下关键字段：

- `activation_id`
- `bind_email`
- `sms_deadline_at`
- `email_deadline_at`

导致后续排查并发出错时很难还原真相。

#### 问题 2：`accounts` 表设计不够安全
当前 `access_token` 直接明文存储。  
短期开发可以先接受，但生产环境必须改：

- 加密存储
- 或至少支持 token 引用、token 文件分离

#### 问题 3：缺少错误历史字段
当前 `worker_slots` 没有：

- `last_error`
- `cancel_reason`
- `retry_count`

并发场景下这些字段非常关键。

---

## 4. `src/cpa-registration.ts`

### 结论：**单条链路可用，但不适合作为并发基础直接复用**

### 关键问题

#### 问题 1：内部再次创建 smsBroker
当前函数里自己又创建了一套 sms broker：

```ts
const smsBroker = appConfig.heroSMSApiKey ? createSMSBroker({...}) : undefined;
```

这意味着：

- 外部调度器难以统一管理号码生命周期
- 不利于 worker 把号码/邮箱绑定写进 DB

并发场景下，资源获取应该是上层统一调度，不是函数内部自己偷偷创建。

#### 问题 2：没有接收外部 workerId / attemptId
当前函数签名是：

```ts
runCpaRegistration(options)
```

但没有：

```ts
workerId
attemptId
phoneLease
bindEmail
```

所以它更像是“可独立跑的脚本模块”，不是“可被并发调度器精确驱动的业务单元”。

---

## 三、最需要返工的 6 件事

## Rework 1：先定义“并发注册任务单元”的接口

不要直接继续改散代码。先定一个标准任务接口：

```ts
interface RegistrationTask {
  workerId: string;
  attemptId: number;
  phoneLease: PhoneLease;
  bindEmail: string;
  fetchAddEmailOtp: () => Promise<string>;
  deadlines: {
    smsDeadlineAt: number;
    emailDeadlineAt: number;
    cpaDeadlineAt: number;
  };
}
```

---

## Rework 2：把 `runCpaRegistration()` 改成可注入资源

现在它是“自己拿号码、自己拿邮箱、自己创建 broker”，这会导致并发混乱。

应改成接受外部注入：

- smsBroker
- phoneLease
- bindEmail
- fetchAddEmailOtp
- workerId
- attemptId

这样调度器才能真正控制“哪个 worker 用哪个号码/邮箱”。

---

## Rework 3：把 worker 状态机做成真实驱动

不要只写：

```ts
this.updateWorkerStatus(workerId, "registering");
this.updateWorkerStatus(workerId, "success");
```

而要逐步驱动：

```text
acquiring_phone
registering
waiting_sms
sms_received
cpa_oauth
waiting_email_otp
cpa_submit
success / failed / timed_out / cancelled
```

并且每一步都写入 DB：

- `worker_slots`
- `registration_attempts`

---

## Rework 4：补齐并发抢号闭环

当前 `concurrent-registration.ts` 的 TODO 必须清掉：

- 完成 OTP 后继续 CPA OAuth
- 完成邮箱绑定
- 完成 CPA callback
- 完成 auth 文件拉取
- 完成 access token 获取
- 回写 attempt / account / worker

并发抢号只有做到这里才算闭环。

---

## Rework 5：把 `worker_slots` 改成真正的绑定记录

当前更像是“展示层”。

必须补强为：

```sql
worker_id
run_id
attempt_id
phone
activation_id
bind_email
status
last_error
cancel_reason
sms_deadline_at
email_deadline_at
started_at
finished_at
```

---

## Rework 6：把 `tokens.txt` 降级为可选导出产物

数据库应该是主存储。  
`tokens.txt` 只保留为：

```text
兼容输出 / 人工快速检查 / 外部脚本临时读取
```

不应再作为主数据存储。

---

## 四、建议返工顺序

## 第 1 轮：先修结构，不急着加并发花样

1. 定义 `RegistrationTask` 接口
2. 改造 `cpa-registration.ts` 支持外部注入资源
3. 改造 `worker-scheduler.ts` 使用新接口

---

## 第 2 轮：补齐 worker 绑定

1. worker_slots 增强字段
2. 每个 worker 绑定 phone/email/attempt/result
3. 所有状态变化写 DB

---

## 第 3 轮：重做并发抢号模块

1. 基于 phoneLease 调度
2. 每个 worker 独立执行完整闭环
3. 收到验证码后继续完成 CPA/OAuth/token
4. 超时取消并释放
5. 成功写 accounts

---

## 五、验收标准

只有满足以下标准，才能叫“并发抢号完成”：

### 验收 1：号码与 worker 绑定
```text
每个号码必须有唯一 workerId
不能出现号码漂移/复用冲突
```

### 验收 2：邮箱与 worker 绑定
```text
每个 worker 有独立 bindEmail
不能出现邮箱串线
```

### 验收 3：完整闭环
```text
收到验证码后必须完成：
- CPA OAuth
- callback 提交
- auth 文件拉取
- access token 获取
```

### 验收 4：数据库可追溯
```text
所有 attempt / worker / account 都应写入 DB
失败原因、取消原因可查
```

### 验收 5：资源可释放
```text
超时号码自动取消
失败 worker 自动释放
不遗留挂死资源
```

---

## 六、一句话结论

当前项目已经完成了“能记录、能调度”的骨架，  
但**并发抢号还没真正完成业务闭环**，  
下一步必须返工：

- `concurrent-registration.ts`
- `worker-scheduler.ts`
- `cpa-registration.ts`
- `local-db.ts`

重点只有一个：

**把 worker / phone / email / attempt / result 做成强绑定闭环。**
