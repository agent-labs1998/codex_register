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

      // Step 2: 获取 CPA 授权 URL
      console.log(`[恢复] 获取 CPA 授权 URL...`);
      const { requestCodexAuthUrl, submitOAuthCallback } = await import("./cpa-codex.js");
      const { authorizeUrl } = await requestCodexAuthUrl(cpaBase, cpaKey);
      console.log(`[恢复] ✓ CPA 授权 URL 已获取`);

      // Step 3: 用 CPA 授权 URL 登录（走手机号+密码 → 绑新邮箱 → 收验证码 → 拿 callback）
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

      // Step 4: CPA 入库
      console.log(`[恢复] CPA 入库...`);
      const authResult = await submitOAuthCallback(cpaBase, cpaKey, callbackURL);

      if (authResult.status === 200) {
        console.log(`[恢复] ✓ CPA 入库响应成功`);

        // Step 5: 拉取 auth 文件获取 access_token
        console.log(`[恢复] 拉取 auth 文件...`);
        const { listAuthFiles, downloadAuthFile } = await import("./cpa-codex.js");
        const emailLc = newEmail.toLowerCase();
        const candidates = [`codex-${emailLc}.json`, `codex-${emailLc}-plus.json`];

        let accessToken = "";
        for (let attempt = 1; attempt <= 12; attempt++) {
          const files = await listAuthFiles(cpaBase, cpaKey);
          const match = files.find((f: any) => candidates.includes(String(f.name || "").toLowerCase()));
          if (match) {
            console.log(`[恢复] ✓ 匹配到 auth 文件: ${match.name}`);
            const auth = await downloadAuthFile(cpaBase, cpaKey, match.name);
            accessToken = String(auth?.access_token || "").trim();
            break;
          }
          if (attempt < 12) {
            await new Promise(r => setTimeout(r, 3000));
          }
        }

        if (accessToken) {
          // Step 6: 写入 accounts 表
          db.saveAccount({
            phone: orphan.phone,
            email: newEmail,
            password: orphan.password,
            access_token: accessToken,
            token_expires_at: null,
            cpa_auth_file: "",
            cpa_base_url: cpaBase,
            status: "active",
          });
          console.log(`[恢复] ✓ 已写入 accounts 表`);
        } else {
          console.log(`[恢复] ⚠ 未获取到 access_token，但 CPA 入库成功`);
        }

        console.log(`${"═".repeat(60)}`);
        console.log(`✅ 恢复成功 | ${orphan.phone} | ${newEmail}`);
        console.log(`${"═".repeat(60)}\n`);

        db.resolveOrphanedAccount(orphan.id, "自动恢复成功", newEmail);
        success++;
      } else {
        const errMsg = `CPA 入库失败: status=${authResult.status}, body=${authResult.body}`;
        console.log(`[恢复] ❌ ${errMsg}`);
        db.updateOrphanedNote(orphan.id, errMsg);
        failed++;
      }
    } catch (error) {
      const errMsg = (error as Error).message;
      console.log(`[恢复] ❌ 恢复失败: ${errMsg}`);

      if (errMsg.includes("account_not_found") || errMsg.includes("invalid_credentials")) {
        console.log(`[恢复] 账号不存在或密码错误，标记为无法恢复`);
        db.resolveOrphanedAccount(orphan.id, `无法恢复: ${errMsg}`);
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
