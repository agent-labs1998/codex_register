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
}

// 判断是否住宅 IP
function checkResidential(isp: string, org: string, as: string): boolean {
  const keywords = [
    "hosting", "datacenter", "cloud", "server", "vps",
    "digital ocean", "amazon", "google", "microsoft", "azure",
    "alibaba", "tencent", "ovh", "hetzner", "linode",
    "vultr", "leaseweb", "colocrossing", "psychz",
    "proxy", "vpn", "tor", "anonymous"
  ];

  const text = `${isp} ${org} ${as}`.toLowerCase();
  return !keywords.some(kw => text.includes(kw));
}

// 判断是否代理/VPN
function checkProxy(isp: string, org: string): boolean {
  const keywords = ["proxy", "vpn", "tor", "anonymous", "hide", "shield"];
  const text = `${isp} ${org}`.toLowerCase();
  return keywords.some(kw => text.includes(kw));
}

// 判断是否托管/数据中心
function checkHosting(isp: string, org: string, as: string): boolean {
  const keywords = [
    "hosting", "datacenter", "cloud", "server", "vps",
    "digital ocean", "amazon", "google", "microsoft", "azure",
    "alibaba", "tencent", "ovh", "hetzner", "linode",
    "vultr", "leaseweb", "colocrossing", "psychz"
  ];
  const text = `${isp} ${org} ${as}`.toLowerCase();
  return keywords.some(kw => text.includes(kw));
}

let cachedIpInfo: IpInfo | null = null;

export async function getIpInfo(): Promise<IpInfo> {
  if (cachedIpInfo) {
    return cachedIpInfo;
  }

  try {
    // ip-api.com 免费 API，无需 API key
    const res = await fetch("http://ip-api.com/json/?fields=66846719", {
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();

    if (data.status === "fail") {
      throw new Error(data.message || "API request failed");
    }

    const ip = data.query || "unknown";
    const isp = data.isp || "";
    const org = data.org || "";
    const as = data.as || "";

    cachedIpInfo = {
      ip,
      country: data.country || "unknown",
      countryCode: data.countryCode || "unknown",
      region: data.regionName || "unknown",
      city: data.city || "unknown",
      isp,
      org,
      as,
      isResidential: checkResidential(isp, org, as),
      isProxy: checkProxy(isp, org),
      isHosting: checkHosting(isp, org, as),
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
    };
  }
}

export async function getPublicIp(): Promise<string> {
  const info = await getIpInfo();
  return info.ip;
}
