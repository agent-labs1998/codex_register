import { appConfig } from "./config.js";
import { generateRandomDeviceProfile } from "./device-profile.js";
import { OpenAIClient } from "./openai.js";
import { LocalDB } from "./local-db.js";
import { createCoroabetProvider } from "./mail/coroabet.js";
import { log } from "./logger.js";

export interface RecoverOrphansOptions {
  db: LocalDB;
  maxAttempts?: number;
  cpaBase: string;
  cpaKey: string;
}

export interface RecoverOrphansResult {
  success: number;
  failed: number;
  skipped: number;
}

export async function recoverOrphans(options: RecoverOrphansOptions): Promise<RecoverOrphansResult> {
  const { db, maxAttempts = 10, cpaBase, cpaKey } = options;

  const stats = db.getOrphanedAccountStats();
  console.log(`\n[恢复] 孤儿账号统计: 未解决=${stats.unresolved} | 已解决=${stats.resolved} | 总计=${stats.total}`);

  if (stats.unresolved === 0) {
    console.log("[恢复] 没有需要恢复的孤儿账号");
    return { success: 0, failed: 0, skipped: 0 };
  }

  const orphans = db.getUnresolvedOrphans(maxAttempts);
  console.log(`[恢复] 本次最多恢复 ${orphans.length} 条\n`);

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < orphans.length; i++) {
    const orphan = orphans[i];
    const seq = i + 1;

    console.log(`${"═".repeat(60)}`);
    console.log(`[恢复] 孤儿 #${seq} ${orphan.phone} → 准备恢复...`);
    console.log(`${"═".repeat(60)}`);

    try {
      // Step 1: 创建新邮箱（用 coroabet，每次都生成全新地址，不会重复）
      console.log(`[恢复] 创建新邮箱...`);
      let newEmail: string;
      const coroabet = createCoroabetProvider();
      try {
        newEmail = await coroabet.getEmailAddress();
      } catch (error) {
        const errMsg = (error as Error).message;
        console.log(`[恢复] ❌ 邮箱创建失败: ${errMsg}`);
        if (errMsg.includes("pool") || errMsg.includes("exhausted") || errMsg.includes("no available")) {
          console.log(`[恢复] 邮箱池耗尽，终止恢复`);
          skipped += orphans.length - i;
          break;
        }
        db.updateOrphanedNote(orphan.id, `邮箱创建失败: ${errMsg}`);
        failed++;
        continue;
      }
      console.log(`[恢复] 孤儿 #${seq} ${orphan.phone} → 新邮箱 ${newEmail}`);

      // Step 2: 获取授权 URL（根据 tokenBackend 选择 CPA 或 sub2api）
      const useSub2api = appConfig.tokenBackend === "sub2api" && appConfig.sub2api.baseUrl && appConfig.sub2api.email;
      let authorizeUrl: string;
      let sub2apiSessionId: string | undefined;
      let sub2apiToken: string | undefined;

      if (useSub2api) {
        console.log(`[恢复] 获取 sub2api 授权 URL...`);
        const { getSub2apiToken, generateAuthUrl } = await import("./sub2api.js");
        sub2apiToken = await getSub2apiToken(appConfig.sub2api.baseUrl, appConfig.sub2api.email, appConfig.sub2api.password);
        const result = await generateAuthUrl(appConfig.sub2api.baseUrl, sub2apiToken);
        authorizeUrl = result.authUrl;
        sub2apiSessionId = result.sessionId;
        console.log(`[恢复] ✓ sub2api 授权 URL 已获取`);
      } else {
        console.log(`[恢复] 获取 CPA 授权 URL...`);
        const { requestCodexAuthUrl } = await import("./cpa-codex.js");
        const { authorizeUrl: url } = await requestCodexAuthUrl(cpaBase, cpaKey);
        authorizeUrl = url;
        console.log(`[恢复] ✓ CPA 授权 URL 已获取`);
      }

      // Step 3: 登录 OpenAI 并绑定邮箱（通用，不区分后端）
      console.log(`[恢复] 登录 OpenAI 并绑定邮箱...`);
      const client = new OpenAIClient({
        email: orphan.phone,
        password: orphan.password,
        deviceProfile: generateRandomDeviceProfile(),
        manualMode: false,
        bindEmail: newEmail,
        fetchAddEmailOtp: async () => {
          console.log(`[恢复] 等待邮箱验证码 for ${newEmail}...`);
          return await coroabet.getEmailVerificationCode(newEmail, { minTimestampMs: Date.now() });
        },
      });

      const callbackURL = await client.authLoginViaCpaAuthorizeURL(authorizeUrl);
      console.log(`[恢复] ✓ 拿到 callback URL`);

      // Step 4: 入库（根据 tokenBackend 选择 CPA 或 sub2api）
      let accessToken = "";

      if (useSub2api) {
        // ─── sub2api 路径：createFromOAuth 一步完成 ───
        console.log(`[恢复] sub2api 入库...`);
        const { createFromOAuth } = await import("./sub2api.js");

        const url = new URL(callbackURL);
        const code = url.searchParams.get("code") || "";
        const state = url.searchParams.get("state") || "";
        if (!code) throw new Error(`callback URL 中没有 code: ${callbackURL.slice(0, 200)}`);

        const createResult = await createFromOAuth(appConfig.sub2api.baseUrl, sub2apiToken!, sub2apiSessionId!, code, state, appConfig.sub2api.groupIds);

        if (!createResult.success) {
          throw new Error(`sub2api 入库失败: status=${createResult.status} body=${createResult.body.slice(0, 300)}`);
        }
        accessToken = "";
        console.log(`[恢复] ✓ sub2api 入库成功`);

      } else {
        // ─── CPA 路径 ───
        console.log(`[恢复] CPA 入库...`);
        const { submitOAuthCallback, listAuthFiles, downloadAuthFile, deleteAuthFile } = await import("./cpa-codex.js");
        const authResult = await submitOAuthCallback(cpaBase, cpaKey, callbackURL);

        if (authResult.status !== 200) {
          throw new Error(`CPA 入库失败: status=${authResult.status} body=${authResult.body.slice(0, 300)}`);
        }
        console.log(`[恢复] ✓ CPA 入库响应成功`);

        // 拉取 auth 文件获取 access_token
        const newEmailLc = newEmail.toLowerCase();
        const oldEmailLc = orphan.email.toLowerCase();
        const candidates = [
          `codex-${newEmailLc}.json`, `codex-${newEmailLc}-plus.json`,
          `codex-${oldEmailLc}.json`, `codex-${oldEmailLc}-plus.json`,
        ].filter((v, i, a) => a.indexOf(v) === i);

        let matchedFileName = "";
        for (let attempt = 1; attempt <= 12; attempt++) {
          const files = await listAuthFiles(cpaBase, cpaKey);
          const match = files.find((f: any) => candidates.includes(String(f.name || "").toLowerCase()));
          if (match) {
            console.log(`[恢复] ✓ 匹配到 auth 文件: ${match.name}`);
            const auth = await downloadAuthFile(cpaBase, cpaKey, match.name);
            accessToken = String(auth?.access_token || "").trim();
            matchedFileName = match.name;
            break;
          }
          if (attempt < 12) await new Promise(r => setTimeout(r, 3000));
        }

        // 删除 CPA 旧记录
        if (matchedFileName) {
          try {
            await deleteAuthFile(cpaBase, cpaKey, matchedFileName);
            console.log(`[恢复] ✓ 已删除 CPA 旧记录: ${matchedFileName}`);
          } catch (e) {
            console.log(`[恢复] ⚠ 删除旧 auth 文件失败: ${(e as Error).message}`);
          }
        }
      }

      // Step 5: 写入 accounts 表
      if (accessToken) {
        db.saveAccount({
          phone: orphan.phone,
          email: newEmail,
          password: orphan.password,
          access_token: accessToken,
          token_expires_at: null,
          cpa_auth_file: "",
          cpa_base_url: useSub2api ? appConfig.sub2api.baseUrl : cpaBase,
          token_backend: useSub2api ? "sub2api" : "cpa",
          status: "active",
        });
        console.log(`[恢复] ✓ 已写入 accounts 表（邮箱: ${newEmail}）`);
      } else {
        console.log(`[恢复] ⚠ 未获取到 access_token，但入库成功`);
      }

      console.log(`${"═".repeat(60)}`);
      console.log(`✅ 恢复成功 | ${orphan.phone} | ${newEmail} | ${useSub2api ? "sub2api" : "CPA"}`);
      console.log(`${"═".repeat(60)}\n`);

      db.resolveOrphanedAccount(orphan.id, "自动恢复成功", newEmail);
      success++;
    } catch (error) {
      const errMsg = (error as Error).message;
      console.log(`[恢复] ❌ 恢复失败: ${errMsg}`);

      if (errMsg.includes("account_not_found") || errMsg.includes("invalid_credentials") || errMsg.includes("invalid_username_or_password")) {
        console.log(`[恢复] 账号不存在或密码错误，标记 openai_registered=0`);
        // 密码错误说明该手机号未在 OpenAI 注册成功，更新状态
        db.updateOrphanedAccountRegistered(orphan.id, 0);
        db.resolveOrphanedAccount(orphan.id, `未注册成功: ${errMsg}`);
      } else {
        db.updateOrphanedNote(orphan.id, errMsg);
      }
      failed++;
    }

    // 随机延迟 10-30 秒
    if (i < orphans.length - 1) {
      const delay = Math.floor(Math.random() * 20000) + 10000;
      console.log(`[恢复] 等待 ${Math.round(delay / 1000)} 秒后继续...\n`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.log(`\n[恢复] ===== 恢复完成 =====`);
  console.log(`[恢复] 成功: ${success} | 失败: ${failed} | 跳过: ${skipped}\n`);

  return { success, failed, skipped };
}
