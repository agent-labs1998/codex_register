# Codex-Register 文档索引

## 文档列表

### 1. 使用指南（推荐首先阅读）
**文件：** `DOCX/user-guide.md`

**内容：**
- 快速开始
- 单次注册
- Workflow 批量注册
- 并发模式
- 并发抢号模式
- 数据库查询
- 参数说明
- 常见场景
- 故障排查

**适用人群：** 所有用户（新手和老手）

---

### 2. 快速参考卡
**文件：** `DOCX/quick-reference.md`

**内容：**
- 常用命令
- 参数速查表
- 并发模式对比
- Worker 状态机
- 故障排查

**适用人群：** 需要快速查阅命令的用户

---

### 3. Workflow 使用说明
**文件：** `DOCX/workflow-usage.md`

**内容：**
- SQLite 数据库
- Workflow 模式（串行/并发）
- 数据库查询命令
- Worker 状态机
- 数据库结构
- 并发调度器特性
- 并发抢号模式特性

**适用人群：** 需要了解技术细节的用户

---

### 4. 设计方案
**文件：** `DOCX/workflow-local-db-plan.md`

**内容：**
- 背景
- 推荐方案（数据库模块、数据表设计、数据库 helper 函数）
- 工作流改造
- 批量流程
- 成功账号持久化
- 查询和导出命令
- 并发注册（巡视释放模式、数据模型扩展、worker 状态机、并发调度器、资源绑定规则、延迟短信处理策略）
- 落地顺序

**适用人群：** 开发者、架构师

---

### 5. 升级总结
**文件：** `DOCX/upgrade-summary.md`

**内容：**
- 已完成的 3 个阶段
- 新增文件清单
- 使用示例
- 数据库结构
- 设计原则
- 下一步建议

**适用人群：** 需要了解项目整体情况的用户

---

### 6. 任务报告书
**文件：** `DOCX/task-report.md`

**内容：**
- 任务背景
- 任务执行清单
- 实现的功能
- 技术细节
- 文件结构变更
- 设计原则遵守情况
- 测试验证
- 后续建议

**适用人群：** 项目经理、技术负责人

---

### 7. 接手清单
**文件：** `DOCX/接手清单.md`

**内容：**
- 接手优先级
- 当前项目已完成内容
- 当前配置和命令
- 当前架构关键点
- 下一步最该做什么
- 新 agent 接手时不要做的事
- 推荐接手阅读顺序

**适用人群：** 新接手项目的开发者

---

## 文档使用建议

### 新手入门
1. 先读 `DOCX/user-guide.md`（使用指南）
2. 再读 `DOCX/quick-reference.md`（快速参考卡）
3. 实践：运行单次注册 → Workflow 批量注册 → 并发模式

### 开发者
1. 先读 `DOCX/workflow-local-db-plan.md`（设计方案）
2. 再读 `DOCX/workflow-usage.md`（Workflow 使用说明）
3. 最后读源码

### 技术负责人
1. 先读 `DOCX/task-report.md`（任务报告书）
2. 再读 `DOCX/upgrade-summary.md`（升级总结）
3. 最后读 `DOCX/workflow-local-db-plan.md`（设计方案）

### 项目经理
1. 先读 `DOCX/task-report.md`（任务报告书）
2. 再读 `DOCX/upgrade-summary.md`（升级总结）
3. 最后读 `DOCX/quick-reference.md`（快速参考卡）

---

## 文档关系图

```
DOCX/
├── user-guide.md              # 使用指南（推荐首先阅读）
├── quick-reference.md         # 快速参考卡
├── workflow-usage.md          # Workflow 使用说明
├── workflow-local-db-plan.md  # 设计方案
├── upgrade-summary.md         # 升级总结
├── task-report.md             # 任务报告书
├── 接手清单.md                # 接手清单
└── docs-index.md              # 文档索引（本文件）
```

---

## 常见问题

### Q: 我应该先读哪个文档？
A: 如果是新用户，建议先读 `DOCX/user-guide.md`（使用指南）。

### Q: 我只想快速查看命令怎么办？
A: 直接读 `DOCX/quick-reference.md`（快速参考卡）。

### Q: 我想了解技术实现怎么办？
A: 先读 `DOCX/workflow-local-db-plan.md`（设计方案），再读 `DOCX/workflow-usage.md`（Workflow 使用说明）。

### Q: 我想了解项目整体情况怎么办？
A: 先读 `DOCX/task-report.md`（任务报告书），再读 `DOCX/upgrade-summary.md`（升级总结）。

### Q: 我是新接手的开发者，应该怎么做？
A: 按照 `DOCX/接手清单.md` 的顺序阅读，然后按照 `DOCX/user-guide.md` 开始实践。

---

### 8. 返工完成报告
**文件：** `DOCX/rework-completion-report.md`

**内容：**
- 返工概述
- 已修复的问题
- 修改的文件
- 设计变更
- 验收标准检查
- 测试命令
- 还不完美的地方

**适用人群：** 所有用户

---

### 9. 返工快速参考卡
**文件：** `DOCX/rework-quick-reference.md`

**内容：**
- 主要变化
- 使用命令
- 验收标准
- 数据库结构
- Worker 状态机详解
- 错误处理
- 测试场景

**适用人群：** 需要快速查阅的用户

---

### 10. 返工总结
**文件：** `DOCX/rework-summary.md`

**内容：**
- 返工目标达成
- 修改的文件
- 核心设计变更
- 验收标准检查
- 测试命令
- 还不完美的地方
- 结论

**适用人群：** 所有用户

---

### 11. P0 优化报告
**文件：** `DOCX/P0-optimization-report.md`

**内容：**
- P0 优化目标
- 已完成的优化
- 修改的文件
- 验收标准检查
- 测试命令
- 关键设计变更

**适用人群：** 所有用户

---

### 12. P0 优化总结
**文件：** `DOCX/P0-optimization-summary.md`

**内容：**
- P0 目标完成情况
- 修改的文件
- 验收标准检查
- 测试建议
- 关键代码变更
- 两套并发逻辑对比

**适用人群：** 所有用户

---

### 13. P0 验收报告
**文件：** `DOCX/P0-acceptance-report.md`

**内容：**
- 验收日期
- P0 目标完成情况
- 验收标准检查
- 修改的文件清单
- 测试验证
- 关键状态流转
- 数据库表结构
- 结论

**适用人群：** 所有用户

| 日期 | 文档 | 更新内容 |
|------|------|----------|
| 2026-06-16 | P0-optimization-report.md | 创建 P0 优化报告 |
| 2026-06-16 | P0-optimization-summary.md | 创建 P0 优化总结 |
| 2026-06-16 | P0-acceptance-report.md | 创建 P0 验收报告 |
| 2026-06-16 | rework-completion-report.md | 创建返工完成报告 |
| 2026-06-16 | rework-quick-reference.md | 创建返工快速参考卡 |
| 2026-06-16 | rework-summary.md | 创建返工总结 |
| 2026-06-16 | user-guide.md | 创建完整的使用指南 |
| 2026-06-16 | quick-reference.md | 创建快速参考卡 |
| 2026-06-16 | workflow-usage.md | 更新 Workflow 使用说明 |
| 2026-06-16 | workflow-local-db-plan.md | 设计方案（已有） |
| 2026-06-16 | upgrade-summary.md | 创建升级总结 |
| 2026-06-16 | task-report.md | 创建任务报告书 |
| 2026-06-16 | 接手清单.md | 更新接手清单 |
| 2026-06-16 | docs-index.md | 更新文档索引 |
