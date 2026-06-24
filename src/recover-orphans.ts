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

      // Step 2: 登录 OpenAI
      console.log(`[恢复] 登录 OpenAI...`);
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

      // Step 3: 登录 + 绑邮箱 + 拿 callback
      const result = await client.authLoginHTTP();
      console.log(`[恢复] ✓ 登录成功`);

      // Step 4: CPA 入库
      console.log(`[恢复] CPA 入库...`);
      const { submitOAuthCallback } = await import("./cpa-codex.js");
      const authResult = await submitOAuthCallback(cpaBase, cpaKey, result.callbackURL);

      if (authResult.status === 200) {
        console.log(`[恢复] ✓ 入库成功`);
        console.log(`${"═".repeat(60)}`);
        console.log(`✅ 恢复成功 | ${orphan.phone} | ${newEmail}`);
        console.log(`${"═".repeat(60)}\n`);

        db.resolveOrphanedAccount(orphan.id, "自动恢复成功");
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
