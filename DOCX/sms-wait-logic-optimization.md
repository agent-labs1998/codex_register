# SMS 等待逻辑优化说明

## 一、问题分析

### 之前的问题
- Worker 内部同步等待 SMS 验证码
- 等待时间不明确（15 次轮询）
- Worker 被卡住，无法继续处理其他任务
- 号码释放时机不对（120 秒后才能释放）

### 正确的逻辑
- Worker 只等待 **65 秒**
- 65 秒后未收到验证码 → 立即释放 worker，重新注册新 worker
- 巡视器是独立的，全局扫描，120 秒后释放号码

---

## 二、新的 SMS 等待逻辑

### 2.1 Worker 等待策略
```
Worker 开始等待验证码
  ↓
等待 65 秒
  ↓
收到验证码？ → 是 → 继续注册流程
  ↓
否
  ↓
立即释放 worker
  ↓
重新从零到一注册新 worker
```

### 2.2 巡视器策略（独立运行）
```
巡视器持续扫描所有号码
  ↓
检查每个号码的激活时间
  ↓
超过 120 秒未收到验证码？
  ↓
是 → 释放号码
否 → 继续等待
```

---

## 三、时间设计

### 3.1 Worker 等待时间：65 秒
**选择 65 秒的原因：**
- 足够长：大多数验证码在 60 秒内到达
- 足够短：不会卡住 worker 太久
- 平衡点：在成功率和效率之间取得平衡

### 3.2 巡视器释放时间：120 秒
**选择 120 秒的原因：**
- HeroSMS 限制：需要 120 秒后才能释放号码
- 安全边际：确保号码可以正常释放
- 避免余额浪费：超过 120 秒的号码基本无效

### 3.3 时间对比
| 阶段 | 时间 | 说明 |
|------|------|------|
| Worker 等待 | 65 秒 | Worker 只等待 65 秒 |
| 巡视器释放 | 120 秒 | 120 秒后释放号码 |
| 差值 | 55 秒 | Worker 释放后，巡视器继续等待 55 秒再释放号码 |

---

## 四、代码修改

### 4.1 `src/cpa-registration.ts`
**修改内容：**
- SMS 等待时间改为 65 秒
- 超时后立即返回失败，释放 worker
- 不再调用 `cancelActivation`（由巡视器处理）

**关键代码：**
```ts
const SMS_WAIT_TIMEOUT_MS = 65_000;
const result = await Promise.race([
  phoneLease.waitForVerificationCode().then(v => v.code),
  new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), SMS_WAIT_TIMEOUT_MS);
  }),
]);

if (!result) {
  // 65 秒内未收到验证码，立即释放 worker
  // 号码会在巡视器中 120 秒后释放
  reportStatus("timed_out");
  return {
    status: "failed",
    error: `SMS wait timeout: ${SMS_WAIT_TIMEOUT_MS}ms 内未收到验证码，立即释放 worker`,
  };
}
```

### 4.2 `src/concurrent-registration.ts`
**修改内容：**
- SMS 等待时间改为 65 秒
- 超时后立即返回失败，释放 worker
- 不再调用 `pool.cancelPhone()`（由巡视器处理）

**关键代码：**
```ts
const SMS_WAIT_TIMEOUT_MS = 65_000;

let smsCode: string | null;
try {
  smsCode = await Promise.race([
    lease.waitForVerificationCode().then(v => v.code),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), SMS_WAIT_TIMEOUT_MS);
    }),
  ]);
} catch (error) {
  smsCode = null;
}

if (!smsCode) {
  // 65 秒内未收到验证码，立即释放 worker
  // 号码会在巡视器中 120 秒后释放
  pool.removeLease(phoneLease);

  db.updateWorkerSlot(workerId, {
    status: "timed_out",
    last_error: `SMS wait timeout: ${SMS_WAIT_TIMEOUT_MS}ms 内未收到验证码，立即释放 worker`,
  });

  return {
    success: false,
    error: `SMS wait timeout: ${SMS_WAIT_TIMEOUT_MS}ms 内未收到验证码，立即释放 worker`,
  };
}
```

---

## 五、工作流程

### 5.1 正常流程（收到验证码）
```
1. Worker 获取号码
2. Worker 等待验证码（最多 65 秒）
3. 30 秒后收到验证码
4. Worker 继续注册流程
5. 注册成功，保存账号
6. Worker 释放，处理下一个任务
```

### 5.2 超时流程（未收到验证码）
```
1. Worker 获取号码
2. Worker 等待验证码（最多 65 秒）
3. 65 秒后未收到验证码
4. Worker 立即释放，标记为失败
5. Worker 重新从零到一注册新 worker
6. 巡视器在 120 秒后释放号码
```

### 5.3 并发流程
```
Worker-1: 获取号码 A，等待 65 秒，30 秒后收到验证码，继续注册
Worker-2: 获取号码 B，等待 65 秒，65 秒后未收到，立即释放，重新注册
Worker-3: 获取号码 C，等待 65 秒，45 秒后收到验证码，继续注册
...
巡视器: 持续扫描，120 秒后释放号码 B
```

---

## 六、优势

### 6.1 Worker 不会被卡住
- 65 秒后立即释放
- 可以继续处理下一个任务
- 提高并发效率

### 6.2 资源利用率高
- 失败的 worker 快速释放
- 可以立即重新注册新 worker
- 减少资源浪费

### 6.3 巡视器独立运行
- 不依赖 worker 状态
- 全局扫描，统一管理
- 120 秒后释放无效号码

### 6.4 时间设计合理
- 65 秒足够等待验证码
- 120 秒符合 HeroSMS 限制
- 55 秒的差值确保平滑过渡

---

## 七、测试命令

### 7.1 测试 65 秒超时
```bash
# 运行并发抢号，观察 65 秒后的超时行为
npm run dev -- --workflow codex-cpa-register --count 2 --concurrency 2 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 1
```

### 7.2 验证超时逻辑
```bash
# 如果 65 秒内未收到验证码，应该看到：
# Worker 状态: timed_out
# 错误信息: SMS wait timeout: 65000ms 内未收到验证码，立即释放 worker
```

### 7.3 验证巡视器
```bash
# 巡视器会持续运行，120 秒后释放号码
# 可以在日志中看到巡视器的释放记录
```

---

## 八、配置建议

### 8.1 SMS 等待时间
- **当前值：** 65 秒
- **可调整范围：** 30-90 秒
- **建议：** 根据实际情况调整

### 8.2 巡视器释放时间
- **当前值：** 120 秒
- **HeroSMS 限制：** 120 秒
- **建议：** 保持 120 秒

### 8.3 并发数
- **建议：** 根据服务器性能调整
- **默认值：** 3
- **可调整范围：** 1-10

---

## 九、监控指标

### 9.1 关键指标
- Worker 等待时间分布
- 65 秒内收到验证码的比例
- Worker 超时率
- 巡视器释放号码数量

### 9.2 告警规则
- Worker 超时率 > 50%
- 巡视器释放号码过多
- 并发数达到上限

---

## 十、总结

### 10.1 核心改进
- Worker 只等待 65 秒
- 超时后立即释放 worker
- 巡视器独立运行，120 秒后释放号码

### 10.2 优势
- Worker 不会被卡住
- 资源利用率高
- 时间设计合理
- 逻辑清晰简单

### 10.3 测试要点
- 验证 65 秒超时逻辑
- 验证 worker 释放逻辑
- 验证巡视器释放逻辑
- 验证并发效率提升
