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

---

### 14. SMS 等待逻辑优化说明
**文件：** `DOCX/sms-wait-logic-optimization.md`

**内容：**
- 问题分析
- 新的 SMS 等待逻辑
- 时间设计
- 代码修改
- 工作流程
- 优势
- 测试命令
- 配置建议
- 监控指标

**适用人群：** 所有用户

---

### 15. SMS 等待逻辑测试结果
**文件：** `DOCX/sms-wait-logic-test-result.md`

**内容：**
- 测试日期
- 测试命令
- 测试结果
- 时间线分析
- 验证要点
- HeroSMS 限制说明
- 巡视器角色
- 并发效率分析
- 结论

**适用人群：** 所有用户

---

### 16. SMS 等待逻辑优化完成总结
**文件：** `DOCX/sms-wait-logic-optimization-summary.md`

**内容：**
- 优化目标
- 已完成的优化
- 时间设计
- 测试结果
- 优势
- 并发效率分析
- 验收标准
- 相关文档
- 测试命令
- 结论
- 下一步建议

**适用人群：** 所有用户

---

### 17. 巡视器问题修复说明
**文件：** `DOCX/patrol-fix-explanation.md`

**内容：**
- 问题分析
- 修复内容
- 巡视器工作流程
- 时间设计
- 测试命令
- 巡视器职责
- 用户需求分析
- 测试场景
- 监控指标
- 结论

**适用人群：** 所有用户

---

### 18. 巡视器工作原理说明
**文件：** `DOCX/patrol-working-principle.md`

**内容：**
- 巡视器概述
- 巡视器工作流程
- 巡视器代码结构
- 巡视器日志输出
- 测试巡视器
- 巡视器与 Worker 的关系
- 巡视器日志分析
- 巡视器配置
- 巡视器 API
- 巡视器监控
- 常见问题
- 总结
- 测试建议

**适用人群：** 所有用户

---

### 19. 巡视器测试指南
**文件：** `DOCX/patrol-testing-guide.md`

**内容：**
- 测试目标
- 测试前准备
- 测试场景
- 巡视器日志分析
- 验证检查清单
- 常见问题
- 测试脚本
- 监控指标
- 测试报告模板
- 相关文档

**适用人群：** 所有用户

---

### 20. 巡视器修复和测试总结
**文件：** `DOCX/patrol-fix-summary.md`

**内容：**
- 问题修复
- 巡视器工作原理
- 时间设计
- 测试方法
- 巡视器日志
- 验收标准
- 相关文档
- 测试建议
- 结论
- 下一步

**适用人群：** 所有用户

---

### 21. 最终测试指南
**文件：** `DOCX/final-testing-guide.md`

**内容：**
- 测试前准备
- 测试命令
- 验证检查清单
- 常见问题
- 测试脚本
- 监控指标
- 测试报告模板
- 相关文档

**适用人群：** 所有用户

---

### 22. 所有优化完成总结
**文件：** `DOCX/all-optimizations-summary.md`

**内容：**
- 优化清单
- 修改的文件
- 验收标准
- 测试命令
- 关键时间设计
- 并发效率分析
- 相关文档
- 测试建议
- 监控指标
- 结论
- 下一步建议

**适用人群：** 所有用户

---

### 23. 快速开始测试
**文件：** `DOCX/quick-start-testing.md`

**内容：**
- 一键测试
- 测试命令速查
- 验证要点
- 常见问题
- 相关文档

**适用人群：** 所有用户

---

### 24. 最终快速开始指南
**文件：** `DOCX/final-quick-start.md`

**内容：**
- 一键测试（复制粘贴）
- 测试命令速查
- 验证要点
- 常见问题
- 相关文档

**适用人群：** 所有用户

---

### 25. 最终总结
**文件：** `DOCX/final-summary.md`

**内容：**
- 所有优化完成
- 测试命令
- 验证要点
- 相关文档
- 结论
- 下一步

**适用人群：** 所有用户

| 日期 | 文档 | 更新内容 |
|------|------|----------|
| 2026-06-16 | final-testing-guide.md | 创建最终测试指南 |
| 2026-06-16 | all-optimizations-summary.md | 创建所有优化完成总结 |
| 2026-06-16 | patrol-fix-explanation.md | 创建巡视器问题修复说明 |
| 2026-06-16 | patrol-working-principle.md | 创建巡视器工作原理说明 |
| 2026-06-16 | patrol-testing-guide.md | 创建巡视器测试指南 |
| 2026-06-16 | patrol-fix-summary.md | 创建巡视器修复和测试总结 |
| 2026-06-16 | sms-wait-logic-optimization.md | 创建 SMS 等待逻辑优化说明 |
| 2026-06-16 | sms-wait-logic-test-result.md | 创建 SMS 等待逻辑测试结果 |
| 2026-06-16 | sms-wait-logic-optimization-summary.md | 创建 SMS 等待逻辑优化完成总结 |
| 2026-06-16 | P0-optimization-report.md | 创建 P0 优化报告 |
| 2026-06-16 | P0-optimization-summary.md | 创建 P0 优化总结 |
| 2026-06-16 | P0-acceptance-report.md | 创建 P0 验收报告 |
| 2026-06-16 | P0-acceptance-checklist.md | 创建 P0 验收清单 |
| 2026-06-16 | rework-completion-report.md | 创建返工完成报告 |
| 2026-06-16 | rework-quick-reference.md | 创建返工快速参考卡 |
| 2026-06-16 | rework-summary.md | 创建返工总结 |
| 2026-06-16 | rework-deliverables.md | 创建返工交付物清单 |
| 2026-06-16 | user-guide.md | 创建完整的使用指南 |
| 2026-06-16 | quick-reference.md | 创建快速参考卡 |
| 2026-06-16 | workflow-usage.md | 更新 Workflow 使用说明 |
| 2026-06-16 | workflow-local-db-plan.md | 设计方案（已有） |
| 2026-06-16 | upgrade-summary.md | 创建升级总结 |
| 2026-06-16 | task-report.md | 创建任务报告书 |
| 2026-06-16 | 接手清单.md | 更新接手清单 |
| 2026-06-16 | docs-index.md | 更新文档索引 |
