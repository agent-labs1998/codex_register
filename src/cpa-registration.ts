import { appConfig } from "./config.js";
import { generateRandomDeviceProfile } from "./device-profile.js";
import { OpenAIClient } from "./openai.js";
import { SMSActivationLease } from "./sms/index.js";
import { getIpInfo, resetIpCache } from "./ip-detect.js";
import { proxyFetch } from "./proxy-fetch.js";
import { log } from "./logger.js";

export interface RegistrationTask {
  workerId: string;
  attemptId: number;
  phoneLease: SMSActivationLease;
  phoneNumber: string;
  activationId: string;
  bindEmail?: string;
  fetchAddEmailOtp?: () => Promise<string>;
  deadlines: {
    smsDeadlineAt: number;
    emailDeadlineAt: number;
    cpaDeadlineAt: number;
  };
  onStatusChange?: (status: string) => void;
  db?: {
    updateWorkerSlot(workerId: string, data: Record<string, any>): void;
    updateAttempt(attemptId: number, data: Record<string, any>): void;
    markHotmailAccountFailed?(email: string): void;
    resetHotmailAccount?(email: string): void;
    saveOrphanedAccount?(account: {
      phone: string;
      email: string;
      password: string;
      activation_id?: string;
      error_type: string;
      error_message?: string;
      sms_code?: string | null;
      openai_registered?: number;
    }): void;
  };
}

export interface CodexCpaResult {
  status: "ok" | "no_trial" | "failed";
  phone: string;
  email: string;
  password: string;
  accessToken?: string;
  cpaAuthFile?: string;
  error?: string;
  activationId?: string;
  workerId?: string;
  attemptId?: number;
  ipAddress?: string;
  ipCountry?: string;
  ipCity?: string;
  ipIsp?: string;
  ipIsResidential?: boolean;
}

async function cancelActivation(activationId: string): Promise<void> {
  const apiKey = String(appConfig.heroSMSApiKey ?? "").trim();
  if (!apiKey || !activationId) {
    return;
  }
  const url = `https://hero-sms.com/stubs/handler_api.php?api_key=${encodeURIComponent(apiKey)}&action=setStatus&id=${encodeURIComponent(activationId)}&status=8`;
  try {
    const res = await proxyFetch(url, { method: "GET" });
    const body = await res.text();
    const upper = body.toUpperCase();
    if (upper.includes("ACCESS_CANCEL") || upper.includes("ACCESS_READY") || upper.includes("BAD_STATUS") || upper.includes("NO_ACTIVATION")) {
      console.log(`[巡视释放] cancel activationId=${activationId} response=${body.slice(0, 120)}`);
      return;
    }
    console.warn(`[巡视释放] cancel activationId=${activationId} unexpected=${body.slice(0, 200)}`);
  } catch (error) {
    console.warn(`[巡视释放] cancel activationId=${activationId} failed=${(error as Error).message}`);
  }
}

export async function runCpaRegistration(task: RegistrationTask): Promise<CodexCpaResult> {
  const { workerId, attemptId, phoneLease, phoneNumber, activationId, deadlines, onStatusChange, db } = task;
  const password = appConfig.defaultPassword;
  const cpaBase = appConfig.cpa.baseUrl || "";
  const cpaKey = appConfig.cpa.managementKey || "";

  if (!cpaKey) {
    return {
      status: "failed",
      phone: phoneNumber,
      email: task.bindEmail || "",
      password,
      error: "Missing CPA management key",
      activationId,
      workerId,
      attemptId,
    };
  }

  const reportStatus = (status: string) => {
    log.info(`[cpa-registration] ${workerId} -> ${status}`);
    onStatusChange?.(status);
  };

  // Step 1: Phone signup（注册 OpenAI 触发发短信 + 等验证码一体化）
  reportStatus("registering");
  console.log(`\n${"═".repeat(60)}`);
  console.log(`[注册] ${workerId} 号码=${phoneNumber}`);
  console.log(`${"═".repeat(60)}`);

  const signupClient = new OpenAIClient({
    email: undefined,
    password,
    deviceProfile: generateRandomDeviceProfile(),
    manualMode: false,
    smsBroker: undefined,
  });

  let smsCode: string;
  const SMS_WAIT_TIMEOUT_MS = 65_000;

  try {
    const sigRes = await signupClient.authPhoneSignupHTTP(phoneNumber, async () => {
      console.log(`[cpa-registration] ${workerId} 等待 SMS 验证码...`);
      reportStatus("waiting_sms");

      const result = await Promise.race([
        phoneLease.waitForVerificationCode().then(v => v.code),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), SMS_WAIT_TIMEOUT_MS);
        }),
      ]);

      if (!result) {
        throw new Error(`SMS wait timeout: ${SMS_WAIT_TIMEOUT_MS}ms`);
      }

      console.log(`[cpa-registration] ${workerId} 收到验证码: ${result}`);
      reportStatus("sms_received");
      smsCode = result;
      return result;
    });

    console.log(`[cpa-registration] ${workerId} phone signup 成功`);
  } catch (error) {
    const errMsg = (error as Error).message;
    reportStatus(errMsg.includes("timeout") ? "timed_out" : "failed");
    return {
      status: "failed",
      phone: phoneNumber,
      email: task.bindEmail || "",
      password,
      error: `Phone signup failed: ${errMsg}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 2: 创建邮箱（延迟到注册成功后才创建，避免失败时浪费邮箱资源）
  let bindEmail = task.bindEmail;
  let fetchAddEmailOtp = task.fetchAddEmailOtp;

  if (!bindEmail) {
    try {
      const mailbox = await import("./mailbox.js");
      bindEmail = await mailbox.getEmailAddress();
      fetchAddEmailOtp = async () => {
        const startedAt = Date.now();
        console.log(`[cpa-registration] ${workerId} 等待邮件 OTP for ${bindEmail}`);
        return await mailbox.getEmailVerificationCode(bindEmail, { minTimestampMs: startedAt });
      };
      console.log(`[CPA] 邮箱已创建: ${bindEmail}`);

      // 更新 db
      if (db) {
        db.updateWorkerSlot(workerId, { bind_email: bindEmail });
        db.updateAttempt(attemptId, { email: bindEmail });
      }
    } catch (error) {
      reportStatus("failed");
      return {
        status: "failed",
        phone: phoneNumber,
        email: "",
        password,
        error: `邮箱准备失败: ${(error as Error).message}`,
        activationId,
        workerId,
        attemptId,
      };
    }
  }

  // Step 3: OAuth (CPA 或 sub2api)
  reportStatus("cpa_oauth");

  // 打印当前使用的 IP（通过代理检测出口 IP）
  const { setGlobalDispatcher } = await import("undici");
  const { createProxyDispatcher } = await import("./proxy-dispatcher.js");
  const proxyUrl = appConfig.defaultProxyUrl;
  if (proxyUrl) {
    setGlobalDispatcher(createProxyDispatcher(proxyUrl, true));
  }

  resetIpCache();
  const ipInfo = await getIpInfo();
  const residentialTag = ipInfo.isResidential ? "🏠 住宅" : "🏢 数据中心";
  const proxyTag = ipInfo.isProxy ? "🔒 代理" : "";
  const mobileTag = ipInfo.isMobile ? "📱 移动" : "";
  console.log(`[IP] ${ipInfo.ip} | ${ipInfo.country} ${ipInfo.city} | ${ipInfo.isp} | ${residentialTag} ${proxyTag} ${mobileTag}`);

  // 根据 tokenBackend 选择后端
  const useSub2api = appConfig.tokenBackend === "sub2api" && appConfig.sub2api.baseUrl && appConfig.sub2api.email;

  let authorizeUrl: string;
  let sub2apiSessionId: string | undefined;
  let sub2apiToken: string | undefined;

  if (useSub2api) {
    // ─── sub2api 路径 ───
    const { getSub2apiToken: sub2apiLogin, generateAuthUrl: sub2apiGenerateAuthUrl } = await import("./sub2api.js");

    try {
      sub2apiToken = await sub2apiLogin(appConfig.sub2api.baseUrl, appConfig.sub2api.email, appConfig.sub2api.password);
      const result = await sub2apiGenerateAuthUrl(appConfig.sub2api.baseUrl, sub2apiToken);
      authorizeUrl = result.authUrl;
      sub2apiSessionId = result.sessionId;
    } catch (error) {
      reportStatus("failed");
      return {
        status: "failed",
        phone: phoneNumber,
        email: bindEmail,
        password,
        error: `sub2api auth-url failed: ${(error as Error).message}`,
        activationId,
        workerId,
        attemptId,
      };
    }
  } else {
    // ─── CPA 路径（原有逻辑）───
    const { requestCodexAuthUrl } = await import("./cpa-codex.js");

    try {
      console.log(`[CPA] ① 获取授权 URL`);
      const result = await requestCodexAuthUrl(cpaBase, cpaKey);
      authorizeUrl = result.authorizeUrl;
      console.log(`[CPA] ① ✓ 授权 URL 已获取`);
    } catch (error) {
      reportStatus("failed");
      return {
        status: "failed",
        phone: phoneNumber,
        email: bindEmail,
        password,
        error: `CPA auth-url failed: ${(error as Error).message}`,
        activationId,
        workerId,
        attemptId,
      };
    }
  }

  const client = new OpenAIClient({
    email: phoneNumber,
    password,
    deviceProfile: generateRandomDeviceProfile(),
    manualMode: false,
    smsBroker: undefined,
    bindEmail,
    fetchAddEmailOtp,
  });

  let callbackUrl: string;
  try {
    console.log(`[${useSub2api ? "sub2api" : "CPA"}] ② OAuth 登录`);
    callbackUrl = await client.authLoginViaCpaAuthorizeURL(authorizeUrl);
    console.log(`[${useSub2api ? "sub2api" : "CPA"}] ② ✓ OAuth 登录完成`);
  } catch (error) {
    const errMsg = (error as Error).message;

    // 邮箱绑定失败时，处理邮箱状态和孤儿账号
    if (bindEmail && db) {
      if (errMsg.includes("email_already_in_use")) {
        // 邮箱已被占用，标记为失败
        console.warn(`[cpa-registration] ${workerId} 邮箱 ${bindEmail} 已被占用，标记为 failed`);
        if (db.markHotmailAccountFailed) {
          db.markHotmailAccountFailed(bindEmail);
        }
        // 存储孤儿账号
        if (db.saveOrphanedAccount) {
          db.saveOrphanedAccount({
            phone: phoneNumber,
            email: bindEmail,
            password,
            activation_id: activationId,
            error_type: "email_already_in_use",
            error_message: errMsg,
            sms_code: smsCode || null,
            openai_registered: 1,
          });
          console.log(`[cpa-registration] ${workerId} 已存储孤儿账号（邮箱已被占用）`);
        }
      } else {
        // 其他错误（网络超时等），标记为可重试（retryable）
        console.warn(`[cpa-registration] ${workerId} OAuth 登录失败，标记邮箱 ${bindEmail} 为可重试（retryable）`);
        if (db.resetHotmailAccount) {
          db.resetHotmailAccount(bindEmail);  // 会标记为 retryable
        }
        // 也存储孤儿账号，方便后续追踪
        if (db.saveOrphanedAccount) {
          db.saveOrphanedAccount({
            phone: phoneNumber,
            email: bindEmail,
            password,
            activation_id: activationId,
            error_type: "other",
            error_message: errMsg,
            sms_code: smsCode || null,
            openai_registered: 1,
          });
          console.log(`[cpa-registration] ${workerId} 已存储孤儿账号（OAuth 登录失败）`);
        }
      }
    }

    reportStatus("failed");
    return {
      status: "failed",
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: `OAuth login failed: ${errMsg}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 4: 提交 callback (CPA 或 sub2api)
  reportStatus("cpa_submit");

  if (useSub2api) {
    // ─── sub2api 路径：exchangeCode + createFromOAuth ───
    const { exchangeCode: sub2apiExchangeCode, createFromOAuth: sub2apiCreateFromOAuth } = await import("./sub2api.js");

    try {
      // 从 callback URL 提取 code 和 state
      const callbackUrlObj = new URL(callbackUrl);
      const code = callbackUrlObj.searchParams.get("code") || "";
      const state = callbackUrlObj.searchParams.get("state") || "";

      if (!code) {
        throw new Error(`callback URL 中没有 code 参数: ${callbackUrl.slice(0, 200)}`);
      }

      // 步骤 8: 用 code 换 token
      const exchangeResult = await sub2apiExchangeCode(
        appConfig.sub2api.baseUrl,
        sub2apiToken!,
        sub2apiSessionId!,
        code,
        state,
      );

      // 步骤 9: 创建账户入库
      const createResult = await sub2apiCreateFromOAuth(
        appConfig.sub2api.baseUrl,
        sub2apiToken!,
        exchangeResult.refreshToken,
        appConfig.sub2api.groupIds,
      );

      if (!createResult.success) {
        throw new Error(`sub2api create-from-oauth 失败: status=${createResult.status} body=${createResult.body.slice(0, 300)}`);
      }

      // 拿到 accessToken
      const accessToken = exchangeResult.accessToken;

      reportStatus("success");
      console.log(`${"═".repeat(60)}`);
      console.log(`✅ 注册成功 | ${phoneNumber} | ${bindEmail}`);
      console.log(`✅ Token: ${accessToken.slice(0, 30)}... (${accessToken.length} 字符)`);
      console.log(`✅ sub2api 账户 ID: ${createResult.accountId || "unknown"}`);
      console.log(`✅ IP: ${ipInfo.ip} | ${ipInfo.country} ${ipInfo.city} | ${ipInfo.isp}`);
      console.log(`${"═".repeat(60)}\n`);

      return {
        status: "ok",
        phone: phoneNumber,
        email: bindEmail,
        password,
        accessToken,
        activationId,
        workerId,
        attemptId,
        ipAddress: ipInfo.ip,
        ipCountry: ipInfo.country,
        ipCity: ipInfo.city,
        ipIsp: ipInfo.isp,
        ipIsResidential: ipInfo.isResidential,
      };
    } catch (error) {
      const errMsg = (error as Error).message;

      // sub2api 入库失败时，存储孤儿账号
      if (bindEmail && db && db.saveOrphanedAccount) {
        console.warn(`[cpa-registration] ${workerId} sub2api 入库失败，存储孤儿账号`);
        db.saveOrphanedAccount({
          phone: phoneNumber,
          email: bindEmail,
          password,
          activation_id: activationId,
          error_type: "sub2api_callback_failed",
          error_message: errMsg,
          sms_code: smsCode || null,
          openai_registered: 1,
        });
        console.log(`[cpa-registration] ${workerId} 已存储孤儿账号（sub2api 入库失败）`);
      }

      reportStatus("failed");
      return {
        status: "failed",
        phone: phoneNumber,
        email: bindEmail,
        password,
        error: `sub2api callback failed: ${errMsg}`,
        activationId,
        workerId,
        attemptId,
      };
    }
  } else {
    // ─── CPA 路径（原有逻辑）───
    const { submitOAuthCallback, listAuthFiles, downloadAuthFile } = await import("./cpa-codex.js");

    try {
      console.log(`[CPA] ③ 提交 callback 入库`);
      const { status, body } = await submitOAuthCallback(cpaBase, cpaKey, callbackUrl);
      if (status >= 300) {
        console.log(`[CPA] ③ ✗ 入库失败 status=${status}`);
        throw new Error(`CPA oauth-callback failed: status=${status}`);
      }
      console.log(`[CPA] ③ ✓ 入库成功 status=${status}`);
      log.debug(`[CPA] ③ 响应:`, body.slice(0, 500));
    } catch (error) {
      const errMsg = (error as Error).message;

      // CPA 入库失败时，存储孤儿账号（OpenAI 账号已创建但 CPA 未收到）
      if (bindEmail && db && db.saveOrphanedAccount) {
        console.warn(`[cpa-registration] ${workerId} CPA 入库失败，存储孤儿账号`);
        db.saveOrphanedAccount({
          phone: phoneNumber,
          email: bindEmail,
          password,
          activation_id: activationId,
          error_type: "cpa_callback_failed",
          error_message: errMsg,
          sms_code: smsCode || null,
          openai_registered: 1,
        });
        console.log(`[cpa-registration] ${workerId} 已存储孤儿账号（CPA 入库失败）`);
      }

      reportStatus("failed");
      return {
        status: "failed",
        phone: phoneNumber,
        email: bindEmail,
        password,
        error: `CPA callback failed: ${errMsg}`,
        activationId,
        workerId,
        attemptId,
      };
    }

    // Step 5: 拉取 auth 文件（仅 CPA 路径需要）
    reportStatus("waiting_email_otp");

    try {
      console.log(`[CPA] ④ 拉取 auth 文件...`);
      const emailLc = bindEmail.toLowerCase();
      const candidates = [
        `codex-${emailLc}.json`,
        `codex-${emailLc}-plus.json`,
      ];
      const matchFile = (files: any[]) => {
        for (const want of candidates) {
          const hit = files.find(f => String(f.name || "").toLowerCase() === want);
          if (hit) return hit;
        }
        return null;
      };

      const POLL_MAX_ATTEMPTS = 12;
      const POLL_INTERVAL_MS = 3000;
      let latest: any = null;
      let lastFileCount = -1;

      for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt += 1) {
        const files = await listAuthFiles(cpaBase, cpaKey);
        lastFileCount = files.length;
        latest = matchFile(files);
        if (latest) {
          console.log(`[CPA] ④ ✓ 匹配到: ${latest.name} (attempt=${attempt})`);
          break;
        }
        if (attempt < POLL_MAX_ATTEMPTS) {
          console.log(`[cpa-registration] ${workerId} 等待 auth 文件 (attempt=${attempt}/${POLL_MAX_ATTEMPTS})`);
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }
      }

      if (!latest) {
        return {
          status: "failed",
          phone: phoneNumber,
          email: bindEmail,
          password,
          error: `CPA auth file not found after ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS}ms`,
          activationId,
          workerId,
          attemptId,
        };
      }

      const auth = await downloadAuthFile(cpaBase, cpaKey, latest.name);
      const tok = String(auth?.access_token || "").trim();
      if (!tok) {
        return {
          status: "failed",
          phone: phoneNumber,
          email: bindEmail,
          password,
          error: "Auth file missing access_token",
          cpaAuthFile: latest.name,
          activationId,
          workerId,
          attemptId,
        };
      }

      reportStatus("success");
      console.log(`${"═".repeat(60)}`);
      console.log(`✅ 注册成功 | ${phoneNumber} | ${bindEmail}`);
      console.log(`✅ Token: ${tok.slice(0, 30)}... (${tok.length} 字符)`);
      console.log(`✅ Auth 文件: ${latest.name}`);
      console.log(`✅ IP: ${ipInfo.ip} | ${ipInfo.country} ${ipInfo.city} | ${ipInfo.isp}`);
      console.log(`${"═".repeat(60)}\n`);

      return {
        status: "ok",
        phone: phoneNumber,
        email: bindEmail,
        password,
        accessToken: tok,
        cpaAuthFile: latest.name,
        activationId,
        workerId,
        attemptId,
        ipAddress: ipInfo.ip,
        ipCountry: ipInfo.country,
        ipCity: ipInfo.city,
        ipIsp: ipInfo.isp,
        ipIsResidential: ipInfo.isResidential,
      };
    } catch (error) {
      reportStatus("failed");
      return {
        status: "failed",
        phone: phoneNumber,
        email: bindEmail,
        password,
        error: `Auth file fetch failed: ${(error as Error).message}`,
        activationId,
        workerId,
        attemptId,
      };
    }
  }
}
