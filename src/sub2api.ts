/**
 * sub2api API 封装
 *
 * 自动登录获取 JWT token，24 小时有效，过期前 5 分钟自动刷新。
 * 步骤 5: 获取授权 URL
 * 步骤 8: 用 code 换 token
 * 步骤 9: 创建账户入库
 */
import {Agent, fetch as undiciFetch, type Dispatcher} from "undici";

let cachedDispatcher: Dispatcher | null = null;

function getSub2apiDispatcher(): Dispatcher {
    if (!cachedDispatcher) {
        cachedDispatcher = new Agent({connect: {rejectUnauthorized: false}});
    }
    return cachedDispatcher;
}

function buildHeaders(token: string): Record<string, string> {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
}

// ─── 自动登录 + token 缓存 ─────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Unix timestamp ms

export async function getSub2apiToken(
    baseUrl: string,
    email: string,
    password: string,
    timeoutMs = 15000,
): Promise<string> {
    const now = Date.now();
    // 还没过期（提前 5 分钟刷新）
    if (cachedToken && now < tokenExpiresAt - 5 * 60 * 1000) {
        return cachedToken;
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/auth/login`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        console.log(`[sub2api] 登录获取 token...`);
        const response = await undiciFetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({email, password}),
            signal: controller.signal,
            dispatcher: getSub2apiDispatcher(),
        } as any);
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`sub2api 登录失败: status=${response.status} body=${body.slice(0, 300)}`);
        }
        const data = (await response.json()) as Record<string, any>;
        const token = data?.data?.access_token || data?.access_token || "";
        const expiresIn = data?.data?.expires_in || data?.expires_in || 86400;
        if (!token) {
            throw new Error(`sub2api 登录未返回 token: ${JSON.stringify(data).slice(0, 300)}`);
        }
        cachedToken = token;
        tokenExpiresAt = now + expiresIn * 1000;
        console.log(`[sub2api] ✓ 登录成功，token 有效期 ${Math.round(expiresIn / 3600)}h`);
        return token;
    } finally {
        clearTimeout(timer);
    }
}

export interface Sub2apiAuthUrlResult {
    authUrl: string;
    sessionId: string;
}

export async function generateAuthUrl(
    baseUrl: string,
    adminToken: string,
    timeoutMs = 20000,
): Promise<Sub2apiAuthUrlResult> {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/admin/openai/generate-auth-url`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        console.log(`[sub2api] ① 获取授权 URL`);
        const response = await undiciFetch(url, {
            method: "POST",
            headers: buildHeaders(adminToken),
            signal: controller.signal,
            dispatcher: getSub2apiDispatcher(),
        } as any);
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`sub2api generate-auth-url 失败: status=${response.status} body=${body.slice(0, 300)}`);
        }
        const raw = (await response.json()) as Record<string, any>;
        // sub2api 响应格式: {"code":0,"message":"success","data":{...}}
        const data = raw.data || raw;
        const authUrl: string = data.auth_url || data.authUrl || data.url || "";
        if (!authUrl || !authUrl.startsWith("http")) {
            throw new Error(`sub2api generate-auth-url 未返回有效 URL: ${JSON.stringify(raw).slice(0, 300)}`);
        }
        const sessionId: string = data.session_id || data.sessionId || "";
        if (!sessionId) {
            throw new Error(`sub2api generate-auth-url 未返回 session_id: ${JSON.stringify(data).slice(0, 300)}`);
        }
        console.log(`[sub2api] ① ✓ 授权 URL 已获取`);
        return {authUrl, sessionId};
    } finally {
        clearTimeout(timer);
    }
}

export interface Sub2apiExchangeCodeResult {
    accessToken: string;
    refreshToken: string;
}

export async function exchangeCode(
    baseUrl: string,
    adminToken: string,
    sessionId: string,
    code: string,
    state: string,
    timeoutMs = 30000,
): Promise<Sub2apiExchangeCodeResult> {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/admin/openai/exchange-code`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        console.log(`[sub2api] ② 用 code 换 token`);
        const response = await undiciFetch(url, {
            method: "POST",
            headers: buildHeaders(adminToken),
            body: JSON.stringify({session_id: sessionId, code, state}),
            signal: controller.signal,
            dispatcher: getSub2apiDispatcher(),
        } as any);
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`sub2api exchange-code 失败: status=${response.status} body=${body.slice(0, 300)}`);
        }
        const raw = (await response.json()) as Record<string, any>;
        const data = raw.data || raw;
        const accessToken: string = data.access_token || data.accessToken || "";
        const refreshToken: string = data.refresh_token || data.refreshToken || "";
        if (!refreshToken) {
            throw new Error(`sub2api exchange-code 未返回 refresh_token: ${JSON.stringify(raw).slice(0, 300)}`);
        }
        console.log(`[sub2api] ② ✓ Token 已获取`);
        return {accessToken, refreshToken};
    } finally {
        clearTimeout(timer);
    }
}

export interface Sub2apiCreateAccountResult {
    success: boolean;
    status: number;
    body: string;
    accountId?: string;
}

export async function createFromOAuth(
    baseUrl: string,
    adminToken: string,
    refreshToken: string,
    groupIds?: number[],
    timeoutMs = 20000,
): Promise<Sub2apiCreateAccountResult> {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/admin/openai/create-from-oauth`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        console.log(`[sub2api] ③ 创建账户入库`);
        const bodyData: Record<string, any> = {refresh_token: refreshToken};
        if (groupIds && groupIds.length > 0) {
            bodyData.group_ids = groupIds;
        }
        const response = await undiciFetch(url, {
            method: "POST",
            headers: buildHeaders(adminToken),
            body: JSON.stringify(bodyData),
            signal: controller.signal,
            dispatcher: getSub2apiDispatcher(),
        } as any);
        const body = await response.text().catch(() => "");
        const status = response.status;
        if (status >= 300) {
            console.log(`[sub2api] ③ ✗ 入库失败 status=${status}`);
            return {success: false, status, body};
        }
        console.log(`[sub2api] ③ ✓ 入库成功 status=${status}`);
        try {
            const raw = JSON.parse(body) as Record<string, any>;
            const data = raw.data || raw;
            return {success: true, status, body, accountId: data.id || undefined};
        } catch {
            return {success: true, status, body};
        }
    } finally {
        clearTimeout(timer);
    }
}
