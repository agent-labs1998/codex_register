# Codex-Register 工业化升级任务报告书

**项目名称：** codex-register
**执行日期：** 2026-06-16
**执行目标：** 基于现有已跑通的 CPA 注册链路，进行工业化升级

---

## 一、任务背景

### 1.1 项目现状
项目已完成：
- coroabet 临时邮箱创建
- HeroSMS 取号
- OpenAI 手机注册
- SMS 验证码接收
- CPA OAuth
- 绑定邮箱
- 邮箱验证码接收
- CPA 入库
- token 写入文件
- 自动 locale（根据代理出口 IP 自动选择注册资料国籍风格）
- 巡视释放模式（超时号码主动取消）
- 失败后从零重建 worker

### 1.2 存在的问题
- 没有正式的 workflow 层，批量注册缺少状态记录
- 成功账号、token 等信息散落在日志和文件里
- 没有数据库，无法追溯失败原因、统计成功率
- 不支持并发注册

### 1.3 升级目标
1. **第 1 阶段**：本地 workflow + SQLite 持久化
2. **第 2 阶段**：并发 worker 调度器
3. **第 3 阶段**：并发抢号

---

## 二、任务执行清单

### 2.1 第 1 阶段：workflow + SQLite

#### 创建文件
| 文件 | 说明 |
|------|------|
| `src/local-db.ts` | SQLite 数据库模块 |
| `src/cpa-registration.ts` | CPA 注册逻辑独立模块 |

#### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `src/index.ts` | 1. 导入 local-db 和 cpa-registration 模块<br>2. 新增 workflow 模式处理逻辑<br>3. 新增 DB 查询命令处理逻辑 |
| `.gitignore` | 添加 `data/` 目录（SQLite 数据库存储位置） |

#### 新增功能
1. **SQLite 数据库**
   - 自动创建 `data/codex-register.sqlite`
   - 使用 Node 22 内置 SQLite（无需额外依赖）
   - 定义 3 张表：`workflow_runs`, `registration_attempts`, `accounts`

2. **数据库表结构**

   **workflow_runs**
   ```sql
   CREATE TABLE workflow_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     workflow TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'running',
     started_at TEXT NOT NULL DEFAULT (datetime('now')),
     finished_at TEXT,
     success_count INTEGER NOT NULL DEFAULT 0,
     failure_count INTEGER NOT NULL DEFAULT 0,
     options_json TEXT,
     last_error TEXT
   );
   ```

   **registration_attempts**
   ```sql
   CREATE TABLE registration_attempts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     phone TEXT,
     email TEXT,
     password TEXT,
     sms_activation_id TEXT,
     sms_country TEXT,
     sms_cost TEXT,
     cpa_status TEXT,
     cpa_auth_file TEXT,
     error TEXT,
     started_at TEXT NOT NULL DEFAULT (datetime('now')),
     finished_at TEXT,
     FOREIGN KEY (run_id) REFERENCES workflow_runs(id)
   );
   ```

   **accounts**
   ```sql
   CREATE TABLE accounts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     phone TEXT NOT NULL UNIQUE,
     email TEXT NOT NULL,
     password TEXT NOT NULL,
     access_token TEXT NOT NULL,
     token_expires_at TEXT,
     cpa_auth_file TEXT,
     cpa_base_url TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     status TEXT NOT NULL DEFAULT 'active'
   );
   ```

3. **数据库 Helper 函数**
   - `createWorkflowRun()` - 创建 workflow 运行记录
   - `finishWorkflowRun()` - 完成 workflow 运行
   - `createAttempt()` - 创建注册尝试
   - `updateAttempt()` - 更新注册尝试状态
   - `saveAccount()` - 保存成功账号
   - `listAccounts()` - 列出所有账号
   - `listRuns()` - 列出所有运行记录
   - `listAttempts()` - 列出某次运行的所有尝试
   - `exportTokens()` - 导出 token 到文件
   - `getStats()` - 获取统计信息

4. **CPA 注册逻辑提取**
   - 从 `src/index.ts` 的 `--codex-cpa` 模式提取为独立函数
   - 返回结构化结果 `CodexCpaResult`
   - 保留所有现有功能：巡视释放、失败重建、邮箱绑定

5. **Workflow 模式 CLI 参数**
   - `--workflow codex-cpa-register` - 启动 workflow
   - `--count N` - 执行次数（默认 1）
   - `--delay-ms <ms>` - 轮次间延迟
   - `--skip-probe-trial` - 跳过试用探测
   - `--db-path <path>` - 数据库路径（默认 `data/codex-register.sqlite`）
   - `--token-out <file>` - token 输出文件

6. **数据库查询命令**
   - `--db-list-accounts` - 查看成功账号
   - `--db-list-runs` - 查看运行记录
   - `--db-export-tokens <file>` - 导出 token

#### 兼容性保证
- ✅ 保留原有 `--codex-cpa` 单次运行行为
- ✅ 保留原有 `--token-out` 文件追加行为
- ✅ 新功能是增量添加，不影响现有流程

---

### 2.2 第 2 阶段：并发 worker 调度器

#### 创建文件
| 文件 | 说明 |
|------|------|
| `src/worker-scheduler.ts` | Worker 调度器模块 |

#### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `src/local-db.ts` | 1. 添加 `WorkerSlot` 接口<br>2. 添加 `worker_slots` 表<br>3. 添加 worker 管理函数 |
| `src/index.ts` | 1. 导入 WorkerScheduler<br>2. 添加并发模式处理逻辑<br>3. 新增 `--db-list-workers` 命令 |

#### 新增功能
1. **worker_slots 表**
   ```sql
   CREATE TABLE worker_slots (
     worker_id TEXT PRIMARY KEY,
     run_id INTEGER NOT NULL,
     attempt_id INTEGER,
     status TEXT NOT NULL DEFAULT 'idle',
     phone TEXT,
     activation_id TEXT,
     bind_email TEXT,
     started_at TEXT NOT NULL DEFAULT (datetime('now')),
     sms_deadline_at TEXT,
     email_deadline_at TEXT,
     FOREIGN KEY (run_id) REFERENCES workflow_runs(id),
     FOREIGN KEY (attempt_id) REFERENCES registration_attempts(id)
   );
   ```

2. **Worker 状态机**
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

3. **WorkerScheduler 类**
   - 管理多个 worker 并发执行
   - 每个 worker 独立运行 CPA 注册流程
   - 自动管理 worker 状态和资源释放
   - 控制并发数（最多 N 个 worker 同时运行）

4. **Worker 管理函数**
   - `createWorkerSlot()` - 创建 worker slot
   - `updateWorkerSlot()` - 更新 worker 状态
   - `getWorkerSlot()` - 获取 worker 信息
   - `getActiveWorkers()` - 获取活跃 workers
   - `getIdleWorkers()` - 获取空闲 workers
   - `deleteWorkerSlot()` - 删除 worker slot

5. **并发 CLI 参数**
   - `--concurrency N` - 并发数（默认 1，串行模式）
   - `--sms-timeout-ms <ms>` - SMS 等待超时（默认 120000ms）
   - `--email-timeout-ms <ms>` - 邮箱 OTP 等待超时（默认 90000ms）
   - `--cpa-timeout-ms <ms>` - CPA 操作超时（默认 60000ms）
   - `--db-list-workers` - 查看 worker 状态

---

### 2.3 第 3 阶段：并发抢号

#### 创建文件
| 文件 | 说明 |
|------|------|
| `src/concurrent-registration.ts` | 并发抢号模块 |

#### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `src/index.ts` | 1. 导入 runConcurrentRegistration<br>2. 添加并发抢号模式处理逻辑 |

#### 新增功能
1. **ConcurrentPhonePool 类**
   - 同时获取多个号码
   - 并行发起 OpenAI 注册
   - 先收到验证码的优先使用
   - 其余号码超时自动取消
   - 资源绑定（每个号码只能属于一个 worker）

2. **并发抢号流程**
   ```
   1. 同时获取 N 个号码（acquirePhones）
   2. 并行发起 OpenAI 注册（authPhoneSignupHTTP）
   3. 同时等待验证码（waitForVerificationCode）
   4. 谁先收到验证码，就优先使用谁
   5. 其余号码超时取消（cancelPhone）
   6. 释放资源（removeLease）
   ```

3. **并发抢号 CLI 参数**
   - `--concurrent-pool` - 使用并发抢号模式（仅并发模式）

---

## 三、新增文件清单

| 文件路径 | 类型 | 说明 |
|----------|------|------|
| `src/local-db.ts` | 新增 | SQLite 数据库模块 |
| `src/cpa-registration.ts` | 新增 | CPA 注册逻辑独立模块 |
| `src/worker-scheduler.ts` | 新增 | Worker 调度器模块 |
| `src/concurrent-registration.ts` | 新增 | 并发抢号模块 |
| `DOCX/workflow-usage.md` | 新增 | Workflow 使用说明 |
| `DOCX/upgrade-summary.md` | 新增 | 升级总结 |
| `DOCX/quick-reference.md` | 新增 | 快速参考卡 |
| `.gitignore` | 修改 | 添加 `data/` 目录 |
| `src/index.ts` | 修改 | 添加 workflow、并发模式、DB 查询命令 |
| `DOCX/接手清单.md` | 修改 | 更新完成状态 |

---

## 四、修改文件清单

| 文件路径 | 修改类型 | 修改内容 |
|----------|----------|----------|
| `src/index.ts` | 重大修改 | 1. 新增导入：LocalDB, runCpaRegistration, WorkerScheduler, runConcurrentRegistration<br>2. 新增 workflow 模式（串行/并发）<br>3. 新增 DB 查询命令<br>4. 新增并发抢号模式 |
| `src/local-db.ts` | 重大修改 | 1. 添加 WorkerSlot 接口<br>2. 添加 worker_slots 表<br>3. 添加 worker 管理函数 |
| `.gitignore` | 小修改 | 添加 `data/` |
| `DOCX/接手清单.md` | 小修改 | 更新第 1/2/3 阶段完成状态 |

---

## 五、实现的功能

### 5.1 Workflow 批量执行
- 支持串行模式（默认）
- 支持并发模式（Worker 调度）
- 支持并发抢号模式
- 自动记录所有结果到 SQLite

### 5.2 SQLite 持久化
- 本地数据库存储（`data/codex-register.sqlite`）
- 4 张表：workflow_runs, registration_attempts, accounts, worker_slots
- 所有写入使用 prepared statements

### 5.3 并发 Worker 调度
- Worker 状态机（11 种状态）
- 资源绑定（号码/邮箱只能分配给一个 worker）
- 超时控制（SMS、邮箱 OTP、CPA 操作独立超时）
- 失败释放（超时或失败后立即释放 worker slot）

### 5.4 并发抢号
- 同时获取多个号码
- 并行发起 OpenAI 注册
- 先收到验证码的优先使用
- 其余号码超时自动取消

### 5.5 数据库查询
- 查看成功账号（`--db-list-accounts`）
- 查看运行记录（`--db-list-runs`）
- 查看 worker 状态（`--db-list-workers`）
- 导出 token（`--db-export-tokens`）

---

## 六、使用示例

### 6.1 串行模式
```bash
# 单次执行
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt

# 批量执行
npm run dev -- --workflow codex-cpa-register --count 10 --skip-probe-trial --token-out tokens.txt
```

### 6.2 Worker 调度模式（并发）
```bash
# 5 个 worker，共执行 20 次
npm run dev -- --workflow codex-cpa-register --count 20 --concurrency 5 --token-out tokens.txt

# 10 个 worker，执行 100 次，自定义超时
npm run dev -- --workflow codex-cpa-register --count 100 --concurrency 10 \
  --sms-timeout-ms 90000 \
  --skip-probe-trial \
  --token-out tokens.txt
```

### 6.3 并发抢号模式
```bash
# 同时获取 5 个号码，先收到验证码的优先使用
npm run dev -- --workflow codex-cpa-register --count 10 --concurrency 5 \
  --concurrent-pool \
  --skip-probe-trial \
  --token-out tokens.txt
```

### 6.4 数据库查询
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

## 七、技术细节

### 7.1 数据库实现
- 使用 Node 22 内置 `node:sqlite`（`DatabaseSync`）
- 无需安装额外依赖（如 `sqlite3`、`better-sqlite3`）
- 自动创建 `data/` 目录和数据库文件

### 7.2 CPA 注册逻辑提取
- 从 `src/index.ts` 的 350+ 行提取为独立函数
- 返回结构化结果 `CodexCpaResult`
- 保留所有现有功能：
  - 巡视释放模式（65s deadline）
  - 失败后从零重建 worker
  - 邮箱绑定和 OTP 获取
  - 试用探测（可选）

### 7.3 Worker 调度器实现
- `WorkerScheduler` 类管理多个 worker
- 使用 `Promise.all` 并发执行
- 每个 worker 独立运行完整注册流程
- 状态变化写入数据库
- 超时自动释放资源

### 7.4 并发抢号实现
- `ConcurrentPhonePool` 类管理号码池
- 同时获取多个号码（`acquirePhones`）
- 并行发起注册（`Promise.all`）
- 谁先收到验证码，就优先使用谁
- 其余号码超时取消（`cancelPhone`）

### 7.5 兼容性保证
- 保留原有 `--codex-cpa` 单次运行行为
- 保留原有 `--token-out` 文件追加行为
- 新功能是增量添加，不影响现有流程

---

## 八、文件结构变更

### 8.1 新增文件
```
src/
├── local-db.ts                   # SQLite 数据库模块
├── cpa-registration.ts           # CPA 注册逻辑提取
├── worker-scheduler.ts           # Worker 调度器
└── concurrent-registration.ts    # 并发抢号模块

DOCX/
├── workflow-usage.md             # 使用说明
├── upgrade-summary.md            # 升级总结
└── quick-reference.md            # 快速参考卡

data/
└── codex-register.sqlite         # SQLite 数据库（自动创建，已 gitignore）
```

### 8.2 修改文件
```
src/index.ts                      # 添加 workflow、并发模式、DB 查询命令
.gitignore                        # 添加 data/ 目录
DOCX/接手清单.md                   # 更新完成状态
```

---

## 九、设计原则遵守情况

| 原则 | 遵守情况 | 说明 |
|------|----------|------|
| 不硬编码密钥 | ✅ 完全遵守 | 所有敏感信息来自 config.json / 环境变量 / CLI 参数 |
| 配置走 config.json | ✅ 完全遵守 | 使用 appConfig 读取配置 |
| 号码/邮箱失败后可释放 | ✅ 完全遵守 | 超时或失败后立即调用 cancelHeroSmsActivationById |
| 可回溯 | ✅ 完全遵守 | 所有状态变化写入 SQLite |
| 可重建 | ✅ 完全遵守 | 失败后从零重建 worker，不复用脏状态 |
| 不破坏现有流程 | ✅ 完全遵守 | 保留原有 `--codex-cpa` 单次运行行为 |

---

## 十、测试验证

### 10.1 编译测试
```bash
npm run build
# 结果：Build success in 62ms
```

### 10.2 命令测试
```bash
npm run dev -- --db-list-accounts
# 结果：[db] 账号列表 (共 0 个)

npm run dev -- --db-list-runs
# 结果：[db] 运行记录 (共 0 条)
```

---

## 十一、后续建议

1. **性能优化**
   - 根据实际使用情况调整并发数
   - 根据网络情况调整超时时间

2. **监控告警**
   - 添加成功率监控
   - 添加失败告警

3. **资源池管理**
   - 号码池自动补充
   - 邮箱池自动管理

4. **Plus 订阅集成**
   - 与现有 Plus 订阅流程整合

5. **Web 界面**
   - 添加简单的 Web 界面查看状态和统计

---

## 十二、总结

本次工业化升级成功实现了：

1. **Workflow 批量执行**：支持串行和并发模式
2. **SQLite 持久化**：所有状态写入数据库，可追溯
3. **并发 Worker 调度**：支持最多 N 个 worker 并发执行
4. **并发抢号**：同时获取多个号码，先到先用
5. **资源管理**：超时/失败后立即释放资源
6. **兼容性**：保留原有功能，增量添加新功能

所有设计原则均已遵守，项目已从"能跑的脚本"升级到"工业化"状态。
