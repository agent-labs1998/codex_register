# Codex-Register 工业化升级完成总结

## 已完成的 3 个阶段

### 第 1 阶段：workflow + SQLite ✅
**新增文件：**
- `src/local-db.ts` - SQLite 数据库模块
- `src/cpa-registration.ts` - CPA 注册逻辑提取

**新增功能：**
- SQLite 数据库存储（workflow_runs, registration_attempts, accounts）
- Workflow 批量执行模式
- 数据库查询命令（--db-list-accounts, --db-list-runs, --db-export-tokens）
- 结构化结果返回（CodexCpaResult）

**CLI 参数：**
- `--workflow codex-cpa-register`：启动 workflow
- `--count N`：执行次数
- `--delay-ms <ms>`：轮次间延迟
- `--skip-probe-trial`：跳过试用探测
- `--db-path <path>`：数据库路径

---

### 第 2 阶段：并发 worker 调度器 ✅
**新增文件：**
- `src/worker-scheduler.ts` - Worker 调度器

**新增功能：**
- worker_slots 表（记录 worker 状态）
- Worker 状态机（IDLE → ACQUIRING_PHONE → ... → SUCCESS/FAILED）
- 并发调度器（最多 N 个 worker 同时运行）
- 资源绑定（号码/邮箱只能分配给一个 worker）
- 超时控制和失败释放

**CLI 参数：**
- `--concurrency N`：并发数
- `--sms-timeout-ms <ms>`：SMS 超时
- `--email-timeout-ms <ms>`：邮箱 OTP 超时
- `--cpa-timeout-ms <ms>`：CPA 操作超时
- `--db-list-workers`：查看 worker 状态

---

### 第 3 阶段：并发抢号 ✅
**新增文件：**
- `src/concurrent-registration.ts` - 并发抢号模块

**新增功能：**
- 同时获取多个号码
- 并行发起 OpenAI 注册
- 先收到验证码的优先使用
- 其余号码超时自动取消
- 快速抢号模式

**CLI 参数：**
- `--concurrent-pool`：使用并发抢号模式

---

## 项目结构

```
src/
├── index.ts                      # 主入口（已改造）
├── local-db.ts                   # SQLite 数据库模块（新增）
├── cpa-registration.ts           # CPA 注册逻辑（新增）
├── worker-scheduler.ts           # Worker 调度器（新增）
├── concurrent-registration.ts    # 并发抢号模块（新增）
├── config.ts                     # 配置模块
├── openai.ts                     # OpenAI 客户端
├── mailbox.ts                    # 邮箱模块
├── sms/                          # SMS 相关模块
└── ...                           # 其他现有模块

data/
└── codex-register.sqlite         # SQLite 数据库（自动创建，已 gitignore）

DOCX/
├── workflow-local-db-plan.md     # 设计文档
├── workflow-usage.md             # 使用说明（新增）
└── 接手清单.md                   # 已更新
```

---

## 使用示例

### 1. 串行模式（原有行为）
```bash
# 单次执行
npm run dev -- --codex-cpa --token-out tokens.txt

# Workflow 批量执行
npm run dev -- --workflow codex-cpa-register --count 5 --token-out tokens.txt
```

### 2. Worker 调度模式（并发）
```bash
# 5 个 worker，并发执行 20 次
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt

# 10 个 worker，执行 100 次，自定义超时
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 10 \
  --sms-timeout-ms 90000 \
  --skip-probe-trial \
  --token-out tokens.txt
```

### 3. 并发抢号模式
```bash
# 同时获取 5 个号码，先收到验证码的优先使用
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 \
  --concurrent-pool \
  --skip-probe-trial \
  --token-out tokens.txt
```

### 4. 数据库查询
```bash
# 查看成功账号
npm run dev -- --db-list-accounts

# 查看运行记录
npm run dev -- --db-list-runs

# 查看 worker 状态
npm run dev -- --db-list-workers --run-id 1

# 导出 token
npm run dev -- --db-export-tokens tokens_export.txt
```

---

## 数据库结构

### workflow_runs
记录每次 workflow 运行（状态、成功/失败次数、运行参数）

### registration_attempts
记录每次注册尝试（手机号、邮箱、SMS activation ID、错误信息）

### accounts
记录成功账号（手机号、邮箱、密码、access_token、CPA auth 文件）

### worker_slots
记录 worker 状态（worker_id、绑定的号码/邮箱、状态机流转）

---

## 设计原则

1. **不硬编码密钥**：所有敏感信息来自 config.json / 环境变量 / CLI 参数
2. **增量改造**：保留原有单次运行能力，新功能是增量添加
3. **资源释放**：超时/失败后立即释放号码/邮箱/worker
4. **可追溯**：所有状态变化写入数据库，便于排查和统计
5. **可重建**：失败后从零重建 worker，不复用脏状态

---

## 下一步建议

1. **性能优化**：根据实际使用情况调整并发数和超时时间
2. **监控告警**：添加成功率监控、失败告警
3. **资源池管理**：号码池、邮箱池的自动补充和管理
4. **Plus 订阅集成**：与现有 Plus 订阅流程整合
5. **Web 界面**：添加简单的 Web 界面查看状态和统计

---

## 文档参考

- `DOCX/workflow-local-db-plan.md` - 设计方案
- `DOCX/workflow-usage.md` - 使用说明
- `DOCX/接手清单.md` - 接手指南
