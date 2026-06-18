# 巡视器工作原理说明

## 一、巡视器概述

### 1.1 巡视器职责
- 持续扫描所有号码
- 检查每个号码的激活时间
- 超过 120 秒未收到验证码的号码，自动释放

### 1.2 巡视器特点
- 独立运行，不依赖 Worker 状态
- 全局扫描，统一管理
- 程序运行期间持续工作
- 程序退出时停止

---

## 二、巡视器工作流程

### 2.1 启动流程
```
程序启动
  ↓
main() 函数调用 startHeroSmsPatrolLoop()
  ↓
巡视器开始工作
  ↓
每 10 秒扫描一次所有号码
```

### 2.2 扫描流程
```
巡视器扫描
  ↓
获取所有活跃号码（fetchAllActiveActivations）
  ↓
遍历每个号码
  ↓
检查激活时间
  ↓
超过 120 秒？
  ↓
是 → 释放号码（cancelActivationById）
否 → 继续等待
```

### 2.3 释放流程
```
发现超时号码
  ↓
调用 HeroSMS API 释放号码
  ↓
检查响应
  ↓
ACCESS_CANCEL / ACCESS_READY / OTP_RECEIVED / NO_ACTIVATION
  ↓
释放成功
```

---

## 三、巡视器代码结构

### 3.1 主要函数
```ts
startHeroSmsPatrolLoop()  // 启动巡视器
patrolOnce()              // 执行一次扫描
fetchAllActiveActivations()  // 获取所有活跃号码
cancelActivationById()    // 释放号码
```

### 3.2 关键参数
```ts
const POLL_INTERVAL_MS = 10_000;  // 扫描间隔：10 秒
const SMS_RELEASE_MS = 120_000;   // 释放时间：120 秒
```

### 3.3 工作循环
```ts
while (running) {
    try {
        await patrolOnce(apiKey, SMS_RELEASE_MS);
    } catch (error) {
        console.warn(`[巡视器] patrol failed: ${(error as Error).message}`);
    }
    await delay(POLL_INTERVAL_MS);
}
```

---

## 四、巡视器日志输出

### 4.1 正常扫描（无超时号码）
```
# 巡视器不会输出日志
# 因为没有发现超时号码
```

### 4.2 发现超时号码
```
[巡视器] 发现超时号码 phone=+573013532725 activationId=498314821 ageMs=125000 -> 尝试取消
[巡视器] cancel activationId=498314821 response=ACCESS_CANCEL
```

### 4.3 扫描失败
```
[巡视器] patrol failed: 请求失败
```

---

## 五、测试巡视器

### 5.1 测试方法 1：观察日志
```bash
# 运行程序，观察巡视器日志
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 如果有超时号码，应该看到：
# [巡视器] 发现超时号码 phone=+xxx activationId=xxx ageMs=xxx -> 尝试取消
```

### 5.2 测试方法 2：检查号码状态
```bash
# 1. 运行程序，获取号码
# 2. 等待 120 秒
# 3. 检查号码是否被释放
# 4. 登录 HeroSMS 平台查看号码状态
```

### 5.3 测试方法 3：模拟超时
```bash
# 1. 运行程序，获取号码
# 2. 不要等待验证码
# 3. 等待 120 秒
# 4. 查看巡视器是否释放号码
```

---

## 六、巡视器与 Worker 的关系

### 6.1 Worker 等待策略
- Worker 只等待 65 秒
- 65 秒后未收到验证码 → 立即释放 worker
- Worker 继续处理下一个任务

### 6.2 巡视器策略
- 巡视器每 10 秒扫描一次
- 超过 120 秒的号码，自动释放
- 巡视器独立运行，不依赖 Worker

### 6.3 协作关系
```
Worker 获取号码
  ↓
Worker 等待 65 秒
  ↓
65 秒后未收到验证码
  ↓
Worker 释放，继续下一个任务
  ↓
巡视器继续扫描
  ↓
120 秒后释放号码
```

---

## 七、巡视器日志分析

### 7.1 无日志输出
**原因：**
- 没有发现超时号码
- 所有号码都在 120 秒内
- 巡视器正常工作，只是没有输出

**验证：**
- 程序运行期间，巡视器每 10 秒扫描一次
- 如果没有超时号码，不会输出日志
- 这是正常行为，不是 bug

### 7.2 有日志输出
**示例：**
```
[巡视器] 发现超时号码 phone=+573013532725 activationId=498314821 ageMs=125000 -> 尝试取消
[巡视器] cancel activationId=498314821 response=ACCESS_CANCEL
```

**说明：**
- 发现超时号码
- 尝试释放号码
- 释放成功

### 7.3 错误日志
**示例：**
```
[巡视器] patrol failed: 请求失败
[巡视器] cancel activationId=498314821 failed=网络错误
```

**说明：**
- 巡视器扫描失败
- 号码释放失败
- 需要检查网络连接

---

## 八、巡视器配置

### 8.1 扫描间隔
```ts
const POLL_INTERVAL_MS = 10_000;  // 10 秒
```

**说明：**
- 每 10 秒扫描一次所有号码
- 可以根据需要调整

### 8.2 释放时间
```ts
const SMS_RELEASE_MS = 120_000;  // 120 秒
```

**说明：**
- 超过 120 秒的号码，自动释放
- 符合 HeroSMS 的限制

### 8.3 API 地址
```ts
const HERO_SMS_API_BASE = "https://hero-sms.com/stubs/handler_api.php";
```

---

## 九、巡视器 API

### 9.1 获取活跃号码
```ts
fetchAllActiveActivations(apiKey: string): Promise<ActiveActivationSnapshot[]>
```

**说明：**
- 获取所有活跃号码
- 返回号码列表

### 9.2 释放号码
```ts
cancelActivationById(apiKey: string, activationId: string): Promise<void>
```

**说明：**
- 释放指定号码
- 调用 HeroSMS API

### 9.3 HeroSMS API 响应
- `ACCESS_CANCEL` - 释放成功
- `ACCESS_READY` - 号码已准备
- `OTP_RECEIVED` - 已收到验证码
- `NO_ACTIVATION` - 号码不存在

---

## 十、巡视器监控

### 10.1 关键指标
- 巡视器扫描频率
- 巡视器释放号码数量
- 巡视器扫描失败次数

### 10.2 告警规则
- 巡视器扫描失败
- 巡视器释放号码失败
- 巡视器扫描间隔过长

### 10.3 日志监控
```bash
# 监控巡视器日志
tail -f output.log | grep "巡视器"
```

---

## 十一、常见问题

### 11.1 巡视器没有输出日志
**原因：**
- 没有发现超时号码
- 所有号码都在 120 秒内

**解决：**
- 这是正常行为，不是 bug
- 巡视器正常工作，只是没有输出

### 11.2 号码没有被释放
**原因：**
- 号码激活时间不足 120 秒
- HeroSMS API 调用失败
- 网络连接问题

**解决：**
- 等待 120 秒后再检查
- 检查 HeroSMS API 配置
- 检查网络连接

### 11.3 巡视器扫描失败
**原因：**
- HeroSMS API 不可用
- API Key 无效
- 网络连接问题

**解决：**
- 检查 HeroSMS API 配置
- 检查 API Key
- 检查网络连接

---

## 十二、总结

### 12.1 巡视器特点
- 独立运行，不依赖 Worker
- 全局扫描，统一管理
- 120 秒后释放号码
- 程序运行期间持续工作

### 12.2 巡视器日志
- 无日志输出：正常行为，没有超时号码
- 有日志输出：发现超时号码，正在释放
- 错误日志：扫描或释放失败

### 12.3 巡视器配置
- 扫描间隔：10 秒
- 释放时间：120 秒
- API 地址：HeroSMS API

---

## 十三、测试建议

### 13.1 测试场景
1. 正常流程：65 秒内收到验证码
2. 超时流程：65 秒后未收到验证码
3. 遗留号码：程序退出后重新运行

### 13.2 测试命令
```bash
# 测试巡视器
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 观察巡视器日志
# 应该看到：[巡视器] 发现超时号码 phone=+xxx activationId=xxx ageMs=xxx -> 尝试取消
```

### 13.3 验证方法
1. 运行程序，获取号码
2. 等待 120 秒
3. 检查号码是否被释放
4. 登录 HeroSMS 平台查看号码状态
