# Codex-Register 使用指南

本文档说明如何使用 codex-register 的所有功能。

---

## 目录

1. [快速开始](#快速开始)
2. [单次注册](#单次注册)
3. [Workflow 批量注册](#workflow-批量注册)
4. [并发模式](#并发模式)
5. [并发抢号模式](#并发抢号模式)
6. [数据库查询](#数据库查询)
7. [参数说明](#参数说明)
8. [常见场景](#常见场景)

---

## 快速开始

### 1. 单次注册（原有功能）
```bash
npm run dev -- --codex-cpa --token-out tokens.txt
```

### 2. Workflow 批量注册（串行）
```bash
# 执行 5 次
npm run dev -- --workflow codex-cpa-register --count 5 --token-out tokens.txt
```

### 3. Workflow 并发注册
```bash
# 5 个 worker，共执行 20 次
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt
```

---

## 单次注册

### 基本命令
```bash
npm run dev -- --codex-cpa --token-out tokens.txt
```

### 参数说明
- `--codex-cpa`：启用 CPA 注册模式
- `--token-out tokens.txt`：token 输出文件

### 其他可选参数
```bash
# 跳过试用探测
npm run dev -- --codex-cpa --skip-probe-trial --token-out tokens.txt

# 指定数据库路径
npm run dev -- --codex-cpa --db-path my-db.sqlite --token-out tokens.txt
```

---

## Workflow 批量注册

### 串行模式（默认）

#### 基本命令
```bash
# 执行 1 次
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt

# 执行 10 次
npm run dev -- --workflow codex-cpa-register --count 10 --token-out tokens.txt

# 跳过试用探测
npm run dev -- --workflow codex-cpa-register --count 10 --skip-probe-trial --token-out tokens.txt

# 自定义延迟
npm run dev -- --workflow codex-cpa-register --count 5 --delay-ms 5000 --token-out tokens.txt

# 指定数据库路径
npm run dev -- --workflow codex-cpa-register --count 5 --db-path my-db.sqlite --token-out tokens.txt
```

#### 参数说明
- `--workflow codex-cpa-register`：指定 workflow 名称
- `--count N`：执行次数（默认 1）
- `--delay-ms <ms>`：每次执行间隔（默认使用 config.json 的 loopDelayMs）
- `--token-out tokens.txt`：token 输出文件
- `--skip-probe-trial`：跳过试用探测
- `--db-path <path>`：数据库路径（默认 `data/codex-register.sqlite`）

---

## 并发模式

### Worker 调度模式（默认并发模式）

#### 基本命令
```bash
# 5 个 worker，共执行 20 次
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt

# 10 个 worker，共执行 100 次
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 10 --token-out tokens.txt

# 自定义超时时间
npm run dev -- --workflow codex-cpa-register --count 50 --concurrency 10 \
  --sms-timeout-ms 90000 \
  --email-timeout-ms 60000 \
  --cpa-timeout-ms 45000 \
  --token-out tokens.txt
```

#### 参数说明
- `--concurrency N`：并发数（默认 1，串行模式）
- `--sms-timeout-ms <ms>`：SMS 等待超时（默认 120000ms）
- `--email-timeout-ms <ms>`：邮箱 OTP 等待超时（默认 90000ms）
- `--cpa-timeout-ms <ms>`：CPA 操作超时（默认 60000ms）

#### 工作原理
- 每个 worker 独立运行完整的注册流程
- 最多 N 个 worker 同时运行
- 每个 worker 绑定唯一的号码和邮箱
- 超时或失败后立即释放 worker slot

---

## 并发抢号模式

### 基本命令
```bash
# 同时获取 5 个号码，先收到验证码的优先使用
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --concurrent-pool --token-out tokens.txt

# 同时获取 10 个号码
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 10 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

### 参数说明
- `--concurrent-pool`：使用并发抢号模式

### 工作原理
1. **同时获取多个号码**：一次性获取 N 个号码
2. **并行发起注册**：所有号码同时发起 OpenAI 注册
3. **先到先用**：谁先收到验证码，就优先使用谁
4. **超时取消**：其余号码超时后自动取消，释放资源

### 适用场景
- 号码稀缺，需要快速抢号
- 需要最大化号码利用率
- 网络环境不稳定，需要快速切换

---

## 数据库查询

### 查看成功账号
```bash
npm run dev -- --db-list-accounts
```

输出示例：
```
[db] 账号列表 (共 2 个):

  ID: 1
  Phone: +573001234567
  Email: tmpabc@coroabet777.com
  Status: active
  Created: 2026-06-16 10:30:00
  Token: eyJhbGciOiJSUzI1NiIs...

  ID: 2
  Phone: +56912345678
  Email: tmpdef@coroabet777.com
  Status: active
  Created: 2026-06-16 10:35:00
  Token: eyJhbGciOiJSUzI1NiIs...
```

### 查看运行记录
```bash
npm run dev -- --db-list-runs
```

输出示例：
```
[db] 运行记录 (共 2 条):

  ID: 1
  Workflow: codex-cpa-register
  Status: completed
  Started: 2026-06-16 10:30:00
  Finished: 2026-06-16 10:35:00
  Success: 8
  Failure: 2

  ID: 2
  Workflow: codex-cpa-register
  Status: partial
  Started: 2026-06-16 11:00:00
  Finished: 2026-06-16 11:05:00
  Success: 5
  Failure: 1
```

### 查看 worker 状态
```bash
# 查看所有 worker 统计
npm run dev -- --db-list-workers

# 查看特定 run 的活跃 workers
npm run dev -- --db-list-workers --run-id 1
```

输出示例：
```
[db] Run 1 活跃 workers (共 3 个):

  Worker: worker-001
  Status: waiting_sms
  Phone: +573001234567
  Email: tmpabc@coroabet777.com
  Started: 2026-06-16 10:30:00

  Worker: worker-002
  Status: acquiring_phone
  Phone: -
  Email: -
  Started: 2026-06-16 10:30:05

  Worker: worker-003
  Status: success
  Phone: +56912345678
  Email: tmpdef@coroabet777.com
  Started: 2026-06-16 10:30:10
```

### 导出 token 到文件
```bash
npm run dev -- --db-export-tokens tokens_export.txt
```

---

## 参数说明

### Workflow 参数
| 参数 | 说明 | 默认值 | 示例 |
|------|------|--------|------|
| `--workflow codex-cpa-register` | 启动 workflow | - | `--workflow codex-cpa-register` |
| `--count N` | 执行次数 | 1 | `--count 10` |
| `--concurrency N` | 并发数 | 1（串行） | `--concurrency 5` |
| `--concurrent-pool` | 使用并发抢号模式 | false | `--concurrent-pool` |
| `--delay-ms <ms>` | 轮次间延迟 | config.loopDelayMs | `--delay-ms 5000` |
| `--skip-probe-trial` | 跳过试用探测 | false | `--skip-probe-trial` |
| `--token-out <file>` | token 输出文件 | - | `--token-out tokens.txt` |
| `--db-path <path>` | 数据库路径 | data/codex-register.sqlite | `--db-path my-db.sqlite` |

### 并发模式参数
| 参数 | 说明 | 默认值 | 示例 |
|------|------|--------|------|
| `--sms-timeout-ms <ms>` | SMS 等待超时 | 120000 | `--sms-timeout-ms 90000` |
| `--email-timeout-ms <ms>` | 邮箱 OTP 等待超时 | 90000 | `--email-timeout-ms 60000` |
| `--cpa-timeout-ms <ms>` | CPA 操作超时 | 60000 | `--cpa-timeout-ms 45000` |

### 数据库查询参数
| 参数 | 说明 | 示例 |
|------|------|------|
| `--db-list-accounts` | 查看成功账号 | `--db-list-accounts` |
| `--db-list-runs` | 查看运行记录 | `--db-list-runs` |
| `--db-list-workers` | 查看 worker 状态 | `--db-list-workers` |
| `--run-id <id>` | 指定 run ID（仅 --db-list-workers） | `--run-id 1` |
| `--db-export-tokens <file>` | 导出 token | `--db-export-tokens tokens.txt` |

---

## 常见场景

### 场景 1：测试单个注册
```bash
npm run dev -- --codex-cpa --token-out tokens.txt
```

### 场景 2：批量注册 10 个账号
```bash
npm run dev -- --workflow codex-cpa-register --count 10 --token-out tokens.txt
```

### 场景 3：快速批量注册（并发）
```bash
# 5 个 worker，共注册 50 个
npm run dev -- --workflow codex-cpa-register --count 50 --concurrency 5 --skip-probe-trial --token-out tokens.txt
```

### 场景 4：抢号模式（号码稀缺时）
```bash
# 同时获取 5 个号码，先到先用
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --concurrent-pool --skip-probe-trial --token-out tokens.txt
```

### 场景 5：查看注册结果
```bash
# 查看成功账号
npm run dev -- --db-list-accounts

# 查看运行统计
npm run dev -- --db-list-runs

# 导出 token
npm run dev -- --db-export-tokens all_tokens.txt
```

### 场景 6：自定义超时（网络不稳定时）
```bash
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 \
  --sms-timeout-ms 180000 \
  --email-timeout-ms 120000 \
  --cpa-timeout-ms 90000 \
  --token-out tokens.txt
```

### 场景 7：查看并发 worker 状态
```bash
# 查看 run ID 为 1 的所有 worker
npm run dev -- --db-list-workers --run-id 1
```

---

## Worker 状态机

每个 worker 有明确的状态流转：

```
IDLE (空闲)
  ↓
ACQUIRING_PHONE (获取号码)
  ↓
REGISTERING (发起 OpenAI 注册)
  ↓
WAITING_SMS (等待验证码)
  ↓
SMS_RECEIVED (收到验证码)
  ↓
CPA_OAUTH (CPA OAuth 登录)
  ↓
WAITING_EMAIL_OTP (等待邮箱验证码)
  ↓
EMAIL_OTP_RECEIVED (收到邮箱验证码)
  ↓
CPA_SUBMIT (提交 CPA)
  ↓
SUCCESS / FAILED / TIMED_OUT / CANCELLED
```

---

## 并发模式对比

| 特性 | Worker 调度模式 | 并发抢号模式 |
|------|----------------|--------------|
| 启用方式 | `--concurrency N` | `--concurrency N --concurrent-pool` |
| 工作方式 | 每个 worker 独立运行 | 同时获取多个号码，先到先用 |
| 适用场景 | 稳定的批量注册 | 号码稀缺，需要快速抢号 |
| 资源利用率 | 中等 | 高 |
| 实现复杂度 | 低 | 高 |

---

## 故障排查

### 问题 1：没有获取到号码
**症状**：运行后立即失败
**原因**：HeroSMS API key 未配置或无效
**解决**：检查 `config.json` 中的 `heroSMSApiKey`

### 问题 2：SMS 等待超时
**症状**：worker 状态卡在 `WAITING_SMS`
**原因**：验证码未在超时时间内到达
**解决**：
1. 增加 `--sms-timeout-ms` 值
2. 检查网络连接
3. 检查 HeroSMS 服务状态

### 问题 3：数据库不存在
**症状**：运行报错找不到数据库
**原因**：`data/` 目录不存在
**解决**：程序会自动创建，无需手动处理

### 问题 4：token 文件为空
**症状**：`tokens.txt` 没有内容
**原因**：所有注册都失败了
**解决**：
1. 查看运行记录：`npm run dev -- --db-list-runs`
2. 查看失败原因

---

## 最佳实践

### 1. 首次使用
```bash
# 先测试单个注册
npm run dev -- --codex-cpa --token-out test.txt

# 验证成功后，再批量
npm run dev -- --workflow codex-cpa-register --count 5 --token-out tokens.txt
```

### 2. 生产环境
```bash
# 使用并发模式，跳过试用探测
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 10 --skip-probe-trial --token-out tokens.txt
```

### 3. 定期查看结果
```bash
# 每次运行后查看统计
npm run dev -- --db-list-runs

# 导出 token 备份
npm run dev -- --db-export-tokens backup_$(date +%Y%m%d).txt
```

---

## 参考文档

- `DOCX/workflow-local-db-plan.md` - 设计方案
- `DOCX/workflow-usage.md` - Workflow 使用说明
- `DOCX/quick-reference.md` - 快速参考卡
- `DOCX/upgrade-summary.md` - 升级总结
- `DOCX/task-report.md` - 任务报告书
