import {readFileSync} from "node:fs";
import path from "node:path";

export type MailProviderName = "2925" | "gmail" | "proxiedmail" | "cloudflare" | "hotmail" | "gptmail" | "coroabet";

interface AppConfigFile {
    provider?: unknown;
    defaultPassword?: unknown;
    loopDelayMs?: unknown;
    gmailAccessToken?: unknown;
    gmailEmailAddress?: unknown;
    gptMailApiKey?: unknown;
    gptMailDomain?: unknown;
    "2925EmailAddress"?: unknown;
    "2925Password"?: unknown;
    cloudflareEmailDomain?: unknown;
    cloudflareApiBaseUrl?: unknown;
    cloudflareApiKey?: unknown;
    defaultProxyUrl?: unknown;
    heroSMSApiKey?: unknown;
    heroSMSCountry?: unknown;
    heroSMSCountries?: unknown;
    heroSMSMaxPrice?: unknown;
    heroSMSPriceTiers?: unknown;
    heroSMSPollAttempts?: unknown;
    heroSMSPollIntervalMs?: unknown;
    cliproxyApiAutoUploadAuth?: unknown;
    cliproxyApiBaseUrl?: unknown;
    cliproxyApiManagementKey?: unknown;
    coroabetWorkerDomain?: unknown;
    coroabetEmailDomain?: unknown;
    coroabetAdminPassword?: unknown;
    coroabetEnablePrefix?: unknown;
    probeTrialProxyJp?: unknown;
    profileLocale?: unknown;
    profileAgeMin?: unknown;
    profileAgeMax?: unknown;
    profileIpLookupUrl?: unknown;
    profileIpLookupTimeoutMs?: unknown;
    profileLocaleByCountry?: unknown;
    logLevel?: unknown;
}

export interface AppConfig {
    provider: MailProviderName;
    defaultPassword: string;
    loopDelayMs: number;
    gmailAccessToken: string;
    gmailEmailAddress: string;
    gptMailApiKey: string;
    gptMailDomain: string;
    ["2925EmailAddress"]: string;
    ["2925Password"]: string;
    cloudflareEmailDomain: string;
    cloudflareApiBaseUrl: string;
    cloudflareApiKey: string;
    defaultProxyUrl: string;
    heroSMSApiKey?: string;
    heroSMSCountry: number;
    heroSMSCountries?: number[];
    heroSMSMaxPrice: number;
    heroSMSPriceTiers?: number[];
    heroSMSPollAttempts: number;
    heroSMSPollIntervalMs: number;
    heroSMSProxy: string;
    cliproxyApiAutoUploadAuth: boolean;
    cliproxyApiBaseUrl: string;
    cliproxyApiManagementKey: string;
    coroabetWorkerDomain: string;
    coroabetEmailDomain: string;
    coroabetAdminPassword: string;
    coroabetEnablePrefix: boolean;
    probeTrialProxyJp: string;
    profileLocale: string;
    profileAgeMin: number;
    profileAgeMax: number;
    profileIpLookupUrl: string;
    profileIpLookupTimeoutMs: number;
    profileLocaleByCountry: Record<string, string>;
    logLevel: "info" | "debug";
}

const DEFAULT_CONFIG: AppConfig = {
    provider: "proxiedmail",
    defaultPassword: "kuaileshifu88",
    loopDelayMs: 120000,
    gmailAccessToken: "",
    gmailEmailAddress: "",
    gptMailApiKey: "",
    gptMailDomain: "",
    "2925EmailAddress": "",
    "2925Password": "",
    cloudflareEmailDomain: "",
    cloudflareApiBaseUrl: "",
    cloudflareApiKey: "",
    defaultProxyUrl: "http://127.0.0.1:10808",
    heroSMSApiKey: undefined,
    heroSMSCountry: 52,
    heroSMSMaxPrice: 0.05,
    heroSMSPollAttempts: 10,
    heroSMSPollIntervalMs: 3000,
    heroSMSProxy: "",
    cliproxyApiAutoUploadAuth: false,
    cliproxyApiBaseUrl: "http://localhost:8317",
    cliproxyApiManagementKey: "",
    coroabetWorkerDomain: "",
    coroabetEmailDomain: "",
    coroabetAdminPassword: "",
    coroabetEnablePrefix: false,
    probeTrialProxyJp: "",
    profileLocale: "auto",
    profileAgeMin: 25,
    profileAgeMax: 34,
    profileIpLookupUrl: "https://ipinfo.io/json",
    profileIpLookupTimeoutMs: 10000,
    profileLocaleByCountry: {
        US: "en_US",
        JP: "ja",
        GB: "en_GB",
        CO: "es",
        CL: "es",
        BR: "pt_BR",
        FR: "fr",
        DE: "de",
    },
    logLevel: "info",
};

function normalizeNumber(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback;
    }
    return value;
}

function normalizeProvider(value: unknown): MailProviderName {
    if (value === "2925" || value === "gmail" || value === "proxiedmail" || value === "cloudflare" || value === "hotmail" || value === "gptmail" || value === "coroabet") {
        return value;
    }
    return DEFAULT_CONFIG.provider;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) {
            return true;
        }
        if (["false", "0", "no", "off"].includes(normalized)) {
            return false;
        }
    }
    return fallback;
}

function normalizeStringRecord(value: unknown, fallback: Record<string, string>): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {...fallback};
    }
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const normalizedKey = key.trim().toUpperCase();
        const normalizedValue = typeof raw === "string" ? raw.trim() : "";
        if (normalizedKey && normalizedValue) {
            out[normalizedKey] = normalizedValue;
        }
    }
    return Object.keys(out).length ? out : {...fallback};
}

function normalizeString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function loadConfig(): AppConfig {
    const configPath = path.resolve(process.cwd(), "config.json");
    let raw: string;
    try {
        raw = readFileSync(configPath, "utf8");
    } catch {
        throw new Error("未找到 config.json，请先复制 config.example.json 为 config.json 并按需修改配置");
    }

    const parsed = JSON.parse(raw) as AppConfigFile;
    return {
        provider: normalizeProvider(parsed.provider),
        defaultPassword:
            typeof parsed.defaultPassword === "string" && parsed.defaultPassword.trim()
                ? parsed.defaultPassword
                : DEFAULT_CONFIG.defaultPassword,
        loopDelayMs: normalizeNumber(parsed.loopDelayMs, DEFAULT_CONFIG.loopDelayMs),
        gmailAccessToken:
            typeof parsed.gmailAccessToken === "string"
                ? parsed.gmailAccessToken.trim()
                : DEFAULT_CONFIG.gmailAccessToken,
        gmailEmailAddress:
            typeof parsed.gmailEmailAddress === "string"
                ? parsed.gmailEmailAddress.trim()
                : DEFAULT_CONFIG.gmailEmailAddress,
        gptMailApiKey:
            typeof parsed.gptMailApiKey === "string"
                ? parsed.gptMailApiKey.trim()
                : DEFAULT_CONFIG.gptMailApiKey,
        gptMailDomain:
            typeof parsed.gptMailDomain === "string"
                ? parsed.gptMailDomain.trim()
                : DEFAULT_CONFIG.gptMailDomain,
        "2925EmailAddress":
            typeof parsed["2925EmailAddress"] === "string"
                ? parsed["2925EmailAddress"].trim()
                : DEFAULT_CONFIG["2925EmailAddress"],
        "2925Password":
            typeof parsed["2925Password"] === "string"
                ? parsed["2925Password"].trim()
                : DEFAULT_CONFIG["2925Password"],
        cloudflareEmailDomain:
            typeof parsed.cloudflareEmailDomain === "string" && parsed.cloudflareEmailDomain.trim()
                ? parsed.cloudflareEmailDomain.trim()
                : DEFAULT_CONFIG.cloudflareEmailDomain,
        cloudflareApiBaseUrl:
            typeof parsed.cloudflareApiBaseUrl === "string"
                ? parsed.cloudflareApiBaseUrl.trim()
                : DEFAULT_CONFIG.cloudflareApiBaseUrl,
        cloudflareApiKey:
            typeof parsed.cloudflareApiKey === "string"
                ? parsed.cloudflareApiKey.trim()
                : DEFAULT_CONFIG.cloudflareApiKey,
        defaultProxyUrl:
            typeof parsed.defaultProxyUrl === "string"
                ? parsed.defaultProxyUrl.trim()
                : DEFAULT_CONFIG.defaultProxyUrl,
        heroSMSApiKey:
          typeof parsed.heroSMSApiKey === "string"
            ? parsed.heroSMSApiKey.trim()
            : DEFAULT_CONFIG.heroSMSApiKey,
        heroSMSCountry:
          typeof parsed.heroSMSCountry === "number"
            ? parsed.heroSMSCountry
            : DEFAULT_CONFIG.heroSMSCountry,
        heroSMSCountries:
          Array.isArray(parsed.heroSMSCountries)
            ? (parsed.heroSMSCountries as unknown[])
                .map((v) => Number(v))
                .filter((v) => Number.isFinite(v) && v >= 0)
            : undefined,
        heroSMSMaxPrice:
          typeof parsed.heroSMSMaxPrice === "number"
            ? parsed.heroSMSMaxPrice
            : DEFAULT_CONFIG.heroSMSMaxPrice,
        heroSMSPriceTiers:
          Array.isArray(parsed.heroSMSPriceTiers)
            ? (parsed.heroSMSPriceTiers as unknown[])
                .map((v) => Number(v))
                .filter((v) => Number.isFinite(v) && v > 0)
            : undefined,
        heroSMSPollAttempts:
          typeof parsed.heroSMSPollAttempts === "number"
            ? parsed.heroSMSPollAttempts
            : DEFAULT_CONFIG.heroSMSPollAttempts,
        heroSMSPollIntervalMs:
          typeof parsed.heroSMSPollIntervalMs === "number"
            ? parsed.heroSMSPollIntervalMs
            : DEFAULT_CONFIG.heroSMSPollIntervalMs,
        heroSMSProxy:
          typeof parsed.heroSMSProxy === "string"
            ? parsed.heroSMSProxy
            : DEFAULT_CONFIG.heroSMSProxy,
        cliproxyApiAutoUploadAuth: normalizeBoolean(
            parsed.cliproxyApiAutoUploadAuth,
            DEFAULT_CONFIG.cliproxyApiAutoUploadAuth,
        ),
        cliproxyApiBaseUrl:
            typeof parsed.cliproxyApiBaseUrl === "string" && parsed.cliproxyApiBaseUrl.trim()
                ? parsed.cliproxyApiBaseUrl.trim()
                : DEFAULT_CONFIG.cliproxyApiBaseUrl,
        cliproxyApiManagementKey:
            typeof parsed.cliproxyApiManagementKey === "string"
                ? parsed.cliproxyApiManagementKey.trim()
                : DEFAULT_CONFIG.cliproxyApiManagementKey,
        coroabetWorkerDomain:
            typeof parsed.coroabetWorkerDomain === "string" && parsed.coroabetWorkerDomain.trim()
                ? parsed.coroabetWorkerDomain.trim()
                : DEFAULT_CONFIG.coroabetWorkerDomain,
        coroabetEmailDomain:
            typeof parsed.coroabetEmailDomain === "string" && parsed.coroabetEmailDomain.trim()
                ? parsed.coroabetEmailDomain.trim()
                : DEFAULT_CONFIG.coroabetEmailDomain,
        coroabetAdminPassword:
            typeof parsed.coroabetAdminPassword === "string" && parsed.coroabetAdminPassword.trim()
                ? parsed.coroabetAdminPassword.trim()
                : DEFAULT_CONFIG.coroabetAdminPassword,
        coroabetEnablePrefix: normalizeBoolean(parsed.coroabetEnablePrefix, DEFAULT_CONFIG.coroabetEnablePrefix),
        probeTrialProxyJp:
            typeof parsed.probeTrialProxyJp === "string" && parsed.probeTrialProxyJp.trim()
                ? parsed.probeTrialProxyJp.trim()
                : DEFAULT_CONFIG.probeTrialProxyJp,
        profileLocale: normalizeString(parsed.profileLocale, DEFAULT_CONFIG.profileLocale),
        profileAgeMin: normalizePositiveInteger(parsed.profileAgeMin, DEFAULT_CONFIG.profileAgeMin),
        profileAgeMax: normalizePositiveInteger(parsed.profileAgeMax, DEFAULT_CONFIG.profileAgeMax),
        profileIpLookupUrl: normalizeString(parsed.profileIpLookupUrl, DEFAULT_CONFIG.profileIpLookupUrl),
        profileIpLookupTimeoutMs: normalizePositiveInteger(parsed.profileIpLookupTimeoutMs, DEFAULT_CONFIG.profileIpLookupTimeoutMs),
        profileLocaleByCountry: normalizeStringRecord(parsed.profileLocaleByCountry, DEFAULT_CONFIG.profileLocaleByCountry),
        logLevel: parsed.logLevel === "debug" ? "debug" : "info",
    };
}

export const appConfig = loadConfig();
