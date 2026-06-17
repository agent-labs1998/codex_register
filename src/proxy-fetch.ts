// 统一的代理 fetch 工具
// 逻辑：defaultProxyUrl 有值就走代理，为空就直连
import { appConfig } from "./config.js";

let cachedDispatcher: any = null;

async function getDispatcher() {
  if (cachedDispatcher !== null) {
    return cachedDispatcher;
  }

  const proxyUrl = String(appConfig.defaultProxyUrl ?? "").trim();
  if (!proxyUrl) {
    cachedDispatcher = undefined; // 无代理，直连
    return cachedDispatcher;
  }

  try {
    const { createProxyDispatcher } = await import("./proxy-dispatcher.js");
    cachedDispatcher = createProxyDispatcher(proxyUrl, true);
  } catch (e) {
    console.warn(`[proxy-fetch] 创建代理 dispatcher 失败: ${(e as Error).message}，使用直连`);
    cachedDispatcher = undefined;
  }

  return cachedDispatcher;
}

// 带代理的 fetch
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const dispatcher = await getDispatcher();
  if (!dispatcher) {
    // 无代理，用原生 fetch
    return fetch(url, init);
  }

  // 有代理，用 undici fetch
  const { fetch: undiciFetch } = await import("undici");
  return undiciFetch(url, {
    ...init,
    dispatcher,
  } as any) as unknown as Promise<Response>;
}

// 重置缓存（用于测试）
export function resetProxyFetchCache() {
  cachedDispatcher = null;
}
