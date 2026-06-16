# 交接手册

## 一、项目概述
- **项目：** codex-register
- **功能：** CPA 注册批量工具
- **技术栈：** TypeScript + Node.js 22 + SQLite

---

## 二、交接顺序

### 第 1 步：快速了解（5 分钟）
1. `DOCX/workflow-local-db-plan.md` - 设计方案
2. `DOCX/接手清单.md` - 当前状态

### 第 2 步：使用指南（10 分钟）
1. `DOCX/user-guide.md` - 使用方法
2. `DOCX/quick-reference.md` - 命令速查

### 第 3 步：核心代码（20 分钟）
1. `src/index.ts` - 主入口
2. `src/cpa-registration.ts` - 注册逻辑
3. `src/concurrent-registration.ts` - 并发抢号
4. `src/local-db.ts` - 数据库
5. `src/sms/hero-patrol.ts` - 巡视器

### 第 4 步：测试验证（10 分钟）
1. `DOCX/final-quick-start.md` - 测试命令

---

## 三、核心文件清单

| 文件 | 作用 |
|------|------|
| `src/index.ts` | 主入口，CLI 参数解析 |
| `src/cpa-registration.ts` | CPA 注册逻辑，SMS 等待 65 秒 |
| `src/concurrent-registration.ts` | 并发抢号，实时写 DB |
| `src/worker-scheduler.ts` | Worker 调度器 |
| `src/local-db.ts` | SQLite 数据库操作 |
| `src/sms/hero-patrol.ts` | 巡视器，120 秒释放号码 |
| `src/config.ts` | 配置加载 |
| `config.json` | 项目配置（密钥等） |

---

## 四、数据库表

| 表名 | 作用 |
|------|------|
| `workflow_runs` | 工作流运行记录 |
| `registration_attempts` | 注册尝试记录 |
| `accounts` | 成功账号 |
| `worker_slots` | Worker 状态 |

---

## 五、测试命令

```bash
# 查看数据库
npm run dev -- --db-list-accounts
npm run dev -- --db-list-runs
npm run dev -- --db-list-workers

# 并发抢号测试
npm run dev -- --workflow codex-cpa-register --count 3 --concurrency 3 --concurrent-pool --skip-probe-trial --token-out test_tokens.txt
```

---

## 六、关键配置（config.json）

```json
{
  "heroSMSApiKey": "HeroSMS API 密钥",
  "cliproxyApiBaseUrl": "CPA API 地址",
  "cliproxyApiManagementKey": "CPA 管理密钥",
  "coroabetWorkerDomain": "邮箱域名",
  "defaultPassword": "默认密码"
}
```

---

## 七、核心逻辑

### SMS 等待
- Worker 只等待 65 秒
- 超时立即释放
- 巡视器 120 秒后释放号码

### 并发抢号
- 同时获取多个号码
- 实时写入 DB
- 先收到验证码优先使用

---

## 八、文档索引

| 文档 | 说明 |
|------|------|
| `DOCX/workflow-local-db-plan.md` | 设计方案 |
| `DOCX/接手清单.md` | 接手指南 |
| `DOCX/user-guide.md` | 使用指南 |
| `DOCX/quick-reference.md` | 命令速查 |
| `DOCX/final-quick-start.md` | 测试指南 |
| `DOCX/all-optimizations-summary.md` | 优化总结 |

---

## 九、注意事项

1. **不硬编码密钥** - 所有配置走 config.json
2. **SMS 120 秒限制** - HeroSMS 需要 120 秒后才能释放
3. **Worker 65 秒** - Worker 只等待 65 秒
4. **数据库是主存储** - tokens.txt 只是导出产物
5. **巡视器独立运行** - 程序运行期间持续扫描

---

## 十、快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置
cp config.example.json config.json
# 编辑 config.json

# 3. 构建
npm run build

# 4. 测试
npm run dev -- --db-list-accounts

# 5. 运行
npm run dev -- --workflow codex-cpa-register --count 1 --token-out tokens.txt
```
