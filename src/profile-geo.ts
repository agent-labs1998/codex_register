import {appConfig} from "./config.js";
import {createProxyDispatcher} from "./proxy-dispatcher.js";

interface GeoLookupResult {
    country: string;
    ip?: string;
    source: string;
}

const cacheByProxy = new Map<string, GeoLookupResult>();

function normalizeCountry(raw: unknown): string {
    const value = String(raw ?? "").trim().toUpperCase();
    return value.replace(/[^A-Z]/g, "").slice(0, 3) || "";
}

function extractCountry(data: Record<string, unknown>): string {
    const candidates = [
        data.country,
        data.country_code,
        data.countryCode,
        data.loc,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string") {
            const upper = candidate.trim().toUpperCase();
            if (/^[A-Z]{2,3}$/.test(upper)) {
                return upper;
            }
            if (upper.includes(",")) {
                const tail = upper.split(",").pop()?.trim() ?? "";
                if (/^[A-Z]{2,3}$/.test(tail)) {
                    return tail;
                }
            }
        }
    }

    return "";
}

export function clearProfileGeoCache(): void {
    cacheByProxy.clear();
}

export async function getProfileCountryByRegistrationProxy(): Promise<GeoLookupResult> {
    const proxyUrl = String(appConfig.defaultProxyUrl ?? "").trim();
    const lookupUrl = String(appConfig.profileIpLookupUrl ?? "").trim();
    if (!lookupUrl) {
        throw new Error("profileIpLookupUrl 未配置");
    }

    const cacheKey = `${proxyUrl}|||${lookupUrl}`;
    const cached = cacheByProxy.get(cacheKey);
    if (cached) {
        return cached;
    }

    const dispatcher = createProxyDispatcher(proxyUrl, true);
    const controller = new AbortController();
    const timeoutMs = Math.max(1000, Number(appConfig.profileIpLookupTimeoutMs) || 10000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(lookupUrl, {
            method: "GET",
            headers: {
                accept: "application/json",
                "user-agent": "codex-register/profile-geo/1.0",
            },
            signal: controller.signal,
            // @ts-ignore – undici dispatcher
            dispatcher,
        });

        if (!response.ok) {
            throw new Error(`IP 地理查询失败: ${response.status} ${await response.text()}`);
        }

        const data = (await response.json()) as Record<string, unknown>;
        const country = normalizeCountry(extractCountry(data));
        if (!country) {
            throw new Error(`IP 地理查询未返回有效国家: ${JSON.stringify(data).slice(0, 200)}`);
        }

        const result: GeoLookupResult = {
            country,
            ip: typeof data.ip === "string" ? data.ip : undefined,
            source: new URL(lookupUrl).hostname,
        };

        cacheByProxy.set(cacheKey, result);
        return result;
    } catch (error) {
        if ((error as Error).name === "AbortError") {
            throw new Error(`IP 地理查询超时 (${timeoutMs}ms)`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}
