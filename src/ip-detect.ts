// IP 地址检测模块 - 使用 ip-api.com（免费，无需 API key）
// 限制：每分钟 45 次请求

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

  try {
    // ip-api.com 免费 API，无需 API key
    // fields=66846719 包含所有需要的字段
    const res = await fetch("http://ip-api.com/json/?fields=66846719", {
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();

    if (data.status === "fail") {
      throw new Error(data.message || "API request failed");
    }

    // 直接使用 API 返回的字段
    cachedIpInfo = {
      ip: data.query || "unknown",
      country: data.country || "unknown",
      countryCode: data.countryCode || "unknown",
      region: data.regionName || "unknown",
      city: data.city || "unknown",
      isp: data.isp || "unknown",
      org: data.org || "unknown",
      as: data.as || "unknown",
      // 住宅 IP = 不是代理 且 不是托管
      isResidential: !data.proxy && !data.hosting,
      isProxy: data.proxy || false,
      isHosting: data.hosting || false,
      isMobile: data.mobile || false,
    };

    return cachedIpInfo;
  } catch (error) {
    console.warn(`[IP] 获取 IP 信息失败: ${(error as Error).message}`);
    return {
      ip: "unknown",
      country: "unknown",
      countryCode: "unknown",
      region: "unknown",
      city: "unknown",
      isp: "unknown",
      org: "unknown",
      as: "unknown",
      isResidential: false,
      isProxy: false,
      isHosting: false,
      isMobile: false,
    };
  }
}

export async function getPublicIp(): Promise<string> {
  const info = await getIpInfo();
  return info.ip;
}
