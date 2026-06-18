import {randomUUID} from "node:crypto";

export interface DeviceProfile {
    id: string;
    family: "desktop" | "mobile";
    browser: "chrome" | "edge";
    os: "windows" | "android";
    osVersion: string;
    userAgent: string;
    locale: string;
    languages: string[];
    acceptLanguage: string;
    timezoneId: string;
    viewportWidth: number;
    viewportHeight: number;
    screenWidth: number;
    screenHeight: number;
    outerWidth: number;
    outerHeight: number;
    deviceScaleFactor: number;
    hardwareConcurrency: number;
    deviceMemory: number;
    jsHeapSizeLimit: number;
    platform: string;
    vendor: string;
    maxTouchPoints: number;
    hasTouch: boolean;
    isMobile: boolean;
    colorDepth: number;
    pixelDepth: number;
}

export interface DeviceClientHints {
    secChUa: string;
    secChUaFullVersionList: string;
    secChUaMobile: string;
    secChUaPlatform: string;
    secChUaPlatformVersion: string;
    secChViewportWidth: string;
}

interface LocaleProfile {
    locale: string;
    languages: string[];
    acceptLanguage: string;
    timezoneId: string;
}

const DESKTOP_LOCALES: LocaleProfile[] = [
    {locale: "en-US", languages: ["en-US", "en"], acceptLanguage: "en-US,en;q=0.9", timezoneId: "America/Los_Angeles"},
    {locale: "en-US", languages: ["en-US", "en"], acceptLanguage: "en-US,en;q=0.9", timezoneId: "America/New_York"},
    {locale: "en-US", languages: ["en-US", "en"], acceptLanguage: "en-US,en;q=0.9", timezoneId: "America/Chicago"},
    {locale: "en-US", languages: ["en-US", "en"], acceptLanguage: "en-US,en;q=0.9", timezoneId: "America/Denver"},
    {locale: "en-GB", languages: ["en-GB", "en"], acceptLanguage: "en-GB,en;q=0.9", timezoneId: "Europe/London"},
    {locale: "de-DE", languages: ["de-DE", "de", "en"], acceptLanguage: "de-DE,de;q=0.9,en;q=0.8", timezoneId: "Europe/Berlin"},
    {locale: "fr-FR", languages: ["fr-FR", "fr", "en"], acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8", timezoneId: "Europe/Paris"},
    {locale: "ja-JP", languages: ["ja", "en"], acceptLanguage: "ja,en;q=0.9", timezoneId: "Asia/Tokyo"},
    {locale: "pt-BR", languages: ["pt-BR", "pt", "en"], acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8", timezoneId: "America/Sao_Paulo"},
    {locale: "es-ES", languages: ["es-ES", "es", "en"], acceptLanguage: "es-ES,es;q=0.9,en;q=0.8", timezoneId: "Europe/Madrid"},
    {locale: "en-AU", languages: ["en-AU", "en"], acceptLanguage: "en-AU,en;q=0.9", timezoneId: "Australia/Sydney"},
    {locale: "en-CA", languages: ["en-CA", "en"], acceptLanguage: "en-CA,en;q=0.9", timezoneId: "America/Toronto"},
    {locale: "ko-KR", languages: ["ko", "en"], acceptLanguage: "ko,en;q=0.9", timezoneId: "Asia/Seoul"},
    {locale: "it-IT", languages: ["it-IT", "it", "en"], acceptLanguage: "it-IT,it;q=0.9,en;q=0.8", timezoneId: "Europe/Rome"},
    {locale: "zh-CN", languages: ["zh-CN", "zh"], acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8", timezoneId: "Asia/Shanghai"},
];

const MOBILE_LOCALES: LocaleProfile[] = [
    {locale: "en-US", languages: ["en-US", "en"], acceptLanguage: "en-US,en;q=0.9", timezoneId: "America/New_York"},
    {locale: "en-US", languages: ["en-US", "en"], acceptLanguage: "en-US,en;q=0.9", timezoneId: "America/Los_Angeles"},
    {locale: "en-GB", languages: ["en-GB", "en"], acceptLanguage: "en-GB,en;q=0.9", timezoneId: "Europe/London"},
    {locale: "de-DE", languages: ["de-DE", "de", "en"], acceptLanguage: "de-DE,de;q=0.9,en;q=0.8", timezoneId: "Europe/Berlin"},
    {locale: "fr-FR", languages: ["fr-FR", "fr", "en"], acceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8", timezoneId: "Europe/Paris"},
    {locale: "ja-JP", languages: ["ja", "en"], acceptLanguage: "ja,en;q=0.9", timezoneId: "Asia/Tokyo"},
    {locale: "pt-BR", languages: ["pt-BR", "pt", "en"], acceptLanguage: "pt-BR,pt;q=0.9,en;q=0.8", timezoneId: "America/Sao_Paulo"},
    {locale: "es-ES", languages: ["es-ES", "es", "en"], acceptLanguage: "es-ES,es;q=0.9,en;q=0.8", timezoneId: "Europe/Madrid"},
    {locale: "ko-KR", languages: ["ko", "en"], acceptLanguage: "ko,en;q=0.9", timezoneId: "Asia/Seoul"},
    {locale: "it-IT", languages: ["it-IT", "it", "en"], acceptLanguage: "it-IT,it;q=0.9,en;q=0.8", timezoneId: "Europe/Rome"},
    {locale: "zh-CN", languages: ["zh-CN", "zh"], acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8", timezoneId: "Asia/Shanghai"},
];

const DESKTOP_VIEWPORTS = [
    {viewportWidth: 1280, viewportHeight: 720, screenWidth: 1280, screenHeight: 720, deviceScaleFactor: 1},
    {viewportWidth: 1365, viewportHeight: 768, screenWidth: 1366, screenHeight: 768, deviceScaleFactor: 1},
    {viewportWidth: 1366, viewportHeight: 768, screenWidth: 1366, screenHeight: 768, deviceScaleFactor: 1},
    {viewportWidth: 1440, viewportHeight: 900, screenWidth: 1440, screenHeight: 900, deviceScaleFactor: 1},
    {viewportWidth: 1536, viewportHeight: 864, screenWidth: 1536, screenHeight: 864, deviceScaleFactor: 1.25},
    {viewportWidth: 1600, viewportHeight: 900, screenWidth: 1600, screenHeight: 900, deviceScaleFactor: 1},
    {viewportWidth: 1680, viewportHeight: 1050, screenWidth: 1680, screenHeight: 1050, deviceScaleFactor: 1},
    {viewportWidth: 1710, viewportHeight: 1067, screenWidth: 1728, screenHeight: 1117, deviceScaleFactor: 1.5},
    {viewportWidth: 1728, viewportHeight: 1117, screenWidth: 1728, screenHeight: 1117, deviceScaleFactor: 2},
    {viewportWidth: 1792, viewportHeight: 1120, screenWidth: 1792, screenHeight: 1120, deviceScaleFactor: 2},
    {viewportWidth: 1920, viewportHeight: 1080, screenWidth: 1920, screenHeight: 1080, deviceScaleFactor: 1},
    {viewportWidth: 1920, viewportHeight: 1200, screenWidth: 1920, screenHeight: 1200, deviceScaleFactor: 1},
    {viewportWidth: 2048, viewportHeight: 1152, screenWidth: 2048, screenHeight: 1152, deviceScaleFactor: 1},
    {viewportWidth: 2560, viewportHeight: 1440, screenWidth: 2560, screenHeight: 1440, deviceScaleFactor: 1},
    {viewportWidth: 1280, viewportHeight: 800, screenWidth: 1280, screenHeight: 800, deviceScaleFactor: 1},
    {viewportWidth: 1440, viewportHeight: 1080, screenWidth: 1440, screenHeight: 1080, deviceScaleFactor: 1.25},
    {viewportWidth: 1600, viewportHeight: 1200, screenWidth: 1600, screenHeight: 1200, deviceScaleFactor: 1},
    {viewportWidth: 1280, viewportHeight: 1024, screenWidth: 1280, screenHeight: 1024, deviceScaleFactor: 1},
    {viewportWidth: 1680, viewportHeight: 1050, screenWidth: 1680, screenHeight: 1050, deviceScaleFactor: 1.25},
    {viewportWidth: 1360, viewportHeight: 768, screenWidth: 1360, screenHeight: 768, deviceScaleFactor: 1},
] as const;

const MOBILE_VIEWPORTS = [
    {viewportWidth: 360, viewportHeight: 800, screenWidth: 360, screenHeight: 800, deviceScaleFactor: 3},
    {viewportWidth: 375, viewportHeight: 812, screenWidth: 375, screenHeight: 812, deviceScaleFactor: 3},
    {viewportWidth: 390, viewportHeight: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 3},
    {viewportWidth: 393, viewportHeight: 852, screenWidth: 393, screenHeight: 852, deviceScaleFactor: 3},
    {viewportWidth: 393, viewportHeight: 873, screenWidth: 393, screenHeight: 873, deviceScaleFactor: 2.75},
    {viewportWidth: 412, viewportHeight: 892, screenWidth: 412, screenHeight: 892, deviceScaleFactor: 2.625},
    {viewportWidth: 412, viewportHeight: 915, screenWidth: 412, screenHeight: 915, deviceScaleFactor: 2.625},
    {viewportWidth: 414, viewportHeight: 896, screenWidth: 414, screenHeight: 896, deviceScaleFactor: 3},
    {viewportWidth: 414, viewportHeight: 916, screenWidth: 414, screenHeight: 916, deviceScaleFactor: 3},
    {viewportWidth: 430, viewportHeight: 932, screenWidth: 430, screenHeight: 932, deviceScaleFactor: 3},
    {viewportWidth: 360, viewportHeight: 780, screenWidth: 360, screenHeight: 780, deviceScaleFactor: 2.75},
    {viewportWidth: 384, viewportHeight: 854, screenWidth: 384, screenHeight: 854, deviceScaleFactor: 2.75},
    {viewportWidth: 412, viewportHeight: 846, screenWidth: 412, screenHeight: 846, deviceScaleFactor: 2.5},
    {viewportWidth: 415, viewportHeight: 897, screenWidth: 415, screenHeight: 897, deviceScaleFactor: 3},
    {viewportWidth: 392, viewportHeight: 872, screenWidth: 392, screenHeight: 872, deviceScaleFactor: 2.75},
] as const;

const DEFAULT_PROFILE = buildDesktopProfile();

export const DEFAULT_USER_AGENT = DEFAULT_PROFILE.userAgent;

export function defaultDeviceProfile(): DeviceProfile {
    return {
        ...DEFAULT_PROFILE,
        languages: [...DEFAULT_PROFILE.languages],
    };
}

export function generateRandomDeviceProfile(): DeviceProfile {
    return Math.random() < 0.68 ? buildDesktopProfile() : buildMobileProfile();
}

const NOT_A_BRAND_MAP: Record<number, string> = {
    134: "99", 135: "99", 136: "99", 137: "99",
    138: "24", 139: "24", 140: "24", 141: "24",
    142: "24", 143: "24", 144: "24", 145: "24", 146: "24",
};

const WINDOWS_PLATFORM_VERSIONS = [
    "10.0.0", "10.0.19041", "10.0.19042", "10.0.19043",
    "10.0.19044", "10.0.19045", "10.0.22000",
    "10.0.22621", "10.0.22631", "10.0.26100",
];

function resolveNotABrand(chromeMajor: number): string {
    return NOT_A_BRAND_MAP[chromeMajor] ?? "24";
}

export function getDeviceClientHints(profile: DeviceProfile): DeviceClientHints {
    const majorVersion = extractBrowserMajorVersion(profile.userAgent);
    const fullVersion = extractBrowserFullVersion(profile.userAgent);
    const chromeMajor = parseInt(majorVersion, 10) || 146;
    const notABrand = resolveNotABrand(chromeMajor);
    const brands =
        profile.browser === "edge"
            ? [
                `"Microsoft Edge";v="${majorVersion}"`,
                `"Chromium";v="${majorVersion}"`,
                `"Not.A/Brand";v="${notABrand}"`,
            ]
            : [
                `"Google Chrome";v="${majorVersion}"`,
                `"Chromium";v="${majorVersion}"`,
                `"Not.A/Brand";v="${notABrand}"`,
            ];
    const fullVersionBrands =
        profile.browser === "edge"
            ? [
                `"Microsoft Edge";v="${fullVersion}"`,
                `"Chromium";v="${fullVersion}"`,
                `"Not.A/Brand";v="${notABrand}.0.0.0"`,
            ]
            : [
                `"Google Chrome";v="${fullVersion}"`,
                `"Chromium";v="${fullVersion}"`,
                `"Not.A/Brand";v="${notABrand}.0.0.0"`,
            ];

    return {
        secChUa: brands.join(", "),
        secChUaFullVersionList: fullVersionBrands.join(", "),
        secChUaMobile: profile.isMobile ? "?1" : "?0",
        secChUaPlatform: profile.os === "android" ? '"Android"' : '"Windows"',
        secChUaPlatformVersion: profile.os === "android"
            ? `"${profile.osVersion}"`
            : `"${pick(WINDOWS_PLATFORM_VERSIONS)}"`,
        secChViewportWidth: `"${profile.viewportWidth}"`,
    };
}

function buildDesktopProfile(): DeviceProfile {
    const viewport = pick(DESKTOP_VIEWPORTS);
    const locale = pick(DESKTOP_LOCALES);
    const browser = Math.random() < 0.72 ? "chrome" : "edge";
    const chromeMajor = randomInt(134, 146);
    const chromeBuild = randomInt(6000, 9999);
    const chromePatch = randomInt(50, 220);
    const edgeMajor = clamp(chromeMajor + randomInt(-1, 0), 134, 146);
    const isWin11 = Math.random() < 0.4;
    const osVersion = isWin11 ? "10.0" : "10.0";
    const userAgent =
        browser === "edge"
            ? `Mozilla/5.0 (Windows NT ${osVersion}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeBuild}.${chromePatch} Safari/537.36 Edg/${edgeMajor}.0.${randomInt(3000, 9999)}.${randomInt(30, 220)}`
            : `Mozilla/5.0 (Windows NT ${osVersion}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeBuild}.${chromePatch} Safari/537.36`;

    return {
        id: randomUUID(),
        family: "desktop",
        browser,
        os: "windows",
        osVersion: "10.0",
        userAgent,
        locale: locale.locale,
        languages: [...locale.languages],
        acceptLanguage: locale.acceptLanguage,
        timezoneId: locale.timezoneId,
        viewportWidth: viewport.viewportWidth,
        viewportHeight: viewport.viewportHeight,
        screenWidth: viewport.screenWidth,
        screenHeight: viewport.screenHeight,
        outerWidth: viewport.viewportWidth + randomInt(15, 30),
        outerHeight: viewport.viewportHeight + randomInt(80, 120),
        deviceScaleFactor: viewport.deviceScaleFactor,
        hardwareConcurrency: pick([2, 4, 6, 8, 8, 10, 12, 12, 14, 16, 16, 20, 24]),
        deviceMemory: pick([2, 4, 8, 8, 12, 16, 16, 24, 32]),
        jsHeapSizeLimit: pick([
            2147483648, 3221225472, 4294967296, 4294967296,
            5368709120, 6442450944, 7516192768, 8589934592,
            10737418240, 12884901888, 17179869184,
        ]),
        platform: "Win32",
        vendor: "Google Inc.",
        maxTouchPoints: 0,
        hasTouch: false,
        isMobile: false,
        colorDepth: 24,
        pixelDepth: 24,
    };
}

function buildMobileProfile(): DeviceProfile {
    const viewport = pick(MOBILE_VIEWPORTS);
    const locale = pick(MOBILE_LOCALES);
    const chromeMajor = randomInt(133, 146);
    const chromeBuild = randomInt(6000, 9999);
    const chromePatch = randomInt(50, 220);
    const androidMajor = pick([12, 12, 13, 13, 14, 14, 14, 15, 15]);
    const androidModel = pick([
        "Pixel 7", "Pixel 8", "Pixel 8 Pro", "Pixel 9", "Pixel 9 Pro",
        "SM-S918B", "SM-S928B", "SM-S931B", "SM-A546B",
        "CPH2487", "CPH2591",
        "MI 13", "MI 14", "2304FPN6DC",
        "SM-G991B", "SM-G996B",
    ]);

    return {
        id: randomUUID(),
        family: "mobile",
        browser: "chrome",
        os: "android",
        osVersion: `${androidMajor}.0.0`,
        userAgent: `Mozilla/5.0 (Linux; Android ${androidMajor}; ${androidModel}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${chromeBuild}.${chromePatch} Mobile Safari/537.36`,
        locale: locale.locale,
        languages: [...locale.languages],
        acceptLanguage: locale.acceptLanguage,
        timezoneId: locale.timezoneId,
        viewportWidth: viewport.viewportWidth,
        viewportHeight: viewport.viewportHeight,
        screenWidth: viewport.screenWidth,
        screenHeight: viewport.screenHeight,
        outerWidth: viewport.viewportWidth,
        outerHeight: viewport.viewportHeight,
        deviceScaleFactor: viewport.deviceScaleFactor,
        hardwareConcurrency: pick([2, 4, 4, 6, 6, 8, 8, 8]),
        deviceMemory: pick([2, 4, 4, 6, 6, 8, 8, 12]),
        jsHeapSizeLimit: pick([
            1073741824, 2147483648, 2147483648, 3221225472,
            3221225472, 4294967296, 4294967296, 5368709120,
        ]),
        platform: "Linux armv8l",
        vendor: "Google Inc.",
        maxTouchPoints: pick([5, 10, 10]),
        hasTouch: true,
        isMobile: true,
        colorDepth: 24,
        pixelDepth: 24,
    };
}

function pick<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function extractBrowserMajorVersion(userAgent: string): string {
    const edgeMatch = /Edg\/(\d+)/.exec(userAgent);
    if (edgeMatch?.[1]) {
        return edgeMatch[1];
    }

    const chromeMatch = /Chrome\/(\d+)/.exec(userAgent);
    return chromeMatch?.[1] ?? "146";
}

function extractBrowserFullVersion(userAgent: string): string {
    const edgeMatch = /Edg\/([\d.]+)/.exec(userAgent);
    if (edgeMatch?.[1]) {
        return edgeMatch[1];
    }

    const chromeMatch = /Chrome\/([\d.]+)/.exec(userAgent);
    return chromeMatch?.[1] ?? "146.0.0.0";
}
