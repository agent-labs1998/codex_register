# 注册失败 Bug 修复报告

> 日期：2026-06-18 | 状态：已修复并验证

---

## 一、问题现象

连续 210+ 次注册全部失败，0 个成功账号。所有失败都表现为同一症状：

```
SMS wait timeout: 65000ms 内未收到验证码
```

号码取到了，邮箱创建了，但验证码永远收不到。

---

## 二、根因分析

排查发现**两个 Bug 叠加**导致了问题。

### Bug 1：注册流程顺序反了（致命）

**文件：** `src/cpa-registration.ts`

**错误的流程（修复前）：**
```
1. 取号（HeroSMS）
2. 创建邮箱（coroabet）
3. 等待 SMS 验证码（65 秒超时）    ← 先等！
4. 收到码后才注册 OpenAI            ← 后注册！
```

**正确的流程（修复后）：**
```
1. 取号（HeroSMS）
2. 创建邮箱（coroabet）
3. 注册 OpenAI（触发发短信）        ← 先注册！
4. 同时等待 SMS 验证码（65 秒超时）  ← 再等！
```

**为什么收不到验证码：** 程序先等验证码再注册 OpenAI，但 OpenAI 还没收到注册请求，根本不会发短信。号码挂在 HeroSMS 上等了 65 秒，没有任何短信进来，超时失败。

**对比老版本（`codex_register_V1`）：** 老版本的流程是正确的——`authPhoneSignupHTTP` 内部先注册 OpenAI（触发短信），然后通过回调函数等待验证码。新版本在重构为 workflow 模式时，把流程顺序搞反了。

### Bug 2：代理未配置导致请求失败

**文件：** `config.json`

**问题：** `defaultProxyUrl` 为空。虽然服务器上 Clash 以 TUN 模式运行（系统级全局代理），但程序内部的 HTTP 请求通过原生 `fetch` 发出，在某些情况下 TLS 握手会失败。

**具体表现：**
- `coroabet.ts` 的 `createAddress` 请求 `mail.coroabet777.com` 时 TLS 握手失败（curl exit code 35）
- 错误信息：`fetch failed`
- 堆栈：`createAddress (coroabet.ts:51) → getEmailAddress (coroabet.ts:121)`

**为什么 Clash TUN 模式下还会失败：** TUN 模式拦截的是系统网络层的 TCP/UDP 数据包，但 Node.js 的原生 `fetch` 在 TLS 层有独立的证书验证逻辑，两者存在兼容性问题。通过 Clash 的 HTTP 代理端口（7890）显式走代理，可以避免这个问题。

---

## 三、修复内容

### 修复 1：注册流程顺序

**文件：** `src/cpa-registration.ts`

将 `authPhoneSignupHTTP` 调用移到 SMS 等待之前。`authPhoneSignupHTTP` 内部通过 `fetchPhoneCode` 回调函数等待验证码，实现了"先触发发短信、再等验证码"的正确顺序。

核心改动：
```typescript
// 修复前：先等码，再注册
const result = await phoneLease.waitForVerificationCode();  // ← 永远等不到
await signupClient.authPhoneSignupHTTP(phoneNumber, async () => smsCode);

// 修复后：先注册（触发发短信），通过回调等码
await signupClient.authPhoneSignupHTTP(phoneNumber, async () => {
    // 这个回调在 authPhoneSignupHTTP 内部的 Step 4 被调用
    // 此时 OpenAI 已经在 Step 3 触发了短信发送
    const result = await phoneLease.waitForVerificationCode();
    return result;
});
```

### 修复 2：代理配置

**文件：** `config.json`（服务器 `/root/github/codex/config.json`）

```json
"defaultProxyUrl": "http://127.0.0.1:7890"
```

填写 Clash 的 HTTP 代理端口，让所有 HTTP 请求（包括 coroabet 邮箱、HeroSMS、OpenAI API）都通过 Clash 代理发出。

---

## 四、验证结果

修复后首次运行即成功：

```
[register] 注册响应: continue_url=/phone-otp/send        ✅ OpenAI 接受注册
[otp-send] 响应: continue_url=/contact-verification       ✅ 短信已触发
[pollSMSCode] outcome=success                             ✅ 收到验证码
[cpa-registration] 收到验证码: 683532                      ✅ 验证码正确
[cpa-registration] phone signup 成功                       ✅ 注册完成
[cpa-registration] 从 CPA 拿到 access_token                ✅ Token 入库
[workflow] ✅ 第 1 次成功                                  ✅ 整体成功
```

---

## 五、影响范围

| 项目 | 说明 |
|------|------|
| 影响版本 | 当前 master 分支（workflow 模式） |
| 不影响版本 | `codex_register_V1`（老版本，流程正确） |
| 影响模式 | 所有 CPA 注册模式（串行、并发、抢号） |
| 修复文件数 | 2 个（`src/cpa-registration.ts`、`config.json`） |
