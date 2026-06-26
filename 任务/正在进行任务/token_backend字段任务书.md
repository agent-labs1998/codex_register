# 任务书：数据库 accounts 表新增入库后端字段

> 优先级：高 | 预计工作量：20 分钟 | 审核人：CTO

---

## 零、你要做什么

**你的任务是写代码，不是分析。**

代码路径：`A:\Github\codex_register\`

在 accounts 表新增 `token_backend` 字段，记录每个账号是通过哪个后端入库的（CPA 或 sub2api）。

完成后执行 `cd A:/Github/codex_register && npm run build` 验证构建。

---

## 一、问题

当前 accounts 表无法区分账号是 CPA 入库还是 sub2api 入库。管理时不知道该去哪个后端查、续期、排障。

---

## 二、具体改动

### 2.1 修改 `src/local-db.ts`

**accounts 表加字段：** 在 CREATE TABLE 中新增：
```sql
token_backend TEXT DEFAULT 'cpa'  -- cpa / sub2api
```

**Account 接口加字段：**
```typescript
token_backend: string;
```

**saveAccount 方法：** 加 `token_backend` 参数

**兼容旧数据库：** 在 init() 末尾加 ALTER TABLE（参考 orphaned_accounts 的 recovered_email 写法）：
```typescript
try {
    this.db.prepare("ALTER TABLE accounts ADD COLUMN token_backend TEXT DEFAULT 'cpa'").run();
} catch {
    // 列已存在，忽略
}
```

### 2.2 修改 `src/cpa-registration.ts`

saveAccount 调用处加上 `token_backend`：

- CPA 路径：`token_backend: "cpa"`
- sub2api 路径：`token_backend: "sub2api"`

### 2.3 修改 `src/index.ts`

经典模式的 saveAccount 调用处也加上 `token_backend`：
- CPA 路径：`token_backend: "cpa"`
- sub2api 路径：`token_backend: "sub2api"`

### 2.4 修改 `src/recover-orphans.ts`

恢复成功后 saveAccount 也加上 `token_backend`（根据当前 tokenBackend 配置）。

### 2.5 不修改的文件

- `src/openai.ts` — 不改
- `src/cpa-codex.ts` — 不改
- `src/sub2api.ts` — 不改

---

## 三、验收标准

1. `npm run build` 构建成功
2. 新建的账号记录包含 `token_backend` 字段
3. 旧数据库兼容（ALTER TABLE 自动加列）

---

## 四、报告要求

完成后将报告写到 `A:\Github\codex_register\任务\任务报告\token_backend字段报告.md`
