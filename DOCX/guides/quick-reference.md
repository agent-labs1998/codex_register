# Codex-Register 快速参考卡

## 常用命令

### 单次执行（原有）
```bash
npm run dev -- --codex-cpa --token-out tokens.txt
```

### Workflow 串行
```bash
npm run dev -- --workflow codex-cpa-register --count 5 --token-out tokens.txt
```

### Workflow 并发（Worker 调度）
```bash
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt
```

### Workflow 并发（抢号模式）
```bash
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --concurrent-pool --token-out tokens.txt
```

### 数据库查询
```bash
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-export-tokens tokens_export.txt
```

### Profile Locale 检测
```bash
npm run dev -- --profile-geo-check
```

---

## 参数速查

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--workflow codex-cpa-register` | 启动 workflow | - |
| `--count N` | 执行次数 | 1 |
| `--concurrency N` | 并发数 | 1（串行） |
| `--concurrent-pool` | 使用并发抢号模式 | false |
| `--token-out <file>` | token 输出文件 | - |
| `--skip-probe-trial` | 跳过试用探测 | false |
| `--db-path <path>` | 数据库路径 | data/codex-register.sqlite |
| `--delay-ms <ms>` | 轮次间延迟 | config.loopDelayMs |
| `--sms-timeout-ms <ms>` | SMS 超时 | 120000 |
| `--email-timeout-ms <ms>` | 邮箱 OTP 超时 | 90000 |
| `--cpa-timeout-ms <ms>` | CPA 操作超时 | 60000 |

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

## 数据库表

| 表名 | 说明 |
|------|------|
| workflow_runs | workflow 运行记录 |
| registration_attempts | 注册尝试记录 |
| accounts | 成功账号（包含 IP 信息） |
| worker_slots | worker 状态（并发模式） |

---

## Worker 状态机

```
IDLE
  ↓
ACQUIRING_PHONE (获取号码)
  ↓
REGISTERING (发起注册)
  ↓
WAITING_SMS (等待验证码)
  ↓
SMS_RECEIVED (收到验证码)
  ↓
CPA_OAUTH (CPA OAuth)
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

## IP 检测

程序会自动检测代理出口 IP，显示信息包括：
- IP 地址
- 国家、城市、ISP
- 住宅/数据中心标签
- 代理/移动标签

**检测方式**：
- `defaultProxyUrl` 有值 → 通过代理检测
- `defaultProxyUrl` 为空 → 直连检测

---

## Profile Locale 配置

**配置项**：`profileLocale`

| 值 | 说明 |
|----|------|
| `classic` | 使用固定英文名字池（推荐，避免风控） |
| `en_US` | 使用 faker 生成英文名字 |
| `auto` | 根据代理 IP 自动检测国家 |

---

## 故障排查

### 查看运行统计
```bash
npm run dev -- --db-list-runs
```

### 查看失败尝试
```bash
npm run dev -- --db-list-runs
# 找到 run_id，然后查看该 run 的 attempts
```

### 查看 worker 状态
```bash
npm run dev -- --db-list-workers --run-id <run_id>
```

### 导出成功 token
```bash
npm run dev -- --db-export-tokens tokens_export.txt
```

---

## 文件位置

- 配置：`config.json`
- 数据库：`data/codex-register.sqlite`
- Token 输出：`tokens.txt`（或指定的 `--token-out`）
- 日志：控制台输出

---

## 设计原则

1. ✅ 不硬编码密钥
2. ✅ 增量改造，不破坏现有流程
3. ✅ 失败资源可释放
4. ✅ 状态可追溯
5. ✅ Worker 可重建
6. ✅ IP 检测支持代理/直连切换
7. ✅ 所有模式都记录到数据库
