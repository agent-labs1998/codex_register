# 巡视器测试指南

## 一、测试目标

验证巡视器是否正常工作：
1. 程序运行时，巡视器持续扫描所有号码
2. 超过 120 秒的号码，自动释放
3. 程序退出时，巡视器停止
4. 程序重新运行时，巡视器继续工作

---

## 二、测试前准备

### 2.1 环境检查
```bash
# 检查 Node.js 版本
node --version

# 检查项目是否已构建
npm run build

# 检查配置文件
cat config.json | grep -E "heroSMSApiKey|cliproxyApiBaseUrl"
```

### 2.2 清理旧数据
```bash
# 删除旧的数据库
rm -f data/codex-register.sqlite

# 删除旧的 token 文件
rm -f test_tokens.txt
```

---

## 三、测试场景

### 3.1 场景 1：正常流程（65 秒内收到验证码）

**测试命令：**
```bash
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
```

**预期结果：**
- Worker 获取号码
- Worker 等待验证码
- 65 秒内收到验证码
- Worker 继续注册
- 注册成功，保存账号

**验证方法：**
```bash
# 查看运行记录
npm run dev -- --db-list-runs

# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 1

# 查看成功账号
npm run dev -- --db-list-accounts
```

### 3.2 场景 2：超时流程（65 秒后未收到验证码）

**测试命令：**
```bash
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
```

**预期结果：**
- Worker 获取号码
- Worker 等待 65 秒
- 65 秒后未收到验证码
- Worker 立即释放，标记为失败
- 巡视器继续扫描，120 秒后释放号码

**验证方法：**
```bash
# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 1

# 应该看到：
# Worker 状态: timed_out
# 错误信息: SMS wait timeout: 65000ms 内未收到验证码，立即释放 worker
```

### 3.3 场景 3：遗留号码清理

**测试步骤：**
```bash
# 1. 运行程序，获取号码
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 2. 等待 120 秒
sleep 120

# 3. 重新运行程序
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
```

**预期结果：**
- 第一次运行：获取号码，超时，Worker 释放
- 等待 120 秒：巡视器释放号码
- 第二次运行：重新获取号码

**验证方法：**
```bash
# 查看运行记录
npm run dev -- --db-list-runs

# 应该看到 2 条运行记录
```

---

## 四、巡视器日志分析

### 4.1 无日志输出
**原因：**
- 没有发现超时号码
- 所有号码都在 120 秒内

**说明：**
- 这是正常行为，不是 bug
- 巡视器正常工作，只是没有输出

### 4.2 有日志输出
**示例：**
```
[巡视器] 发现超时号码 phone=+573013532725 activationId=498314821 ageMs=125000 -> 尝试取消
[巡视器] cancel activationId=498314821 response=ACCESS_CANCEL
```

**说明：**
- 发现超时号码
- 尝试释放号码
- 释放成功

### 4.3 错误日志
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

## 五、验证检查清单

### 5.1 Worker 等待时间
- [ ] Worker 只等待 65 秒
- [ ] 65 秒后未收到验证码，立即释放
- [ ] Worker 状态为 timed_out

### 5.2 巡视器工作
- [ ] 程序运行时，巡视器持续扫描
- [ ] 超过 120 秒的号码，自动释放
- [ ] 程序退出时，巡视器停止

### 5.3 遗留号码清理
- [ ] 上一轮遗留的号码，本轮清理
- [ ] 超过 120 秒的号码，自动释放
- [ ] 程序重新运行时，巡视器继续工作

### 5.4 数据库记录
- [ ] Worker 状态正确记录
- [ ] 失败原因正确记录
- [ ] 运行记录完整

---

## 六、常见问题

### 6.1 巡视器没有输出日志
**原因：**
- 没有发现超时号码
- 所有号码都在 120 秒内

**解决：**
- 这是正常行为，不是 bug
- 巡视器正常工作，只是没有输出

### 6.2 号码没有被释放
**原因：**
- 号码激活时间不足 120 秒
- HeroSMS API 调用失败
- 网络连接问题

**解决：**
- 等待 120 秒后再检查
- 检查 HeroSMS API 配置
- 检查网络连接

### 6.3 巡视器扫描失败
**原因：**
- HeroSMS API 不可用
- API Key 无效
- 网络连接问题

**解决：**
- 检查 HeroSMS API 配置
- 检查 API Key
- 检查网络连接

---

## 七、测试脚本

### 7.1 完整测试脚本
```bash
#!/bin/bash

echo "=== 巡视器功能测试 ==="
echo ""

echo "1. 清理旧数据..."
rm -f data/codex-register.sqlite
rm -f test_tokens.txt

echo "2. 测试正常流程..."
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

echo "3. 查看运行记录..."
npm run dev -- --db-list-runs

echo "4. 查看 worker 状态..."
npm run dev -- --db-list-workers --run-id 1

echo "5. 查看成功账号..."
npm run dev -- --db-list-accounts

echo "=== 测试完成 ==="
```

### 7.2 运行测试脚本
```bash
# 保存为 test_patrol.sh
chmod +x test_patrol.sh

# 运行测试
./test_patrol.sh
```

---

## 八、监控指标

### 8.1 关键指标
- 巡视器扫描频率
- 巡视器释放号码数量
- 遗留号码清理时间

### 8.2 告警规则
- 巡视器扫描失败
- 巡视器释放号码失败
- 遗留号码过多

### 8.3 日志监控
```bash
# 监控巡视器日志
tail -f output.log | grep "巡视器"
```

---

## 九、测试报告模板

### 测试日期：______

### 测试环境：
- Node.js 版本：______
- 操作系统：______
- 配置文件：______

### 测试结果：
| 测试项 | 状态 | 备注 |
|--------|------|------|
| Worker 等待 65 秒 | ✅/❌ | |
| 65 秒后立即释放 | ✅/❌ | |
| 巡视器扫描 | ✅/❌ | |
| 120 秒后释放号码 | ✅/❌ | |
| 遗留号码清理 | ✅/❌ | |

### 发现的问题：
1. ________________
2. ________________

### 建议：
1. ________________
2. ________________

---

## 十、相关文档

- `DOCX/patrol-fix-explanation.md` - 巡视器问题修复说明
- `DOCX/patrol-working-principle.md` - 巡视器工作原理说明
- `DOCX/sms-wait-logic-optimization.md` - SMS 等待逻辑优化说明
- `DOCX/testing-guide.md` - 测试指南
