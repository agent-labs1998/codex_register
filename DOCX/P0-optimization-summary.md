# P0 优化完成总结

## 一、P0 目标完成情况

### ✅ 1. 并发抢号实时状态追踪
**状态：已完成**

**修改内容：**
- 修改 `src/concurrent-registration.ts`，接受 db 和 runId 参数
- 在每个阶段实时写入 worker_slots 和 registration_attempts
- 从"最终结果阶段写 DB"改为"过程状态实时写 DB"

**状态流转：**
```
idle → acquiring_phone → waiting_sms → sms_received
  → preparing_email → registering → cpa_oauth → cpa_submit
  → waiting_email_otp → success / failed / timed_out
```

**实时写入的字段：**
- worker_id, status, phone, activation_id, bind_email
- sms_deadline_at, email_deadline_at
- last_error, cancel_reason, finished_at

### ✅ 2. 并发实现统一方案
**状态：已明确**

**决策：** 保留两套实现，明确各自使用场景

| 模式 | 文件 | 使用场景 |
|------|------|----------|
| Worker 调度模式 | `worker-scheduler.ts` | 每个 worker 独立获取号码，并行执行注册 |
| 并发抢号模式 | `concurrent-registration.ts` | 并行获取号码，并行执行注册 |

**推荐：** 使用并发抢号模式（`--concurrent-pool`）

### ⏳ 3. 并发抢号稳定性验证
**状态：需要真实测试**

**测试命令：**
```bash
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

**验证重点：**
- 号码绑定：每个号码有唯一 workerId
- 邮箱绑定：每个 worker 有独立 bindEmail
- 失败释放：超时号码自动取消
- DB 写入：所有状态实时写入数据库

---

## 二、修改的文件

### 2.1 `src/concurrent-registration.ts`
**修改：**
- 接受 db 和 runId 参数
- 实时写入 worker_slots 和 registration_attempts
- 每个状态变化都立即更新数据库

### 2.2 `src/index.ts`
**修改：**
- 传递 db 和 runId 给 runConcurrentRegistration
- 简化结果统计逻辑

---

## 三、验收标准检查

### ✅ 验收 1：worker 过程状态能实时写入 DB
- 代码已实现
- 需要真实测试验证

### ✅ 验收 2：能通过数据库查询定位到每个 worker 的真实状态
- 代码已实现
- 使用 `--db-list-workers --run-id <id>` 查看

### ✅ 验收 3：超时号码能自动取消
- 代码已实现
- 超时后状态变为 timed_out

### ✅ 验收 4：成功账号能正确写入 accounts
- 代码已实现
- 使用 `--db-list-accounts` 查看

### ✅ 验收 5：不再出现 TODO / 空返回 / 半成品逻辑
- 所有 TODO 已删除
- 完整执行注册闭环

---

## 四、测试建议

### 4.1 基础测试
```bash
# 测试 1 次并发抢号
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out tokens.txt

# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 1

# 查看运行记录
npm run dev -- --db-list-runs
```

### 4.2 并发测试
```bash
# 测试 3 个并发
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out tokens.txt

# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 2
```

### 4.3 超时测试
```bash
# 设置较短的超时时间
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --sms-timeout-ms 30000 --skip-probe-trial --token-out tokens.txt

# 查看超时状态
npm run dev -- --db-list-workers --run-id 3
```

---

## 五、关键代码变更

### 5.1 接口定义
```ts
export interface ConcurrentRegistrationOptions {
  concurrency: number;
  smsTimeoutMs: number;
  emailTimeoutMs: number;
  cpaTimeoutMs: number;
  skipProbeTrial: boolean;
  tokenOutPath: string;
  db: LocalDB;      // 新增
  runId: number;    // 新增
}
```

### 5.2 实时状态更新
```ts
// 获取号码成功
db.updateWorkerSlot(workerId, {
  phone: phoneNumber,
  activation_id: activationId,
  status: "waiting_sms",
  sms_deadline_at: new Date(Date.now() + smsTimeoutMs).toISOString(),
});

// 收到验证码
db.updateWorkerSlot(workerId, { status: "sms_received" });

// CPA OAuth
db.updateWorkerSlot(workerId, { status: "cpa_oauth" });

// 成功
db.updateWorkerSlot(workerId, { status: "success" });
db.updateAttempt(attemptId, {
  status: "ok",
  cpa_auth_file: latest.name,
  finished_at: new Date().toISOString(),
});

// 保存账号
db.saveAccount({
  phone: phoneNumber,
  email: bindEmail,
  password,
  access_token: tok,
  cpa_auth_file: latest.name,
  cpa_base_url: cpaBase,
  status: "active",
});
```

---

## 六、两套并发逻辑对比

### 6.1 Worker 调度模式
```bash
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --token-out tokens.txt
```

**特点：**
- 每个 worker 独立获取号码
- 并行执行注册
- 适合稳定的批量注册

### 6.2 并发抢号模式
```bash
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --concurrent-pool --token-out tokens.txt
```

**特点：**
- 并行获取号码
- 先收到验证码的优先使用
- 适合号码稀缺、需要快速抢号

---

## 七、下一步

### P1 优化（第二轮）
1. worker 状态机继续收敛
2. 失败回收进一步增强
3. tokens.txt 进一步弱化

### P2 优化（后续）
1. 邮箱申请时机优化
2. 邮箱池/复用机制
3. 并发抢号更复杂策略

---

## 八、结论

P0 优化已完成：
1. ✅ 并发抢号实时状态追踪 - 所有状态实时写入 DB
2. ✅ 并发实现统一方案 - 保留两套实现，明确使用场景
3. ⏳ 并发抢号稳定性验证 - 需要真实测试 5~10 次

项目已从"最终结果阶段写 DB"升级到"过程状态实时写 DB"，可追溯性大幅提升。

---

## 九、测试验证清单

- [ ] 运行 1 次并发抢号，验证实时状态写入
- [ ] 运行 3 次并发抢号，验证并发控制
- [ ] 查看 worker 状态，验证状态流转
- [ ] 查看运行记录，验证统计正确
- [ ] 查看成功账号，验证账号保存
- [ ] 测试超时场景，验证号码取消
- [ ] 测试失败场景，验证错误记录
