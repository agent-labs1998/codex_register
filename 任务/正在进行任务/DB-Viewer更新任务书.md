# 任务：更新 DB Viewer Web 服务

## 目标
为 DB Viewer Web 服务新增两个数据库表的展示：`hotmail_accounts`（邮箱池管理）和 `orphaned_accounts`（孤儿账号）。

---

## 第一步：连接服务器（只读数据库，不要修改数据库）

```bash
ssh openai
```

---

## 第二步：数据库表结构（已确认，不需要再查）

数据库路径：`/root/github/codex/data/codex-register.sqlite`

### 表 1：`hotmail_accounts`（Hotmail 邮箱池管理）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键自增 |
| `email` | TEXT NOT NULL UNIQUE | 邮箱地址 |
| `password` | TEXT NOT NULL | 邮箱密码 |
| `client_id` | TEXT | OAuth client_id |
| `refresh_token` | TEXT | OAuth refresh_token |
| `status` | TEXT NOT NULL DEFAULT 'unused' | 状态：`unused`/`used`/`failed`/`retryable` |
| `used_at` | TEXT | 使用时间 |
| `created_at` | TEXT | 创建时间 |

**status 含义：**
- `unused` — 全新未使用（绿色）
- `retryable` — 曾失败但可重试（黄色）
- `used` — 已成功使用（蓝色）
- `failed` — 邮箱已被占用，不可再用（红色）

### 表 2：`orphaned_accounts`（孤儿账号）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER | 主键自增 |
| `phone` | TEXT NOT NULL | 手机号（OpenAI 已注册成功） |
| `email` | TEXT NOT NULL | 绑定失败的邮箱 |
| `password` | TEXT NOT NULL | 注册密码 |
| `activation_id` | TEXT | HeroSMS 激活 ID |
| `error_type` | TEXT NOT NULL | 失败类型：`email_already_in_use`/`email_otp_failed`/`cpa_callback_failed`/`other` |
| `error_message` | TEXT | 完整错误信息 |
| `sms_code` | TEXT | 收到的短信验证码 |
| `openai_registered` | INTEGER DEFAULT 1 | OpenAI 是否已注册：1=是，0=否 |
| `resolved` | INTEGER DEFAULT 0 | 是否已手动解决：0=未解决，1=已解决 |
| `resolved_at` | TEXT | 解决时间 |
| `resolved_note` | TEXT | 手动备注 |
| `created_at` | TEXT | 创建时间 |

**中文列名映射（前端显示用）：**

```
邮箱池 Tab：
id → ID, email → 邮箱, status → 状态, used_at → 使用时间, created_at → 创建时间
（不显示 password、client_id、refresh_token，太长且敏感）

孤儿账号 Tab：
id → ID, phone → 手机号, email → 邮箱, error_type → 失败类型, 
error_message → 错误信息, sms_code → 验证码, openai_registered → 已注册,
resolved → 已解决, created_at → 创建时间
（不显示 password、activation_id、resolved_at、resolved_note）
```

---

## 第三步：查看现有 DB Viewer 代码

代码路径：`/root/github/db-viewer/`

```bash
cat /root/github/db-viewer/server.js      # 后端 API
cat /root/github/db-viewer/index.html     # 前端页面
```

---

## 第四步：需要修改的内容

### server.js 改动

在现有的 API 路由中新增两个接口：

1. `/api/hotmail` — 查询 `hotmail_accounts` 表
   - SQL: `SELECT id, email, status, used_at, created_at FROM hotmail_accounts ORDER BY id DESC`
   - 不返回 password、client_id、refresh_token（敏感数据）

2. `/api/orphans` — 查询 `orphaned_accounts` 表
   - SQL: `SELECT id, phone, email, error_type, error_message, sms_code, openai_registered, resolved, created_at FROM orphaned_accounts ORDER BY id DESC`
   - 不返回 password、activation_id

3. `/api/stats` — 更新统计，新增两个字段
   - 添加 `hotmmail: count(db, "hotmail_accounts")` 和 `orphans: count(db, "orphaned_accounts")`

参考现有的 `/api/accounts` 写法风格。

### index.html 改动

在 TABS 数组中新增两个 Tab，放在最后：

```javascript
{ key: "hotmail", label: "邮箱池", api: "/api/hotmail", 
  cols: ["id","email","status","used_at","created_at"], 
  colNames: {id:"ID", email:"邮箱", status:"状态", used_at:"使用时间", created_at:"创建时间"} },

{ key: "orphans", label: "孤儿账号", api: "/api/orphans", 
  cols: ["id","phone","email","error_type","error_message","sms_code","openai_registered","resolved","created_at"], 
  colNames: {id:"ID", phone:"手机号", email:"邮箱", error_type:"失败类型", error_message:"错误信息", 
             sms_code:"验证码", openai_registered:"已注册", resolved:"已解决", created_at:"创建时间"} }
```

**badge 颜色映射：**
- 邮箱池 status：`unused`=绿色(badge-active)、`used`=蓝色(badge-running)、`failed`=红色(badge-failed)、`retryable`=黄色(badge-partial)
- 孤儿账号 resolved：`0`=红色(未解决)、`1`=绿色(已解决)
- 孤儿账号 openai_registered：`1`="是"、`0`="否"

**stats 区域更新：**
- 添加两个 stat：`邮箱池: X` 和 `孤儿账号: X`

---

## 第五步：测试和重启

```bash
# 重启服务
systemctl restart db-viewer

# 验证 API
curl http://127.0.0.1:8002/api/hotmail
curl http://127.0.0.1:8002/api/orphans

# 验证页面
curl http://127.0.0.1:8002 | head -5
```

---

## 注意事项

1. **数据库只读** — 只用 `SELECT` 查询，不要执行 `INSERT`/`UPDATE`/`DELETE`/`DROP`
2. **保持现有功能** — 不要改动已有的 accounts、runs、workers、attempts 四个 Tab
3. **风格一致** — 新增的 Tab 和 API 要与现有的写法保持一致
4. **中文界面** — 所有标签和列名使用中文（参考现有 Tab 的中文风格）
