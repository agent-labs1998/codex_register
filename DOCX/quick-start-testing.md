# 快速开始测试

## 一、一键测试

### 1.1 清理并测试
```bash
# 清理旧数据
rm -f data/codex-register.sqlite
rm -f test_tokens.txt

# 运行测试
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
```

### 1.2 查看结果
```bash
# 查看运行记录
npm run dev -- --db-list-runs

# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 1

# 查看成功账号
npm run dev -- --db-list-accounts

# 查看 token
cat test_tokens.txt
```

---

## 二、测试命令速查

### 2.1 基础测试
```bash
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers
```

### 2.2 并发抢号测试
```bash
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
```

### 2.3 查看结果
```bash
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-list-accounts
```

---

## 三、验证要点

### 3.1 Worker 等待时间
- Worker 只等待 65 秒
- 65 秒后未收到验证码，立即释放
- Worker 状态为 timed_out

### 3.2 巡视器工作
- 程序运行时，巡视器持续扫描
- 超过 120 秒的号码，自动释放
- 程序退出时，巡视器停止

### 3.3 数据库记录
- Worker 状态正确记录
- 失败原因正确记录
- 运行记录完整

---

## 四、常见问题

### 4.1 号码不可用
**症状：** 报错 NO_NUMBERS
**解决：** 等待一段时间再试

### 4.2 SMS 超时
**症状：** Worker 状态为 timed_out
**解决：** 这是预期行为，Worker 会自动释放

### 4.3 巡视器没有输出日志
**症状：** 没有看到巡视器日志
**解决：** 这是正常行为，巡视器正常工作

---

## 五、相关文档

- `DOCX/final-testing-guide.md` - 最终测试指南
- `DOCX/all-optimizations-summary.md` - 所有优化完成总结
- `DOCX/user-guide.md` - 使用指南
- `DOCX/quick-reference.md` - 快速参考卡
