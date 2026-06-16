# Codex-Register

## 项目简介

`codex-register` 是一个面向 ChatGPT / OpenAI 账户注册与入库流程的自动化工具，基于 Node.js + TypeScript 实现。

当前项目已经从单次脚本升级为支持：

- CPA 注册入库
- 本地 workflow 执行
- SQLite 持久化
- worker 并发调度
- 并发抢号模式
- 自动 locale 注册资料
- 巡视释放与号码回收

---

## 核心能力

### 1. CPA 注册入库
支持完整 CPA 模式流程：
- 临时邮箱创建
- HeroSMS 取号
- OpenAI 手机注册
- SMS 验证码接收
- CPA OAuth
- 绑定邮箱
- 邮箱验证码接收
- CPA 入库
- access_token 获取与落库

### 2. 本地 workflow + SQLite
支持将运行过程持久化为结构化记录：
- `workflow_runs`
- `registration_attempts`
- `accounts`
- `worker_slots`

数据库默认路径：
```text
data/codex-register.sqlite
```

### 3. 并发调度与并发抢号
支持两种并发模式：
- Worker 调度模式：每个 worker 独立运行完整注册流程
- 并发抢号模式：多个号码并行等待验证码，先收到的优先使用，其余自动释放

### 4. 自动 locale 注册资料
支持根据注册代理出口 IP 自动选择注册资料国籍风格（`name/birthdate`）。

默认配置下：
- `profileLocale=auto`
- 自动检测失败时回退到 `en_US`

### 5. 巡视释放机制
支持短信等待超时主动释放号码：
- 当前 worker deadline 超时释放
- 后台巡视器持续轮询 active activations
- 超时号码主动取消，避免长时间挂死浪费余额

---

## 项目规模

当前项目规模（统计时间：以当前仓库为准）：

- `src/` 源文件：**43 个**
- 核心模块覆盖：入口、OpenAI 注册、邮箱、SMS、CPA 集成、调度器、数据库、注册资料生成、巡视释放

主要目录结构：

```text
src/
  index.ts                   # 主入口
  openai.ts                  # OpenAI 注册与登录
  config.ts                  # 配置加载
  cpa-registration.ts        # CPA 注册逻辑
  worker-scheduler.ts        # worker 并发调度
  concurrent-registration.ts # 并发抢号
  local-db.ts                # SQLite 数据库模块
  profile-generator.ts       # 注册资料生成
  profile-geo.ts             # 出口 IP 国家检测
  proxy-dispatcher.ts        # 代理调度封装
  sms/                       # SMS 相关模块
  mail/                      # 邮箱相关模块
```

---

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 复制并修改配置
```bash
cp config.example.json config.json
```

然后在 `config.json` 中填入真实配置，例如：
- 代理配置
- HeroSMS 配置
- CPA 配置
- coroabet 邮箱配置
- profile locale 配置

### 3. 构建
```bash
npm run build
```

### 4. 运行开发模式
```bash
npm run dev -- --codex-cpa --token-out tokens.txt
```

---

## 常用命令

### 查看 profile locale 检测
```bash
npm run dev -- --profile-geo-check
```

### 串行 CPA 注册
```bash
npm run dev -- --codex-cpa --token-out tokens.txt
```

### workflow 串行模式
```bash
npm run dev -- --workflow codex-cpa-register --count 5 --token-out tokens.txt
```

### workflow worker 调度模式
```bash
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt
```

### workflow 并发抢号模式
```bash
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 --concurrent-pool --token-out tokens.txt
```

### 查看数据库记录
```bash
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
```

---

## 测试命令（直接可用）

### 一、基础测试

```bash
# 1. 检查环境
node --version
npm run build

# 2. 测试数据库
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers
```

### 二、串行模式测试

```bash
# 1. 单次串行注册
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial --token-out test_tokens.txt

# 2. 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-list-accounts
cat test_tokens.txt

# 3. 多次串行注册
npm run dev -- --workflow codex-cpa-register --count 3 --skip-probe-trial --token-out test_tokens.txt

# 4. 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 2
npm run dev -- --db-list-accounts
```

### 三、并发模式测试

```bash
# 1. 3 个 worker，共执行 5 次
npm run dev -- --workflow codex-cpa-register --count 5 --concurrency 3 --skip-probe-trial --token-out test_tokens.txt

# 2. 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 3
npm run dev -- --db-list-accounts
```

### 四、并发抢号模式测试（重点）

```bash
# 1. 同时获取 3 个号码
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 2. 查看实时状态
npm run dev -- --db-list-workers --run-id 4

# 3. 查看运行记录
npm run dev -- --db-list-runs

# 4. 查看成功账号
npm run dev -- --db-list-accounts

# 5. 查看 token
cat test_tokens.txt
```

### 五、超时测试

```bash
# 1. 设置短超时（30 秒）
npm run dev -- --workflow codex-cpa-register --count 1 --concurrency 1 --concurrent-pool --sms-timeout-ms 30000 --skip-probe-trial

# 2. 查看超时状态
npm run dev -- --db-list-workers --run-id 5
```

### 六、导出测试

```bash
# 1. 导出 token
npm run dev -- --db-export-tokens exported_tokens.txt

# 2. 查看导出的 token
cat exported_tokens.txt
```

---

### 快速测试流程（复制粘贴）

```bash
# 清理旧数据
rm -f data/codex-register.sqlite
rm -f test_tokens.txt

# 测试 1：单次串行
npm run dev -- --workflow codex-cpa-register --count 1 --skip-probe-trial --token-out test_tokens.txt

# 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 1
npm run dev -- --db-list-accounts

# 测试 2：并发抢号
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt

# 查看结果
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers --run-id 2
npm run dev -- --db-list-accounts
cat test_tokens.txt
```

---

### 验证要点

| 测试项 | 验证命令 | 预期结果 |
|---|---|---|
| 号码绑定 | `--db-list-workers` | 每个 worker 有唯一 phone |
| 邮箱绑定 | `--db-list-workers` | 每个 worker 有唯一 email |
| 状态追踪 | `--db-list-workers` | 状态从 `idle` 变为 `success/failed` |
| 超时取消 | `--db-list-workers` | 状态为 `timed_out` |
| 成功保存 | `--db-list-accounts` | 成功账号写入 `accounts` |
| Token 导出 | `cat test_tokens.txt` | 包含 `access_token` |

---

### 常见问题

```bash
# 问题 1：号码不可用
# 症状：报错 NO_NUMBERS
# 解决：等待一段时间再试

# 问题 2：邮箱准备失败
# 症状：报错 邮箱准备失败
# 解决：检查 config.json 中的 coroabet 配置

# 问题 3：CPA 失败
# 症状：报错 CPA auth-url failed
# 解决：检查 config.json 中的 cliproxy 配置
```

详细测试指南见：`DOCX/testing-guide.md`

---

## 重点文档索引

项目文档主要存放在 `DOCX/` 目录。

### 方案与升级文档
- `DOCX/workflow-local-db-plan.md`
  - workflow、SQLite、并发 worker、巡视释放、落地计划
- `DOCX/workflow-usage.md`
  - workflow 模式使用说明
- `DOCX/接手清单.md`
  - 新 agent / 新开发者接手指南
- `DOCX/rework-plan.md`
  - 并发抢号返工审查与整改要求

### 项目分析与参考
- `DOCX/项目分析文档.md`
- `DOCX/代码对应关系文档.md`
- `DOCX/快速参考手册.md`

### 优化与验收
- `DOCX/P0-acceptance-checklist.md`
- `DOCX/P0-acceptance-report.md`
- `DOCX/P0-optimization-report.md`
- `DOCX/P0-optimization-summary.md`
- `DOCX/upgrade-summary.md`
- `DOCX/task-report.md`
- `DOCX/rework-completion-report.md`
- `DOCX/rework-summary.md`
- `DOCX/rework-quick-reference.md`

---

## 当前配置说明

敏感信息不要提交到 Git，统一通过本地文件配置：

- `config.json`（本地运行配置）
- 环境变量
- CLI 参数

默认已忽略以下目录/文件：
- `config.json`
- `data/`
- `node_modules/`
- `bundle/`
- `auth/`
- `hotmail/`
- `*.log`

---

## 运行模式简介

### 1. `--codex-cpa`
传统 CPA 注册模式，适合单次运行或脚本化调用。

### 2. `--workflow codex-cpa-register`
workflow 批量执行模式，支持：
- 串行执行
- worker 并发调度
- 并发抢号
- 数据库记录

### 3. 并发模式
通过以下参数组合：
- `--concurrency N`
- `--concurrent-pool`
- `--sms-timeout-ms`
- `--email-timeout-ms`
- `--cpa-timeout-ms`

### 4. 数据库命令
可用于回溯运行结果：
- `--db-list-accounts`
- `--db-list-runs`
- `--db-export-tokens`

---

## 注意事项

1. **不要硬编码密钥**
所有敏感配置应来自：
- `config.json`
- 环境变量
- CLI 参数

2. **并发模式仍建议先小批量验证**
建议先用：
```bash
--count 5 --concurrency 3
```
确认稳定后再放大。

3. **号码/邮箱资源需要后台配合**
当前能力依赖：
- HeroSMS
- coroabet / 其他邮箱 provider
- CPA 服务
- 代理出口

---

## 推荐阅读顺序

如果你是第一次接手这个项目，建议：

1. `DOCX/接手清单.md`
2. `DOCX/workflow-local-db-plan.md`
3. `DOCX/workflow-usage.md`
4. `src/index.ts`
5. `src/worker-scheduler.ts`
6. `src/concurrent-registration.ts`
7. `src/cpa-registration.ts`

---

## 当前状态总结

当前项目已经具备：

- 可跑通的 CPA 注册链路
- 本地 workflow + SQLite 持久化
- worker 并发调度
- 并发抢号基础能力
- 自动 locale 注册资料生成
- 巡视释放与失败重建机制

适合作为后续工业化抢号、批量注册、数据库追溯、并发调度优化的基础版本。
