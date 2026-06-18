# 功能测试指南

## 一、测试前准备

### 1.1 环境检查
```bash
# 检查 Node.js 版本（需要 22+）
node --version

# 检查 npm 版本
npm --version

# 检查项目是否已构建
npm run build
```

### 1.2 配置检查
```bash
# 检查配置文件是否存在
cat config.json | head -20

# 确认以下配置项已正确设置：
# - heroSMSApiKey
# - cliproxyApiBaseUrl
# - cliproxyApiManagementKey
# - coroabetWorkerDomain
# - coroabetEmailDomain
# - coroabetAdminPassword
```

### 1.3 清理旧数据（可选）
```bash
# 删除旧的数据库（如果需要重新开始）
rm -f data/codex-register.sqlite

# 删除旧的 token 文件
rm -f tokens.txt test_tokens.txt
```

---

## 二、基础功能测试

### 2.1 测试数据库功能
```bash
# 测试 1：查看账号列表（应该为空）
npm run dev -- --db-list-accounts

# 测试 2：查看运行记录（应该为空）
npm run dev -- --db-list-runs

# 测试 3：查看 worker 统计
npm run dev -- --db-list-workers
```

### 2.2 测试配置加载
```bash
# 测试 profile-geo-check（验证配置加载正常）
npm run dev -- --profile-geo-check
```

---

## 三、串行模式测试

### 3.1 单次串行测试
```bash
# 测试 1：单次串行注册
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial --token-out test_tokens.txt

# 测试 2：查看运行记录
npm run dev -- --db-list-runs

# 测试 3：查看 worker 状态
npm run dev -- --db-list-workers --run-id 1

# 测试 4：查看成功账号
npm run dev -- --db-list-accounts

# 测试 5：查看 token 文件
cat test_tokens.txt
```

### 3.2 多次串行测试
```bash
# 测试 1：执行 3 次串行注册
npm run dev -- --workflow codex-cpa-register --count 3 --skip-probe-trial --token-out test_tokens.txt

# 测试 2：查看运行记录
npm run dev -- --db-list-runs

# 测试 3：查看所有尝试
npm run dev -- --db-list-workers --run-id 2

# 测试 4：查看成功账号
npm run dev -- --db-list-accounts

# 测试 5：导出 token
npm run dev -- --db-export-tokens exported_tokens.txt
cat exported_tokens.txt
```

---

## 四、并发模式测试（Worker 调度）

### 4.1 基础并发测试
```bash
# 测试 1：3 个 worker，共执行 5 次
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --skip-probe-trial --token-out test_tokens.txt

# 测试 2：查看运行记录
npm run dev -- --db-list-runs

# 测试 3：查看 worker 状态
npm run dev -- --db-list-workers --run-id 3

# 测试 4：查看成功账号
npm run dev -- --db-list-accounts

# 测试 5：查看统计信息
npm run dev -- --db-list-workers
```

### 4.2 自定义超时测试
```bash
# 测试：自定义超时时间
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 2 \
  --sms-timeout-ms 90000 \
  --email-timeout-ms 60000 \
  --cpa-timeout-ms 45000 \
  --skip-probe-trial \
  --token-out test_tokens.txt

# 查看结果
npm run dev -- --db-list-workers --run-id 4
```

---

## 五、并发抢号模式测试

### 5.1 基础并发抢号测试
```bash
# 测试 1：同时获取 3 个号码
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 测试 2：查看运行记录
npm run dev -- --db-list-runs

# 测试 3：查看 worker 状态（应该看到 3 个 worker）
npm run dev -- --db-list-workers --run-id 5

# 测试 4：查看成功账号
npm run dev -- --db-list-accounts

# 测试 5：查看 token 文件
cat test_tokens.txt
```

### 5.2 并发抢号压力测试
```bash
# 测试：同时获取 5 个号码
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 5 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 查看结果
npm run dev -- --db-list-workers --run-id 6
npm run dev -- --db-list-accounts
```

### 5.3 并发抢号超时测试
```bash
# 测试：设置较短的超时时间
npm run dev -- --workflow codex-cpa-register --count 2 --concurrency 2 --concurrent-pool \
  --sms-timeout-ms 30000 \
  --skip-probe-trial \
  --token-out test_tokens.txt

# 查看超时状态
npm run dev -- --db-list-workers --run-id 7
```

---

## 六、数据库查询测试

### 6.1 查看运行记录
```bash
# 查看所有运行记录
npm run dev -- --db-list-runs

# 预期输出：
# [db] 运行记录 (共 N 条):
#
#   ID: 1
#   Workflow: codex-cpa-register
#   Status: completed/failed/partial
#   Started: 2026-06-16 ...
#   Finished: 2026-06-16 ...
#   Success: X
#   Failure: Y
```

### 6.2 查看 Worker 状态
```bash
# 查看所有 worker 统计
npm run dev -- --db-list-workers

# 查看特定 run 的 worker
npm run dev -- --db-list-workers --run-id 1

# 预期输出：
# [db] Run 1 活跃 workers (共 N 个):
#
#   Worker: worker-001
#   Status: success/failed/timed_out
#   Phone: +57...
#   Email: tmp...@coroabet777.com
#   Started: 2026-06-16 ...
```

### 6.3 查看成功账号
```bash
# 查看所有成功账号
npm run dev -- --db-list-accounts

# 预期输出：
# [db] 账号列表 (共 N 个):
#
#   ID: 1
#   Phone: +57...
#   Email: tmp...@coroabet777.com
#   Status: active
#   Created: 2026-06-16 ...
#   Token: eyJhbGciOiJSUzI1NiIs...
```

### 6.4 导出 Token
```bash
# 导出 token 到文件
npm run dev -- --db-export-tokens exported_tokens.txt

# 查看导出的 token
cat exported_tokens.txt

# 统计 token 数量
wc -l exported_tokens.txt
```

---

## 七、错误场景测试

### 7.1 配置错误测试
```bash
# 测试：缺少 heroSMSApiKey
# 临时修改 config.json，删除 heroSMSApiKey
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial
# 预期：报错 "Missing heroSMSApiKey configuration"

# 恢复配置
```

### 7.2 号码不可用测试
```bash
# 测试：号码不可用时的行为
# 如果 HeroSMS 没有可用号码，应该报错并记录失败
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial

# 查看失败记录
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
```

### 7.3 超时测试
```bash
# 测试：设置极短的超时时间（模拟超时）
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool \
  --sms-timeout-ms 5000 \
  --skip-probe-trial

# 查看超时状态
npm run dev -- --db-list-workers --run-id 1
```

---

## 八、完整测试流程

### 8.1 完整测试脚本
```bash
#!/bin/bash

echo "=== 1. 清理旧数据 ==="
rm -f data/codex-register.sqlite
rm -f test_tokens.txt exported_tokens.txt

echo "=== 2. 测试数据库功能 ==="
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers

echo "=== 3. 测试单次串行 ==="
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial --token-out test_tokens.txt
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-list-accounts

echo "=== 4. 测试多次串行 ==="
npm run dev -- --workflow codex-cpa-register --count 2 --skip-probe-trial --token-out test_tokens.txt
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 2
npm run dev -- --db-list-accounts

echo "=== 5. 测试并发模式 ==="
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 2 --skip-probe-trial --token-out test_tokens.txt
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 3
npm run dev -- --db-list-accounts

echo "=== 6. 测试并发抢号模式 ==="
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 4
npm run dev -- --db-list-accounts

echo "=== 7. 导出 token ==="
npm run dev -- --db-export-tokens exported_tokens.txt
cat exported_tokens.txt

echo "=== 测试完成 ==="
```

### 8.2 运行完整测试
```bash
# 保存为 test.sh
chmod +x test.sh

# 运行测试
./test.sh
```

---

## 九、验证检查清单

### 9.1 基础功能
- [ ] 数据库查询命令正常工作
- [ ] 配置加载正常
- [ ] 项目编译成功

### 9.2 串行模式
- [ ] 单次串行注册成功
- [ ] 多次串行注册成功
- [ ] 运行记录正确
- [ ] 成功账号正确保存
- [ ] Token 文件正确写入

### 9.3 并发模式（Worker 调度）
- [ ] 并发执行正常
- [ ] Worker 状态正确
- [ ] 号码绑定正确
- [ ] 邮箱绑定正确
- [ ] 失败释放正确

### 9.4 并发抢号模式
- [ ] 同时获取多个号码
- [ ] 实时状态写入 DB
- [ ] 先收到验证码优先使用
- [ ] 超时号码自动取消
- [ ] 成功账号正确保存

### 9.5 数据库
- [ ] 运行记录完整
- [ ] Worker 状态完整
- [ ] 尝试记录完整
- [ ] 账号记录完整
- [ ] Token 导出正确

---

## 十、常见问题排查

### 10.1 号码不可用
**症状：** 报错 "NO_NUMBERS" 或 "Numbers Not Found"
**原因：** HeroSMS 没有可用号码
**解决：**
- 等待一段时间再试
- 检查 heroSMSApiKey 是否正确
- 检查 heroSMSCountry 配置

### 10.2 邮箱准备失败
**症状：** 报错 "邮箱准备失败"
**原因：** coroabet 服务不可用
**解决：**
- 检查 coroabetWorkerDomain 配置
- 检查 coroabetAdminPassword 配置
- 检查网络连接

### 10.3 CPA 失败
**症状：** 报错 "CPA auth-url failed" 或 "CPA callback failed"
**原因：** CPA 服务不可用
**解决：**
- 检查 cliproxyApiBaseUrl 配置
- 检查 cliproxyApiManagementKey 配置
- 检查 CPA 服务状态

### 10.4 SMS 超时
**症状：** Worker 状态为 "timed_out"
**原因：** 验证码未在超时时间内到达
**解决：**
- 增加 --sms-timeout-ms 值
- 检查 HeroSMS 服务状态
- 检查网络连接

### 10.5 数据库不存在
**症状：** 报错找不到数据库
**原因：** data/ 目录不存在
**解决：** 程序会自动创建，无需手动处理

---

## 十一、性能测试

### 11.1 并发性能测试
```bash
# 测试不同并发数的性能
time npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 1 --skip-probe-trial --token-out test_tokens.txt
time npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 3 --skip-probe-trial --token-out test_tokens.txt
time npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --skip-probe-trial --token-out test_tokens.txt
```

### 11.2 并发抢号性能测试
```bash
# 测试并发抢号性能
time npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 5 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
```

---

## 十二、测试报告模板

### 测试日期：______

### 测试环境：
- Node.js 版本：______
- 操作系统：______
- 配置文件：______

### 测试结果：
| 测试项 | 状态 | 备注 |
|--------|------|------|
| 数据库查询 | ✅/❌ | |
| 单次串行 | ✅/❌ | |
| 多次串行 | ✅/❌ | |
| 并发模式 | ✅/❌ | |
| 并发抢号 | ✅/❌ | |
| 超时处理 | ✅/❌ | |
| 失败释放 | ✅/❌ | |
| Token 导出 | ✅/❌ | |

### 发现的问题：
1. ________________
2. ________________

### 建议：
1. ________________
2. ________________
