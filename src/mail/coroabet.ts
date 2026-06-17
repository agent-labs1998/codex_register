import {appConfig} from "../config.js";
import {generateEmailName} from "./generate-email-name.js";
import {findLatestVerificationMail} from "./verification-matcher.js";
import {proxyFetch} from "../proxy-fetch.js";

const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 3000;

function getWorkerDomain(): string {
    const domain = String(appConfig.coroabetWorkerDomain ?? "").trim();
    if (!domain) throw new Error("coroabetWorkerDomain 未配置");
    return domain;
}

function getEmailDomain(): string {
    const domain = String(appConfig.coroabetEmailDomain ?? "").trim();
    if (!domain) throw new Error("coroabetEmailDomain 未配置");
    return domain;
}

function getAdminPassword(): string {
    const password = String(appConfig.coroabetAdminPassword ?? "").trim();
    if (!password) throw new Error("coroabetAdminPassword 未配置");
    return password;
}

interface CreateAddressResponse {
    jwt: string;
    address: string;
    address_id: number;
}

interface ParsedMail {
    sender?: string;
    subject?: string;
    text?: string;
    html?: string;
    receivedAtMs?: number;
}

interface ParsedMailsResponse {
    results: ParsedMail[];
}

async function createAddress(): Promise<CreateAddressResponse> {
    const workerDomain = getWorkerDomain();
    const emailDomain = getEmailDomain();
    const adminPassword = getAdminPassword();
    const name = generateEmailName();

    const response = await proxyFetch(`https://${workerDomain}/admin/new_address`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-admin-auth": adminPassword,
        },
        body: JSON.stringify({
            enablePrefix: Boolean(appConfig.coroabetEnablePrefix),
            name,
            domain: emailDomain,
        }),
    });

    if (!response.ok) {
        throw new Error(`coroabet 创建邮箱失败: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as CreateAddressResponse;
    if (!data.jwt || !data.address) {
        throw new Error(`coroabet 创建邮箱返回异常: ${JSON.stringify(data)}`);
    }

    console.log(`coroabetEmailCreated: ${data.address}`);
    return data;
}

async function fetchMailsViaAdmin(address: string): Promise<ParsedMail[]> {
    const workerDomain = getWorkerDomain();
    const adminPassword = getAdminPassword();

    const url = new URL(`https://${workerDomain}/admin/mails`);
    url.searchParams.set("limit", "10");
    url.searchParams.set("offset", "0");
    url.searchParams.set("address", address);

    const response = await proxyFetch(url.toString(), {
        method: "GET",
        headers: {
            "x-admin-auth": adminPassword,
        },
    });

    if (!response.ok) {
        throw new Error(`coroabet admin 读取邮件失败: ${response.status} ${await response.text()}`);
    }

    const data = await response.json() as any;
    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map((m: any) => {
        const raw: string = m.raw ?? "";
        const source: string = m.source ?? "";
        // 从 RFC822 raw 里提取 subject
        const subjectMatch = raw.match(/^Subject:\s*(.+)$/mi);
        const subject = subjectMatch ? subjectMatch[1].trim() : "";
        // raw body（空行之后）
        const bodyStart = raw.indexOf("\r\n\r\n");
        const body = bodyStart >= 0 ? raw.slice(bodyStart + 4) : raw;
        return {
            sender: source,
            subject,
            text: body,
            html: body,
            receivedAtMs: 0,
        };
    });
}

export function createCoroabetProvider() {
    return {
        async getEmailAddress(): Promise<string> {
            const {address} = await createAddress();
            return address;
        },

        async getEmailVerificationCode(email: string, options?: {minTimestampMs?: number}): Promise<string> {
            for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
                console.log(`coroabetPollOtp: attempt=${attempt}/${POLL_ATTEMPTS} targetEmail=${email}`);

                const mails = await fetchMailsViaAdmin(email);
                if (attempt <= 2 && mails.length > 0) {
                    console.log(`coroabetDebug: got ${mails.length} mails, first sender=${mails[0]?.sender} subject=${(mails[0]?.subject ?? "").slice(0, 60)} textLen=${(mails[0]?.text ?? "").length}`);
                }
                const candidates = mails.map((m, i) => ({
                    id: String(i),
                    sender: m.sender ?? "",
                    subject: m.subject ?? "",
                    content: m.text ?? "",
                    timestamp: m.receivedAtMs || Date.now(),
                    extraTexts: [m.html ?? ""],
                }));

                const matched = findLatestVerificationMail(candidates, {
                    targetEmail: email,
                    candidateMatcher: (mail) =>
                        /(OpenAI|ChatGPT)/i.test(`${mail.subject ?? ""}\n${mail.content ?? ""}\n${mail.sender ?? ""}`),
                });

                if (matched?.verificationCode) {
                    console.log(`coroabetOtpCode: ${matched.verificationCode}`);
                    return matched.verificationCode;
                }

                if (attempt < POLL_ATTEMPTS) {
                    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                }
            }

            throw new Error(`coroabet 邮箱中未找到验证码: targetEmail=${email}`);
        },
    };
}
