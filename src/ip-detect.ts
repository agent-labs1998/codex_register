// IP 地址检测模块 - 使用 ip-api.com（免费，无需 API key）
// 限制：每分钟 45 次请求

import { appConfig } from "./config.js";
import { proxyFetch } from "./proxy-fetch.js";

export interface IpInfo {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  isp: string;
  org: string;
  as: string;
  isResidential: boolean;
  isProxy: boolean;
  isHosting: boolean;
  isMobile: boolean;
}

let cachedIpInfo: IpInfo | null = null;

export async function getIpInfo(): Promise<IpInfo> {
  if (cachedIpInfo) {
    return cachedIpInfo;
  }

  // 根据配置决定使用代理还是直连
  const proxyUrl = appConfig.defaultProxyUrl?.trim();
  const useProxy = !!proxyUrl;

  // 尝试多个 API，避免单点失败
  const apis = [
    { url: "http://ip-api.com/json/?fields=66846719", parser: parseIpApi },
    { url: "https://ipapi.co/json/", parser: parseIpApiCo },
    { url: "https://ipinfo.io/json", parser: parseIpInfo },
  ];

  for (const api of apis) {
    try {
      // 如果配置了代理，使用 proxyFetch；否则使用原生 fetch
      const res = useProxy
        ? await proxyFetch(api.url, { signal: AbortSignal.timeout(8000) })
        : await fetch(api.url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      cachedIpInfo = api.parser(data);
      if (cachedIpInfo.ip && cachedIpInfo.ip !== "unknown") {
        console.log(`[IP] 检测方式: ${useProxy ? '通过代理' : '直连'}`);
        return cachedIpInfo;
      }
    } catch {
      continue;
    }
  }

  console.warn(`[IP] 所有 IP 检测 API 都失败`);
  return {
    ip: "unknown", country: "unknown", countryCode: "unknown",
    region: "unknown", city: "unknown", isp: "unknown", org: "unknown",
    as: "unknown", isResidential: false, isProxy: false, isHosting: false, isMobile: false,
  };
}

export async function getPublicIp(): Promise<string> {
  const info = await getIpInfo();
  return info.ip;
}

// 重置缓存（IP 切换时调用）
export function resetIpCache() {
  cachedIpInfo = null;
}

// 解析 ip-api.com 响应
function parseIpApi(data: any): IpInfo {
  const isp = data.isp || "";
  const org = data.org || "";
  const as = data.as || "";
  return {
    ip: data.query || "unknown",
    country: data.country || "unknown",
    countryCode: data.countryCode || "unknown",
    region: data.regionName || "unknown",
    city: data.city || "unknown",
    isp, org, as,
    isResidential: !data.proxy && !data.hosting,
    isProxy: data.proxy || false,
    isHosting: data.hosting || false,
    isMobile: data.mobile || false,
  };
}

// 解析 ipapi.co 响应
function parseIpApiCo(data: any): IpInfo {
  const org = data.org || "";
  const isHosting = /hosting|cloud|server|datacenter/i.test(org);
  return {
    ip: data.ip || "unknown",
    country: data.country_name || "unknown",
    countryCode: data.country_code || "unknown",
    region: data.region || "unknown",
    city: data.city || "unknown",
    isp: data.org || "unknown",
    org: data.org || "unknown",
    as: data.asn || "unknown",
    isResidential: !isHosting,
    isProxy: false,
    isHosting,
    isMobile: false,
  };
}

// 解析 ipinfo.io 响应
function parseIpInfo(data: any): IpInfo {
  const org = data.org || "";
  const isHosting = /hosting|cloud|server|datacenter/i.test(org);
  return {
    ip: data.ip || "unknown",
    country: data.country || "unknown",
    countryCode: data.country || "unknown",
    region: data.region || "unknown",
    city: data.city || "unknown",
    isp: data.org || "unknown",
    org: data.org || "unknown",
    as: data.org || "unknown",
    isResidential: !isHosting,
    isProxy: false,
    isHosting,
    isMobile: false,
  };
}
