# 最终测试指南

## 一、测试前准备

### 1.1 环境检查
```bash
# 检查 Node.js 版本
node --version

# 检查项目是否已构建
npm run build

# 检查配置文件
cat config.json | grep -E "heroSMSApiKey|cliproxyApiBaseUrl"
```

### 1.2 清理旧数据
```bash
# 删除旧的数据库
rm -f data/codex-register.sqlite

# 删除旧的 token 文件
rm -f test_tokens.txt
```

---

## 二、测试命令

### 2.1 基础测试
```bash
# 测试数据库功能
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers
```

### 2.2 串行模式测试
```bash
# 单次串行注册
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial --token-out test_tokens.txt

# 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-list-accounts
```

### 2.3 并发模式测试
```bash
# 3 个 worker，共执行 5 次
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --skip-probe-trial --token-out test_tokens.txt

# 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 2
npm run dev -- --db-list-accounts
```

### 2.4 并发抢号模式测试
```bash
# 同时获取 3 个号码
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 3
npm run dev -- --db-list-accounts
```

---

## 三、验证检查清单

### 3.1 Worker 等待时间
- [ ] Worker 只等待 65 秒
- [ ] 65 秒后未收到验证码，立即释放
- [ ] Worker 状态为 timed_out

### 3.2 巡视器工作
- [ ] 程序运行时，巡视器持续扫描
- [ ] 超过 120 秒的号码，自动释放
- [ ] 程序退出时，巡视器停止

### 3.3 遗留号码清理
- [ ] 上一轮遗留的号码，本轮清理
- [ ] 超过 120 秒的号码，自动释放
- [ ] 程序重新运行时，巡视器继续工作

### 3.4 数据库记录
- [ ] Worker 状态正确记录
- [ ] 失败原因正确记录
- [ ] 运行记录完整

---

## 四、常见问题

### 4.1 号码不可用
**症状：** 报错 NO_NUMBERS
**原因：** HeroSMS 没有可用号码
**解决：** 等待一段时间再试

### 4.2 邮箱准备失败
**症状：** 报错 邮箱准备失败
**原因：** coroabet 服务不可用
**解决：** 检查 config.json 中的 coroabet 配置

### 4.3 CPA 失败
**症状：** 报错 CPA auth-url failed
**原因：** CPA 服务不可用
**解决：** 检查 config.json 中的 cliproxy 配置

### 4.4 SMS 超时
**症状：** Worker 状态为 timed_out
**原因：** 验证码未在 65 秒内到达
**解决：** 这是预期行为，Worker 会自动释放

### 4.5 巡视器没有输出日志
**症状：** 没有看到巡视器日志
**原因：** 没有发现超时号码
**解决：** 这是正常行为，巡视器正常工作

---

## 五、测试脚本

### 5.1 完整测试脚本
```bash
#!/bin/bash

echo "=== 最终测试 ==="
echo ""

echo "1. 清理旧数据..."
rm -f data/codex-register.sqlite
rm -f test_tokens.txt

echo "2. 测试数据库功能..."
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers

echo "3. 测试并发抢号模式..."
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

echo "4. 查看结果..."
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-list-accounts

echo "5. 导出 token..."
npm run dev -- --db-export-tokens exported_tokens.txt
cat exported_tokens.txt

echo "=== 测试完成 ==="
```

### 5.2 运行测试脚本
```bash
# 保存为 test_final.sh
chmod +x test_final.sh

# 运行测试
./test_final.sh
```

---

## 六、监控指标

### 6.1 关键指标
- Worker 等待时间分布
- 65 秒内收到验证码的比例
- Worker 超时率
- 巡视器释放号码数量

### 6.2 告警规则
- Worker 超时率 > 50%
- 巡视器释放号码过多
- 并发数达到上限

### 6.3 日志监控
```bash
# 监控巡视器日志
tail -f output.log | grep "巡视器"

# 监控 Worker 日志
tail -f output.log | grep "worker"
```

---

## 七、测试报告模板

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
| 并发模式 | ✅/❌ | |
| 并发抢号 | ✅/❌ | |
| Worker 等待 65 秒 | ✅/❌ | |
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

## 八、相关文档

- `DOCX/user-guide.md` - 使用指南
- `DOCX/quick-reference.md` - 快速参考卡
- `DOCX/testing-guide.md` - 测试指南
- `DOCX/patrol-testing-guide.md` - 巡视器测试指南
- `DOCX/sms-wait-logic-optimization.md` - SMS 等待逻辑优化说明
- `DOCX/patrol-fix-explanation.md` - 巡视器问题修复说明
