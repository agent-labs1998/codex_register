import {appConfig} from "../config.js";
import {proxyFetch} from "../proxy-fetch.js";

interface ActiveActivationSnapshot {
    activationId: string;
    phoneNumber: string;
    activationTime?: string;
    activationStatus?: string;
}

const HERO_SMS_API_BASE = "https://hero-sms.com/stubs/handler_api.php";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseActivationTimeMs(value?: string): number {
    if (!value) {
        return 0;
    }

    // 自动检测 HeroSMS 时间的时区
    // 先尝试 UTC 解析
    let ms = Date.parse(value.replace(" ", "T") + "Z");

    // 如果年龄是负数或超过 24 小时，切换到 UTC+8
    const now = Date.now();
    const ageSeconds = Math.floor((now - ms) / 1000);
    if (ageSeconds < 0 || ageSeconds > 86400) {
        ms = Date.parse(value.replace(" ", "T") + "+08:00");
    }

    return Number.isFinite(ms) ? ms : 0;
}

export function startHeroSmsPatrolLoop(): {stop: () => void} {
    const apiKey = String(appConfig.heroSMSApiKey ?? "").trim();
    if (!apiKey) {
        return {stop() {}};
    }

    let running = true;
    const POLL_INTERVAL_MS = 10_000;
    // HeroSMS 需要 120 秒后才能释放号码
    const SMS_RELEASE_MS = 120_000;

    const loop = (async () => {
        while (running) {
            try {
                await patrolOnce(apiKey, SMS_RELEASE_MS);
            } catch (error) {
                console.warn(`[巡视器] patrol failed: ${(error as Error).message}`);
            }
            await delay(POLL_INTERVAL_MS);
        }
    })();

    loop.catch(() => {});

    return {
        stop() {
            running = false;
        },
    };
}

async function patrolOnce(apiKey: string, releaseMs: number): Promise<void> {
    const activations = await fetchAllActiveActivations(apiKey);
    console.log(`[巡视器] 扫描到 ${activations.length} 个活跃号码`);
    if (!activations.length) {
        return;
    }

    const now = Date.now();
    for (const activation of activations) {
        const activationTimeMs = parseActivationTimeMs(activation.activationTime);
        const ageMs = activationTimeMs > 0 ? now - activationTimeMs : 0;
        const ageSeconds = Math.floor(ageMs / 1000);
        if (ageMs < releaseMs) {
            console.log(`[巡视器] +${activation.phoneNumber} 未超时 (${ageSeconds}s < ${releaseMs/1000}s)`);
            continue;
        }

        console.log(`[巡视器] 发现超时号码 phone=+${activation.phoneNumber} activationId=${activation.activationId} age=${ageSeconds}s -> 尝试取消`);
        await cancelActivationById(apiKey, activation.activationId);
    }
}

async function fetchAllActiveActivations(apiKey: string): Promise<ActiveActivationSnapshot[]> {
    const results: ActiveActivationSnapshot[] = [];
    let start = 0;
    const limit = 200;

    try {
      while (true) {
          const url = `${HERO_SMS_API_BASE}?action=getActiveActivations&api_key=${encodeURIComponent(apiKey)}&start=${start}&limit=${limit}`;
          const res = await proxyFetch(url, {method: "GET"});
          const body = await res.text();

          let payload: any = {};
          try {
              payload = JSON.parse(body);
          } catch {
              console.warn(`[巡视器] JSON 解析失败: ${body.substring(0, 200)}`);
              break;
          }

          const data: any[] = Array.isArray(payload?.data) ? payload.data : [];
          for (const item of data) {
              const activationId = String(item?.activationId ?? "").trim();
              const phoneNumber = String(item?.phoneNumber ?? "").trim();
              if (!activationId || !phoneNumber) {
                  continue;
              }
              results.push({
                  activationId,
                  phoneNumber,
                  activationTime: String(item?.activationTime ?? "").trim() || undefined,
                  activationStatus: String(item?.activationStatus ?? "").trim() || undefined,
              });
          }

          if (data.length < limit) {
              break;
          }
          start += limit;
      }
    } catch (error) {
      console.warn(`[巡视器] fetchAllActiveActivations 失败: ${(error as Error).message}`);
    }

    return results;
}

async function cancelActivationById(apiKey: string, activationId: string): Promise<void> {
    const url = `${HERO_SMS_API_BASE}?action=setStatus&id=${encodeURIComponent(activationId)}&status=8&api_key=${encodeURIComponent(apiKey)}`;
    try {
        const res = await proxyFetch(url, {method: "GET"});
        const body = await res.text();
        const upper = body.toUpperCase();
        if (upper.includes("ACCESS_CANCEL") || upper.includes("ACCESS_READY") || upper.includes("OTP_RECEIVED") || upper.includes("NO_ACTIVATION")) {
            console.log(`[巡视器] cancel activationId=${activationId} response=${body.slice(0, 120)}`);
            return;
        }
        console.warn(`[巡视器] cancel activationId=${activationId} unexpected=${body.slice(0, 200)}`);
    } catch (error) {
        console.warn(`[巡视器] cancel activationId=${activationId} failed=${(error as Error).message}`);
    }
}
