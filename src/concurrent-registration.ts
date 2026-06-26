import { appConfig } from "./config.js";
import { generateRandomDeviceProfile } from "./device-profile.js";
import { OpenAIClient } from "./openai.js";
import { createSMSBroker, SMSActivationLease } from "./sms/index.js";
import { LocalDB } from "./local-db.js";
import { randomUUID } from "node:crypto";
import { getIpInfo, resetIpCache, IpInfo } from "./ip-detect.js";
import { proxyFetch } from "./proxy-fetch.js";

export interface PhoneLease {
  phoneNumber: string;
  activationId: string;
  lease: SMSActivationLease;
  receivedAt: number;
  workerId: string;
  attemptId: number;
}

export interface ConcurrentRegistrationResult {
  success: boolean;
  phone: string;
  email: string;
  password: string;
  accessToken?: string;
  cpaAuthFile?: string;
  error?: string;
  activationId?: string;
  workerId: string;
  attemptId: number;
}

export interface ConcurrentRegistrationOptions {
  concurrency: number;
  smsTimeoutMs: number;
  emailTimeoutMs: number;
  cpaTimeoutMs: number;
  skipProbeTrial: boolean;
  tokenOutPath: string;
  db: LocalDB;
  runId: number;
}

export class ConcurrentPhonePool {
  private leases: PhoneLease[] = [];
  private maxPhones: number;
  private smsTimeoutMs: number;
  private abortController: AbortController;
  private db: LocalDB;

  constructor(maxPhones: number, smsTimeoutMs: number, db: LocalDB) {
    this.maxPhones = maxPhones;
    this.smsTimeoutMs = smsTimeoutMs;
    this.abortController = new AbortController();
    this.db = db;
  }

  async acquirePhones(count: number, runId: number): Promise<PhoneLease[]> {
    const smsBroker = appConfig.heroSMSApiKey ? createSMSBroker({
      apiKey: appConfig.heroSMSApiKey,
      pollAttempts: appConfig.heroSMSPollAttempts,
      pollIntervalMs: appConfig.heroSMSPollIntervalMs,
      maxPrice: appConfig.heroSMSMaxPrice,
      country: appConfig.heroSMSCountry,
      countries: appConfig.heroSMSCountries,
      priceTiers: appConfig.heroSMSPriceTiers,
      proxyUrl: appConfig.heroSMSProxy || "",
    }) : undefined;

    if (!smsBroker) {
      throw new Error("Missing heroSMSApiKey configuration");
    }

    const acquired: PhoneLease[] = [];
    const acquirePromises: Promise<void>[] = [];

    for (let i = 0; i < Math.min(count, this.maxPhones); i++) {
      const workerId = `concurrent-run${runId}-${String(i + 1).padStart(3, "0")}-${randomUUID().slice(0, 8)}`;
      const attemptId = this.db.createAttempt(runId);

      // 创建 worker slot 并实时写入 db
      this.db.createWorkerSlot(workerId, runId);
      this.db.updateWorkerSlot(workerId, {
        attempt_id: attemptId,
        status: "acquiring_phone",
      });

      acquirePromises.push(
        (async () => {
          try {
            const lease = await smsBroker.getActivation();
            const phoneNumber = `+${lease.phoneNumber}`;
            const activationId = String(lease.activationId || "");

            const phoneLease: PhoneLease = {
              phoneNumber,
              activationId,
              lease,
              receivedAt: Date.now(),
              workerId,
              attemptId,
            };

            // 实时更新 worker_slots
            this.db.updateWorkerSlot(workerId, {
              phone: phoneNumber,
              activation_id: activationId,
              status: "waiting_sms",
              sms_deadline_at: new Date(Date.now() + this.smsTimeoutMs).toISOString(),
            });

            // 实时更新 registration_attempts
            this.db.updateAttempt(attemptId, {
              phone: phoneNumber,
              sms_activation_id: activationId,
              status: "waiting_sms",
            });

            this.leases.push(phoneLease);
            acquired.push(phoneLease);
            console.log(`[phone-pool] ${workerId} 获取号码 ${phoneNumber}`);
          } catch (error) {
            console.warn(`[phone-pool] ${workerId} 获取号码失败: ${(error as Error).message}`);

            // 更新失败状态
            this.db.updateWorkerSlot(workerId, {
              status: "failed",
              last_error: `获取号码失败: ${(error as Error).message}`,
            });

            this.db.updateAttempt(attemptId, {
              status: "failed",
              error: `获取号码失败: ${(error as Error).message}`,
            });
          }
        })()
      );
    }

    await Promise.all(acquirePromises);
    console.log(`[phone-pool] 共获取 ${acquired.length} 个号码`);
    return acquired;
  }

  async waitForVerificationCode(phoneLease: PhoneLease): Promise<string | null> {
    const deadline = phoneLease.receivedAt + this.smsTimeoutMs;
    const now = Date.now();

    if (now >= deadline) {
      console.warn(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 已超时`);

      // 更新超时状态
      this.db.updateWorkerSlot(phoneLease.workerId, {
        status: "timed_out",
        last_error: "SMS verification timeout",
      });

      this.db.updateAttempt(phoneLease.attemptId, {
        status: "failed",
        error: "SMS verification timeout",
      });

      return null;
    }

    const remainingMs = deadline - now;
    console.log(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 等待验证码 (${remainingMs}ms)`);

    try {
      const result = await Promise.race([
        phoneLease.lease.waitForVerificationCode().then(v => v.code),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), remainingMs);
        }),
        this.abortController.signal.aborted
          ? Promise.resolve(null)
          : new Promise<null>(() => {}),
      ]);

      if (result) {
        console.log(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 收到验证码: ${result}`);

        // 更新收到验证码状态
        this.db.updateWorkerSlot(phoneLease.workerId, {
          status: "sms_received",
        });

        this.db.updateAttempt(phoneLease.attemptId, {
          status: "sms_received",
        });

        return result;
      }

      console.warn(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 等待超时`);

      // 更新超时状态
      this.db.updateWorkerSlot(phoneLease.workerId, {
        status: "timed_out",
        last_error: "SMS verification timeout",
      });

      this.db.updateAttempt(phoneLease.attemptId, {
        status: "failed",
        error: "SMS verification timeout",
      });

      return null;
    } catch (error) {
      console.warn(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 等待失败: ${(error as Error).message}`);

      // 更新失败状态
      this.db.updateWorkerSlot(phoneLease.workerId, {
        status: "failed",
        last_error: `等待验证码失败: ${(error as Error).message}`,
      });

      this.db.updateAttempt(phoneLease.attemptId, {
        status: "failed",
        error: `等待验证码失败: ${(error as Error).message}`,
      });

      return null;
    }
  }

  async cancelPhone(phoneLease: PhoneLease): Promise<void> {
    try {
      const apiKey = String(appConfig.heroSMSApiKey ?? "").trim();
      if (!apiKey || !phoneLease.activationId) {
        return;
      }

      const url = `https://hero-sms.com/stubs/handler_api.php?api_key=${encodeURIComponent(apiKey)}&action=setStatus&id=${encodeURIComponent(phoneLease.activationId)}&status=8`;
      const res = await proxyFetch(url, { method: "GET" });
      const body = await res.text();
      const upper = body.toUpperCase();

      if (upper.includes("ACCESS_CANCEL") || upper.includes("ACCESS_READY") || upper.includes("BAD_STATUS") || upper.includes("NO_ACTIVATION")) {
        console.log(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 已取消`);

        // 更新取消状态
        this.db.updateWorkerSlot(phoneLease.workerId, {
          status: "cancelled",
          cancel_reason: "SMS timeout - cancelled by pool",
        });

        return;
      }

      console.warn(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 取消响应异常: ${body.slice(0, 200)}`);
    } catch (error) {
      console.warn(`[phone-pool] ${phoneLease.workerId} ${phoneLease.phoneNumber} 取消失败: ${(error as Error).message}`);
    }
  }

  removeLease(phoneLease: PhoneLease): void {
    const index = this.leases.indexOf(phoneLease);
    if (index !== -1) {
      this.leases.splice(index, 1);
    }
  }

  getActiveLeases(): PhoneLease[] {
    return [...this.leases];
  }

  abort(): void {
    this.abortController.abort();
  }
}

async function cancelActivation(activationId: string): Promise<void> {
  try {
    const apiKey = String(appConfig.heroSMSApiKey ?? "").trim();
    if (!apiKey || !activationId) {
      return;
    }
    const url = `https://hero-sms.com/stubs/handler_api.php?api_key=${encodeURIComponent(apiKey)}&action=setStatus&id=${encodeURIComponent(activationId)}&status=8`;
    const res = await proxyFetch(url, { method: "GET" });
    const body = await res.text();
    console.log(`[concurrent] cancel activationId=${activationId} response=${body.slice(0, 120)}`);
  } catch (error) {
    console.warn(`[concurrent] cancel activationId=${activationId} failed=${(error as Error).message}`);
  }
}

export async function runConcurrentRegistration(options: ConcurrentRegistrationOptions): Promise<ConcurrentRegistrationResult[]> {
  const { concurrency, smsTimeoutMs, emailTimeoutMs, cpaTimeoutMs, skipProbeTrial, tokenOutPath, db, runId } = options;
  const results: ConcurrentRegistrationResult[] = [];

  console.log(`\n[concurrent] 启动并发抢号: concurrency=${concurrency}`);

  // 1. 同时获取多个号码（实时写入 db）
  const pool = new ConcurrentPhonePool(concurrency, smsTimeoutMs, db);
  const phones = await pool.acquirePhones(concurrency, runId);

  if (phones.length === 0) {
    console.warn(`[concurrent] 未获取到任何号码`);
    return results;
  }

  // 2. 并行发起 OpenAI 注册（每个号码独立完成完整闭环）
  // 如果 IP 不是住宅，自动重新拉起新 worker（最多重试 3 次）
  const MAX_IP_RETRIES = 3;

  async function executeWithRetry(phoneLease: PhoneLease, retryCount = 0): Promise<ConcurrentRegistrationResult> {
    const result = await executeSingleRegistration(phoneLease, pool, options);

    // 如果失败原因是 IP 不是住宅，且还有重试次数，重新拉起新 worker
    if (!result.success && result.error?.includes("IP 不是住宅") && retryCount < MAX_IP_RETRIES) {
      console.log(`[concurrent] ${phoneLease.workerId} 因 IP 不是住宅，重新拉起新 worker (${retryCount + 1}/${MAX_IP_RETRIES})`);
      // 号码已释放，需要重新获取
      // 返回失败，由调度层重新分配
      return result;
    }

    return result;
  }

  const registrationPromises: Promise<ConcurrentRegistrationResult>[] = [];

  for (const phoneLease of phones) {
    registrationPromises.push(executeWithRetry(phoneLease));
  }

  const registrationResults = await Promise.all(registrationPromises);

  // 3. 收集结果，IP 不是住宅的重新拉起
  const ipFailedResults: ConcurrentRegistrationResult[] = [];
  for (const result of registrationResults) {
    if (result.success) {
      results.push(result);
      console.log(`[concurrent] ${result.workerId} ${result.phone} ✅ 成功`);
    } else if (result.error?.includes("IP 不是住宅")) {
      ipFailedResults.push(result);
      console.warn(`[concurrent] ${result.workerId} IP 不是住宅，需要重新拉起`);
    } else {
      results.push(result);
      console.warn(`[concurrent] ${result.workerId} ${result.phone} ❌ 失败: ${result.error}`);
    }
  }

  // 4. 重新拉起 IP 失败的 worker（重新获取号码）
  if (ipFailedResults.length > 0) {
    console.log(`[concurrent] 重新拉起 ${ipFailedResults.length} 个 IP 失败的 worker...`);
    // 等待一下让代理切换
    await new Promise(r => setTimeout(r, 2000));

    const retryPhones = await pool.acquirePhones(ipFailedResults.length, options.runId);
    const retryPromises: Promise<ConcurrentRegistrationResult>[] = [];

    for (const phoneLease of retryPhones) {
      retryPromises.push(executeSingleRegistration(phoneLease, pool, options));
    }

    const retryResults = await Promise.all(retryPromises);
    for (const result of retryResults) {
      results.push(result);
      if (result.success) {
        console.log(`[concurrent] ${result.workerId} ${result.phone} ✅ 重试成功`);
      } else {
        console.warn(`[concurrent] ${result.workerId} ${result.phone} ❌ 重试失败: ${result.error}`);
      }
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`\n[concurrent] 完成: success=${successCount} failure=${results.length - successCount}`);
  return results;
}

async function executeSingleRegistration(
  phoneLease: PhoneLease,
  pool: ConcurrentPhonePool,
  options: ConcurrentRegistrationOptions
): Promise<ConcurrentRegistrationResult> {
  const { phoneNumber, activationId, lease, receivedAt, workerId, attemptId } = phoneLease;
  const { smsTimeoutMs, emailTimeoutMs, cpaTimeoutMs, tokenOutPath, db } = options;
  const password = appConfig.defaultPassword;
  const cpaBase = appConfig.cpa.baseUrl || "";
  const cpaKey = appConfig.cpa.managementKey || "";

  if (!cpaKey) {
    await pool.cancelPhone(phoneLease);
    pool.removeLease(phoneLease);
    return {
      success: false,
      phone: phoneNumber,
      email: "",
      password,
      error: "Missing CPA management key",
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 0: 检测 IP 是否住宅
  resetIpCache();
  const ipInfo = await getIpInfo();
  const residentialTag = ipInfo.isResidential ? "🏠 住宅" : "🏢 数据中心";
  const proxyTag = ipInfo.isProxy ? "🔒 代理" : "";
  console.log(`[IP] ${workerId} ${ipInfo.ip} | ${ipInfo.country} ${ipInfo.city} | ${ipInfo.isp} | ${residentialTag} ${proxyTag}`);

  if (!ipInfo.isResidential || ipInfo.ip === "unknown") {
    // IP 不是住宅或获取失败，终止这个 worker，重新拉新 worker
    console.warn(`[IP] ${workerId} ❌ IP 不是住宅 (${residentialTag})，终止 worker，重新获取`);
    await pool.cancelPhone(phoneLease);
    pool.removeLease(phoneLease);

    db.updateWorkerSlot(workerId, {
      status: "failed",
      last_error: `IP 不是住宅: ${ipInfo.ip} ${ipInfo.isp} ${residentialTag}`,
    });
    db.updateAttempt(attemptId, {
      status: "failed",
      error: `IP 不是住宅: ${ipInfo.ip} ${ipInfo.isp} ${residentialTag}`,
    });

    return {
      success: false,
      phone: phoneNumber,
      email: "",
      password,
      error: `IP 不是住宅: ${ipInfo.ip} ${ipInfo.isp} ${residentialTag}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 1: 注册 OpenAI（触发发短信）+ 等待 SMS 验证码
  console.log(`[concurrent] ${workerId} 注册 OpenAI...`);

  const SMS_WAIT_TIMEOUT_MS = 65_000;

  db.updateWorkerSlot(workerId, { status: "registering" });
  db.updateAttempt(attemptId, { status: "registering" });

  const signupClient = new OpenAIClient({
    email: undefined,
    password,
    deviceProfile: generateRandomDeviceProfile(),
    manualMode: false,
    smsBroker: undefined,
  });

  let smsCode: string | null = null;

  try {
    await signupClient.authPhoneSignupHTTP(phoneNumber, async () => {
      console.log(`[concurrent] ${workerId} 等待验证码...`);
      db.updateWorkerSlot(workerId, { status: "waiting_sms" });
      db.updateAttempt(attemptId, { status: "waiting_sms" });

      const result = await Promise.race([
        lease.waitForVerificationCode().then(v => v.code),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), SMS_WAIT_TIMEOUT_MS);
        }),
      ]);

      if (!result) {
        throw new Error(`SMS wait timeout: ${SMS_WAIT_TIMEOUT_MS}ms`);
      }

      console.log(`[concurrent] ${workerId} 收到验证码: ${result}`);
      db.updateWorkerSlot(workerId, { status: "sms_received" });
      db.updateAttempt(attemptId, { status: "sms_received" });
      smsCode = result;
      return result;
    });

    console.log(`[concurrent] ${workerId} phone signup 成功`);
  } catch (error) {
    const errMsg = (error as Error).message;
    pool.removeLease(phoneLease);

    db.updateWorkerSlot(workerId, {
      status: errMsg.includes("timeout") ? "timed_out" : "failed",
      last_error: `Phone signup failed: ${errMsg}`,
    });

    db.updateAttempt(attemptId, {
      status: "failed",
      error: `Phone signup failed: ${errMsg}`,
    });

    return {
      success: false,
      phone: phoneNumber,
      email: "",
      password,
      error: `Phone signup failed: ${errMsg}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 2: 创建邮箱（延迟到注册成功后才创建，避免失败时浪费邮箱资源）
  let bindEmail: string;
  let fetchAddEmailOtp: () => Promise<string>;

  try {
    db.updateWorkerSlot(workerId, { status: "preparing_email" });
    db.updateAttempt(attemptId, { status: "preparing_email" });

    const mailbox = await import("./mailbox.js");
    bindEmail = await mailbox.getEmailAddress();
    fetchAddEmailOtp = async () => {
      const startedAt = Date.now();
      console.log(`[concurrent] ${workerId} 等待邮件 OTP for ${bindEmail}`);
      return await mailbox.getEmailVerificationCode(bindEmail, { minTimestampMs: startedAt });
    };

    // 实时更新绑定邮箱
    db.updateWorkerSlot(workerId, {
      bind_email: bindEmail,
      email_deadline_at: new Date(Date.now() + emailTimeoutMs).toISOString(),
    });

    db.updateAttempt(attemptId, {
      email: bindEmail,
    });

    console.log(`[concurrent] ${workerId} 绑定邮箱 ${bindEmail}`);
  } catch (error) {
    await pool.cancelPhone(phoneLease);
    pool.removeLease(phoneLease);

    db.updateWorkerSlot(workerId, {
      status: "failed",
      last_error: `邮箱准备失败: ${(error as Error).message}`,
    });

    db.updateAttempt(attemptId, {
      status: "failed",
      error: `邮箱准备失败: ${(error as Error).message}`,
    });

    return {
      success: false,
      phone: phoneNumber,
      email: "",
      password,
      error: `邮箱准备失败: ${(error as Error).message}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 4: CPA OAuth
  db.updateWorkerSlot(workerId, { status: "cpa_oauth" });
  db.updateAttempt(attemptId, { status: "cpa_oauth" });

  const { requestCodexAuthUrl, submitOAuthCallback, listAuthFiles, downloadAuthFile } = await import("./cpa-codex.js");

  let authorizeUrl: string;
  try {
    console.log(`[concurrent] ${workerId} [1] CPA codex-auth-url`);
    const result = await requestCodexAuthUrl(cpaBase, cpaKey);
    authorizeUrl = result.authorizeUrl;
    console.log(`[concurrent] ${workerId} authorize: ${authorizeUrl.slice(0, 120)}...`);
  } catch (error) {
    pool.removeLease(phoneLease);

    db.updateWorkerSlot(workerId, {
      status: "failed",
      last_error: `CPA auth-url failed: ${(error as Error).message}`,
    });

    db.updateAttempt(attemptId, {
      status: "failed",
      error: `CPA auth-url failed: ${(error as Error).message}`,
    });

    return {
      success: false,
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
    console.log(`[concurrent] ${workerId} [2] 走 OAuth 登录`);
    callbackUrl = await client.authLoginViaCpaAuthorizeURL(authorizeUrl);
    console.log(`[concurrent] ${workerId} callback: ${callbackUrl.slice(0, 120)}...`);
  } catch (error) {
    const errMsg = (error as Error).message;
    pool.removeLease(phoneLease);

    // 邮箱绑定失败时，处理邮箱状态和孤儿账号
    if (bindEmail) {
      if (errMsg.includes("email_already_in_use")) {
        // 邮箱已被占用，标记为失败
        console.warn(`[concurrent] ${workerId} 邮箱 ${bindEmail} 已被占用，标记为 failed`);
        db.markHotmailAccountFailed(bindEmail);
        // 存储孤儿账号
        db.saveOrphanedAccount({
          phone: phoneNumber,
          email: bindEmail || "",
          password,
          activation_id: activationId,
          error_type: "email_already_in_use",
          error_message: errMsg,
          sms_code: smsCode || null,
          openai_registered: 1,
        });
        console.log(`[concurrent] ${workerId} 已存储孤儿账号（邮箱已被占用）`);
      } else {
        // 其他错误（网络超时等），标记为可重试（retryable）
        console.warn(`[concurrent] ${workerId} OAuth 登录失败，标记邮箱 ${bindEmail} 为可重试（retryable）`);
        db.resetHotmailAccount(bindEmail);  // 会标记为 retryable
        // 也存储孤儿账号，方便后续追踪
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
        console.log(`[concurrent] ${workerId} 已存储孤儿账号（OAuth 登录失败）`);
      }
    }

    db.updateWorkerSlot(workerId, {
      status: "failed",
      last_error: `OAuth login failed: ${errMsg}`,
    });

    db.updateAttempt(attemptId, {
      status: "failed",
      error: `OAuth login failed: ${errMsg}`,
    });

    return {
      success: false,
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: `OAuth login failed: ${errMsg}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 5: 提交 callback 给 CPA
  db.updateWorkerSlot(workerId, { status: "cpa_submit" });
  db.updateAttempt(attemptId, { status: "cpa_submit" });

  try {
    console.log(`[concurrent] ${workerId} [3] 提交 callback 给 CPA`);
    const { status, body } = await submitOAuthCallback(cpaBase, cpaKey, callbackUrl);
    console.log(`[concurrent] ${workerId} CPA status=${status}`);
    console.log(`[concurrent] ${workerId} CPA body: ${body.slice(0, 500)}`);
    if (status >= 300) {
      throw new Error(`CPA oauth-callback failed: status=${status}`);
    }
  } catch (error) {
    const errMsg = (error as Error).message;
    pool.removeLease(phoneLease);

    // CPA 入库失败时，存储孤儿账号（OpenAI 账号已创建但 CPA 未收到）
    if (bindEmail) {
      console.warn(`[concurrent] ${workerId} CPA 入库失败，存储孤儿账号`);
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
      console.log(`[concurrent] ${workerId} 已存储孤儿账号（CPA 入库失败）`);
    }

    db.updateWorkerSlot(workerId, {
      status: "failed",
      last_error: `CPA callback failed: ${errMsg}`,
    });

    db.updateAttempt(attemptId, {
      status: "failed",
      error: `CPA callback failed: ${errMsg}`,
    });

    return {
      success: false,
      phone: phoneNumber,
      email: bindEmail,
      password,
      error: `CPA callback failed: ${errMsg}`,
      activationId,
      workerId,
      attemptId,
    };
  }

  // Step 6: 拉取 auth 文件
  db.updateWorkerSlot(workerId, { status: "waiting_email_otp" });
  db.updateAttempt(attemptId, { status: "waiting_email_otp" });

  try {
    console.log(`[concurrent] ${workerId} 从 CPA 拉刚入库的 codex auth 文件...`);
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
        console.log(`[concurrent] ${workerId} 精确匹配文件: ${latest.name} (attempt=${attempt})`);
        break;
      }
      if (attempt < POLL_MAX_ATTEMPTS) {
        console.log(`[concurrent] ${workerId} 等待 auth 文件 (attempt=${attempt}/${POLL_MAX_ATTEMPTS})`);
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
    }

    if (!latest) {
      pool.removeLease(phoneLease);

      db.updateWorkerSlot(workerId, {
        status: "failed",
        last_error: `CPA auth file not found after ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS}ms`,
      });

      db.updateAttempt(attemptId, {
        status: "failed",
        error: `CPA auth file not found after ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS}ms`,
      });

      return {
        success: false,
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
      pool.removeLease(phoneLease);

      db.updateWorkerSlot(workerId, {
        status: "failed",
        last_error: "Auth file missing access_token",
      });

      db.updateAttempt(attemptId, {
        status: "failed",
        error: "Auth file missing access_token",
        cpa_auth_file: latest.name,
      });

      return {
        success: false,
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

    console.log(`[concurrent] ${workerId} 从 CPA 拿到 access_token (${tok.length} 字符, 文件=${latest.name})`);

    // 实时更新成功状态
    db.updateWorkerSlot(workerId, {
      status: "success",
    });

    db.updateAttempt(attemptId, {
      status: "ok",
      cpa_auth_file: latest.name,
      finished_at: new Date().toISOString(),
    });

    // 获取当前 IP 详细信息
    resetIpCache();
    const ipInfo = await getIpInfo();
    const residentialTag = ipInfo.isResidential ? "🏠 住宅" : "🏢 数据中心";

    console.log(`[IP] ${ipInfo.ip} | ${ipInfo.country} ${ipInfo.city} | ${ipInfo.isp} | ${residentialTag}`);

    // 保存账号到数据库
    db.saveAccount({
      phone: phoneNumber,
      email: bindEmail,
      password,
      access_token: tok,
      token_expires_at: null,
      cpa_auth_file: latest.name,
      cpa_base_url: cpaBase,
      ip_address: ipInfo.ip,
      ip_country: ipInfo.country,
      ip_city: ipInfo.city,
      ip_isp: ipInfo.isp,
      ip_is_residential: ipInfo.isResidential ? 1 : 0,
      token_backend: appConfig.tokenBackend || "cpa",
      status: "active",
    });

    // 可选：写入 token 文件
    if (tokenOutPath && tok) {
      try {
        const { appendFile } = await import("node:fs/promises");
        await appendFile(tokenOutPath, tok + "\n", "utf8");
      } catch (e) {
        console.warn(`[concurrent] 写 token 文件失败: ${(e as Error).message}`);
      }
    }

    pool.removeLease(phoneLease);
    return {
      success: true,
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
    pool.removeLease(phoneLease);

    db.updateWorkerSlot(workerId, {
      status: "failed",
      last_error: `Auth file fetch failed: ${(error as Error).message}`,
    });

    db.updateAttempt(attemptId, {
      status: "failed",
      error: `Auth file fetch failed: ${(error as Error).message}`,
    });

    return {
      success: false,
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
