import {appConfig} from "../config.js";
import {
  Agent,
  ProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

interface ActiveActivationSnapshot {
    activationId: string;
    phoneNumber: string;
    activationTime?: string;
    activationStatus?: string;
}

const HERO_SMS_API_BASE = "https://hero-sms.com/stubs/handler_api.php";

// 根据配置创建代理调度器（与 heroSMS.ts 保持一致）
function buildDispatcher(): Dispatcher {
    const proxyUrl = String(appConfig.heroSMSProxy ?? appConfig.defaultProxyUrl ?? "").trim();
    return proxyUrl
        ? new ProxyAgent({
            uri: proxyUrl,
            requestTls: { rejectUnauthorized: false },
        })
        : new Agent({
            connect: { rejectUnauthorized: false },
        });
}

// 使用代理的 fetch
async function heroSmsFetch(url: string, init?: RequestInit): Promise<Response> {
    const dispatcher = buildDispatcher();
    return undiciFetch(url, {
        ...init,
        dispatcher,
    } as any) as unknown as Promise<Response>;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseActivationTimeMs(value?: string): number {
    if (!value) {
        return 0;
    }

    // HeroSMS 返回的时间是北京时间（UTC+8）
    // 格式：2026-06-17 09:40:18
    // 直接添加 +08:00 时区标识
    const ms = Date.parse(value.replace(" ", "T") + "+08:00");

    return Number.isFinite(ms) ? ms : 0;
}

// 检查 activationStatus 是否可取消
// 状态码：
// 1 = 等待 SMS（可取消）
// 3 = 等待重试（可取消）
// 4 = 未知/过期（可取消）
// 6 = 已取消（不需要取消）
// 8 = 已完成（不需要取消）
// 2 = 已收到验证码（不可取消）
function isCancellableStatus(status?: string): boolean {
    if (!status) return true;
    const s = status.trim();
    // 已取消或已完成，不需要取消
    if (s === "6" || s === "8") return false;
    // 已收到验证码，不可取消
    if (s === "2") return false;
    // 其他状态（1, 3, 4 等）可以取消
    return true;
}

export function startHeroSmsPatrolLoop(): {stop: () => void} {
    const apiKey = String(appConfig.heroSMSApiKey ?? "").trim();
    if (!apiKey) {
        return {stop() {}};
    }

    let running = true;
    const POLL_INTERVAL_MS = 25_000; // 25 秒巡视一次，避免频繁调用 API
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
    let cancelledCount = 0;
    let skippedCount = 0;

    for (const activation of activations) {
        // 检查状态是否可取消
        if (!isCancellableStatus(activation.activationStatus)) {
            console.log(`[巡视器] +${activation.phoneNumber} 状态 ${activation.activationStatus} 不可取消（已收到验证码或已完成）`);
            skippedCount++;
            continue;
        }

        const activationTimeMs = parseActivationTimeMs(activation.activationTime);
        const ageMs = activationTimeMs > 0 ? now - activationTimeMs : 0;
        const ageSeconds = Math.floor(ageMs / 1000);

        // 检查是否超过最小激活期（120秒）
        if (ageMs < releaseMs) {
            const waitSeconds = Math.ceil((releaseMs - ageMs) / 1000);
            console.log(`[巡视器] +${activation.phoneNumber} 需等待 ${waitSeconds}秒 (已 ${ageSeconds}s < ${releaseMs/1000}s)`);
            skippedCount++;
            continue;
        }

        console.log(`[巡视器] 发现可取消号码 phone=+${activation.phoneNumber} activationId=${activation.activationId} age=${ageSeconds}s status=${activation.activationStatus} -> 尝试取消`);
        await cancelActivationById(apiKey, activation.activationId);
        cancelledCount++;
    }

    if (cancelledCount > 0 || skippedCount > 0) {
        console.log(`[巡视器] 本轮扫描完成: 可取消=${cancelledCount}, 跳过=${skippedCount}`);
    }
}

async function fetchAllActiveActivations(apiKey: string): Promise<ActiveActivationSnapshot[]> {
    const results: ActiveActivationSnapshot[] = [];
    let start = 0;
    const limit = 100; // API 限制最大 100

    try {
      while (true) {
          const url = `${HERO_SMS_API_BASE}?action=getActiveActivations&api_key=${encodeURIComponent(apiKey)}&start=${start}&limit=${limit}`;
          const res = await heroSmsFetch(url, {method: "GET"});
          const body = await res.text();

          let payload: any = {};
          try {
              payload = JSON.parse(body);
              if (payload.status !== "success") {
                  console.warn(`[巡视器] API 返回错误状态: ${payload.status}`, JSON.stringify(payload).substring(0, 200));
                  break;
              }
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
        const res = await heroSmsFetch(url, {method: "GET"});
        const body = await res.text();
        const upper = body.toUpperCase();

        // 成功取消的情况
        if (upper.includes("ACCESS_CANCEL") || upper.includes("ACCESS_READY")) {
            console.log(`[巡视器] ✅ 已取消 activationId=${activationId}`);
            return;
        }

        // 已经取消或已完成
        if (upper.includes("OTP_RECEIVED") || upper.includes("NO_ACTIVATION") || upper.includes("BAD_STATUS")) {
            console.log(`[巡视器] ⚪ activationId=${activationId} 已处理: ${body.slice(0, 100)}`);
            return;
        }

        // 无法取消（未到最小激活期）
        if (upper.includes("EARLY_CANCEL_DENIED")) {
            console.log(`[巡视器] ⏳ activationId=${activationId} 未到最小激活期，稍后再试`);
            return;
        }

        // 其他情况
        console.warn(`[巡视器] ❌ activationId=${activationId} 取消失败: ${body.slice(0, 200)}`);
    } catch (error) {
        console.warn(`[巡视器] ❌ activationId=${activationId} 请求异常: ${(error as Error).message}`);
    }
}
