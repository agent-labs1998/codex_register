import { appConfig } from "./config.js";
import { generateRandomDeviceProfile } from "./device-profile.js";
import { OpenAIClient } from "./openai.js";
import { SMSActivationLease } from "./sms/index.js";
import { getIpInfo, resetIpCache } from "./ip-detect.js";
import { proxyFetch } from "./proxy-fetch.js";

export interface RegistrationTask {
  workerId: string;
  attemptId: number;
  phoneLease: SMSActivationLease;
  phoneNumber: string;
  activationId: string;
  bindEmail: string;
  fetchAddEmailOtp: () => Promise<string>;
  deadlines: {
    smsDeadlineAt: number;
    emailDeadlineAt: number;
    cpaDeadlineAt: number;
  };
  onStatusChange?: (status: string) => void;
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
  const { workerId, attemptId, phoneLease, phoneNumber, activationId, bindEmail, fetchAddEmailOtp, deadlines, onStatusChange } = task;
  const password = appConfig.defaultPassword;
  const cpaBase = appConfig.cliproxyApiBaseUrl || "";
  const cpaKey = appConfig.cliproxyApiManagementKey || "";

  if (!cpaKey) {
    return {
      status: "failed",
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: "Missing CPA management key",
      activationId,
      workerId,
      attemptId,
    };
  }

  const reportStatus = (status: string) => {
    console.log(`[cpa-registration] ${workerId} -> ${status}`);
    onStatusChange?.(status);
  };

  // Step 1: Phone signup - 等待 SMS 验证码
  reportStatus("waiting_sms");

  let smsCode: string;
  try {
    // Worker 只等待 65 秒，超时后立即释放 worker，重新注册新 worker
    // 巡视器会在后台持续检查，120 秒后释放号码
    const SMS_WAIT_TIMEOUT_MS = 65_000;
    const result = await Promise.race([
      phoneLease.waitForVerificationCode().then(v => v.code),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), SMS_WAIT_TIMEOUT_MS);
      }),
    ]);

    if (!result) {
      // 65 秒内未收到验证码，立即释放 worker
      // 号码会在巡视器中 120 秒后释放
      reportStatus("timed_out");
      return {
        status: "failed",
        phone: phoneNumber,
        email: bindEmail,
        password,
        error: `SMS wait timeout: ${SMS_WAIT_TIMEOUT_MS}ms 内未收到验证码，立即释放 worker`,
        activationId,
        workerId,
        attemptId,
      };
    }

    smsCode = result;
    reportStatus("sms_received");
    console.log(`[cpa-registration] ${workerId} 收到验证码: ${smsCode}`);
  } catch (error) {
    reportStatus("timed_out");
    return {
      status: "failed",
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: `SMS timeout: ${(error as Error).message}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 2: 用验证码完成 phone signup
  reportStatus("registering");

  const signupClient = new OpenAIClient({
    email: undefined,
    password,
    deviceProfile: generateRandomDeviceProfile(),
    manualMode: false,
    smsBroker: undefined,
  });

  try {
    await signupClient.authPhoneSignupHTTP(phoneNumber, async () => smsCode);
    console.log(`[cpa-registration] ${workerId} phone signup 成功`);
  } catch (error) {
    reportStatus("failed");
    return {
      status: "failed",
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: `Phone signup failed: ${(error as Error).message}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 3: CPA OAuth
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

  const { requestCodexAuthUrl, submitOAuthCallback, listAuthFiles, downloadAuthFile } = await import("./cpa-codex.js");

  let authorizeUrl: string;
  try {
    console.log(`[cpa-registration] ${workerId} [1] CPA codex-auth-url`);
    const result = await requestCodexAuthUrl(cpaBase, cpaKey);
    authorizeUrl = result.authorizeUrl;
    console.log(`[cpa-registration] ${workerId} authorize: ${authorizeUrl.slice(0, 120)}...`);
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
    console.log(`[cpa-registration] ${workerId} [2] 走 OAuth 登录`);
    callbackUrl = await client.authLoginViaCpaAuthorizeURL(authorizeUrl);
    console.log(`[cpa-registration] ${workerId} callback: ${callbackUrl.slice(0, 120)}...`);
  } catch (error) {
    reportStatus("failed");
    return {
      status: "failed",
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: `OAuth login failed: ${(error as Error).message}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 4: 提交 callback 给 CPA
  reportStatus("cpa_submit");

  try {
    console.log(`[cpa-registration] ${workerId} [3] 提交 callback 给 CPA`);
    const { status, body } = await submitOAuthCallback(cpaBase, cpaKey, callbackUrl);
    console.log(`[cpa-registration] ${workerId} CPA status=${status}`);
    console.log(`[cpa-registration] ${workerId} CPA body: ${body.slice(0, 500)}`);
    if (status >= 300) {
      throw new Error(`CPA oauth-callback failed: status=${status}`);
    }
  } catch (error) {
    reportStatus("failed");
    return {
      status: "failed",
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: `CPA callback failed: ${(error as Error).message}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 5: 拉取 auth 文件
  reportStatus("waiting_email_otp");

  try {
    console.log(`[cpa-registration] ${workerId} 从 CPA 拉刚入库的 codex auth 文件...`);
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
        console.log(`[cpa-registration] ${workerId} 精确匹配文件: ${latest.name} (attempt=${attempt})`);
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
    console.log(`[cpa-registration] ${workerId} 从 CPA 拿到 access_token (${tok.length} 字符, 文件=${latest.name})`);

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
