import { LocalDB } from "./local-db.js";
import { runCpaRegistration, RegistrationTask, CodexCpaResult } from "./cpa-registration.js";
import { appConfig } from "./config.js";
import { createSMSBroker, SMSActivationLease } from "./sms/index.js";

export type WorkerStatus =
  | "idle"
  | "acquiring_phone"
  | "registering"
  | "waiting_sms"
  | "sms_received"
  | "cpa_oauth"
  | "waiting_email_otp"
  | "email_otp_received"
  | "cpa_submit"
  | "success"
  | "failed"
  | "timed_out"
  | "cancelled";

export interface SchedulerConfig {
  runId: number;
  concurrency: number;
  count: number;
  smsTimeoutMs: number;
  emailTimeoutMs: number;
  cpaTimeoutMs: number;
  skipProbeTrial: boolean;
  tokenOutPath: string;
}

export class WorkerScheduler {
  private db: LocalDB;
  private config: SchedulerConfig;
  private successCount = 0;
  private failureCount = 0;
  private completedCount = 0;
  private runningWorkers: Set<string> = new Set();

  constructor(db: LocalDB, config: SchedulerConfig) {
    this.db = db;
    this.config = config;
  }

  async run(): Promise<{ success: number; failure: number }> {
    console.log(`\n[scheduler] 启动并发调度: concurrency=${this.config.concurrency} count=${this.config.count}`);

    const smsBroker = appConfig.heroSMSApiKey ? createSMSBroker({
      apiKey: appConfig.heroSMSApiKey,
      pollAttempts: appConfig.heroSMSPollAttempts,
      pollIntervalMs: appConfig.heroSMSPollIntervalMs,
      maxPrice: appConfig.heroSMSMaxPrice,
      country: appConfig.heroSMSCountry,
      countries: appConfig.heroSMSCountries,
      priceTiers: appConfig.heroSMSPriceTiers,
    }) : undefined;

    if (!smsBroker) {
      throw new Error("Missing heroSMSApiKey configuration");
    }

    // 创建 worker slots
    for (let i = 0; i < this.config.concurrency; i++) {
      const workerId = `worker-${String(i + 1).padStart(3, "0")}`;
      this.db.createWorkerSlot(workerId, this.config.runId);
    }

    // 使用信号量控制并发
    const semaphore = new Semaphore(this.config.concurrency);
    const tasks: Promise<void>[] = [];

    for (let i = 1; i <= this.config.count; i++) {
      await semaphore.acquire();

      const idleWorkers = this.db.getIdleWorkers(this.config.runId);
      if (idleWorkers.length === 0) {
        semaphore.release();
        continue;
      }

      const workerSlot = idleWorkers[0];
      const workerId = workerSlot.worker_id;

      const task = this.executeWorkerTask(workerId, i, smsBroker)
        .finally(() => {
          semaphore.release();
          this.runningWorkers.delete(workerId);
        });

      tasks.push(task);
      this.runningWorkers.add(workerId);
    }

    // 等待所有 worker 完成
    await Promise.all(tasks);

    console.log(`\n[scheduler] 调度完成: success=${this.successCount} failure=${this.failureCount}`);
    return { success: this.successCount, failure: this.failureCount };
  }

  private async executeWorkerTask(workerId: string, taskIndex: number, smsBroker: any): Promise<void> {
    const attemptId = this.db.createAttempt(this.config.runId);

    this.db.updateWorkerSlot(workerId, {
      attempt_id: attemptId,
      status: "acquiring_phone",
    });

    console.log(`\n[scheduler] ${workerId} 开始任务 ${taskIndex}/${this.config.count}`);

    try {
      // Step 1: 获取号码
      let phoneLease: SMSActivationLease;
      let phoneNumber: string;
      let activationId: string;

      try {
        this.updateWorkerStatus(workerId, "acquiring_phone");
        phoneLease = await smsBroker.getActivation();
        phoneNumber = `+${phoneLease.phoneNumber}`;
        activationId = String(phoneLease.activationId || "");

        // 绑定号码到 worker
        this.db.updateWorkerSlot(workerId, {
          phone: phoneNumber,
          activation_id: activationId,
          sms_deadline_at: new Date(Date.now() + this.config.smsTimeoutMs).toISOString(),
        });

        this.db.updateAttempt(attemptId, {
          phone: phoneNumber,
          sms_activation_id: activationId,
        });

        console.log(`[scheduler] ${workerId} 获取号码 ${phoneNumber}`);
      } catch (error) {
        throw new Error(`获取号码失败: ${(error as Error).message}`);
      }

      // Step 2: 准备邮箱
      let bindEmail: string;
      let fetchAddEmailOtp: () => Promise<string>;

      try {
        const mailbox = await import("./mailbox.js");
        bindEmail = await mailbox.getEmailAddress();
        fetchAddEmailOtp = async () => {
          const startedAt = Date.now();
          console.log(`[scheduler] ${workerId} 等待邮件 OTP for ${bindEmail}`);
          return await mailbox.getEmailVerificationCode(bindEmail, { minTimestampMs: startedAt });
        };

        // 绑定邮箱到 worker
        this.db.updateWorkerSlot(workerId, {
          bind_email: bindEmail,
          email_deadline_at: new Date(Date.now() + this.config.emailTimeoutMs).toISOString(),
        });

        this.db.updateAttempt(attemptId, {
          email: bindEmail,
        });

        console.log(`[scheduler] ${workerId} 绑定邮箱 ${bindEmail}`);
      } catch (error) {
        throw new Error(`邮箱准备失败: ${(error as Error).message}`);
      }

      // Step 3: 执行注册（状态机在内部逐步驱动）
      const task: RegistrationTask = {
        workerId,
        attemptId,
        phoneLease,
        phoneNumber,
        activationId,
        bindEmail,
        fetchAddEmailOtp,
        deadlines: {
          smsDeadlineAt: Date.now() + this.config.smsTimeoutMs,
          emailDeadlineAt: Date.now() + this.config.emailTimeoutMs,
          cpaDeadlineAt: Date.now() + this.config.cpaTimeoutMs,
        },
        onStatusChange: (status: string) => {
          this.db.updateWorkerSlot(workerId, { status });
        },
      };

      const result = await runCpaRegistration(task);

      // Step 4: 记录结果
      this.db.updateAttempt(attemptId, {
        status: result.status,
        cpa_status: result.status,
        cpa_auth_file: result.cpaAuthFile || "",
        error: result.error || "",
        finished_at: new Date().toISOString(),
      });

      if (result.status === "ok") {
        this.successCount++;
        this.db.updateWorkerSlot(workerId, { status: "success" });
        this.db.saveAccount({
          phone: result.phone,
          email: result.email,
          password: result.password,
          access_token: result.accessToken || "",
          token_expires_at: null,
          cpa_auth_file: result.cpaAuthFile || "",
          cpa_base_url: appConfig.cliproxyApiBaseUrl || "",
          status: "active",
        });

        // 可选：写入 token 文件
        if (this.config.tokenOutPath && result.accessToken) {
          try {
            const { appendFile } = await import("node:fs/promises");
            await appendFile(this.config.tokenOutPath, result.accessToken + "\n", "utf8");
          } catch (e) {
            console.warn(`[scheduler] 写 token 文件失败: ${(e as Error).message}`);
          }
        }

        console.log(`[scheduler] ${workerId} ✅ 成功`);
      } else {
        this.failureCount++;
        this.db.updateWorkerSlot(workerId, {
          status: "failed",
          last_error: result.error || "",
        });
        console.warn(`[scheduler] ${workerId} ❌ 失败: ${result.error}`);
      }
    } catch (error) {
      this.failureCount++;
      const errMsg = (error as Error).message;
      console.error(`[scheduler] ${workerId} ❌ 异常: ${errMsg}`);

      this.db.updateWorkerSlot(workerId, {
        status: "failed",
        last_error: errMsg,
      });

      this.db.updateAttempt(attemptId, {
        status: "failed",
        error: errMsg,
        finished_at: new Date().toISOString(),
      });

      // 尝试释放号码
      try {
        const workerSlot = this.db.getWorkerSlot(workerId);
        if (workerSlot?.activation_id) {
          await this.cancelActivation(workerSlot.activation_id);
        }
      } catch (e) {
        console.warn(`[scheduler] ${workerId} 释放号码失败: ${(e as Error).message}`);
      }
    } finally {
      this.completedCount++;
    }
  }

  private updateWorkerStatus(workerId: string, status: WorkerStatus): void {
    this.db.updateWorkerSlot(workerId, { status });
    console.log(`[scheduler] ${workerId} -> ${status}`);
  }

  private async cancelActivation(activationId: string): Promise<void> {
    const apiKey = String(appConfig.heroSMSApiKey ?? "").trim();
    if (!apiKey || !activationId) {
      return;
    }
    const url = `https://hero-sms.com/stubs/handler_api.php?api_key=${encodeURIComponent(apiKey)}&action=setStatus&id=${encodeURIComponent(activationId)}&status=8`;
    try {
      const res = await fetch(url, { method: "GET" });
      const body = await res.text();
      console.log(`[scheduler] cancel activationId=${activationId} response=${body.slice(0, 120)}`);
    } catch (error) {
      console.warn(`[scheduler] cancel activationId=${activationId} failed=${(error as Error).message}`);
    }
  }

  getProgress(): { completed: number; total: number; success: number; failure: number } {
    return {
      completed: this.completedCount,
      total: this.config.count,
      success: this.successCount,
      failure: this.failureCount,
    };
  }
}

class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}
