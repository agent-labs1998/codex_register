import {appConfig} from "./config.js";
import {generateRandomDeviceProfile} from "./device-profile.js";
import {MAILBOX_CONFIG} from "./mailbox.js";
import {OpenAIClient} from "./openai.js";
import {createSMSBroker} from "./sms/index.js";
import {startHeroSmsPatrolLoop} from "./sms/hero-patrol.js";
import {LocalDB} from "./local-db.js";
import {WorkerScheduler} from "./worker-scheduler.js";
import {runConcurrentRegistration} from "./concurrent-registration.js";
import {proxyFetch} from "./proxy-fetch.js";
import {getIpInfo, resetIpCache} from "./ip-detect.js";

async function cancelHeroSmsActivationById(activationId: string): Promise<void> {
    const apiKey = String(appConfig.heroSMSApiKey ?? "").trim();
    if (!apiKey || !activationId) {
        return;
    }
    const url = `https://hero-sms.com/stubs/handler_api.php?api_key=${encodeURIComponent(apiKey)}&action=setStatus&id=${encodeURIComponent(activationId)}&status=8`;
    try {
        const res = await proxyFetch(url, {method: "GET"});
        const body = await res.text();
        const upper = body.toUpperCase();
        if (upper.includes("ACCESS_CANCEL") || upper.includes("ACCESS_READY") || upper.includes("BAD_STATUS") || upper.includes("NO_ACTIVATION")) {
            console.log(`[巡视释放] cancel activationId=${activationId} response=${body.slice(0, 120)}`);
            return;
        }
        console.warn(`[巡视释放] cancel activationId=${activationId} unexpected=${body.slice(0, 200)}`);
    } catch (error) {
        console.warn(`[巡视释放] cancel activationId=${activationId} failed=${(error as Error).message}`);
    }
}

function readArgValue(flag: string): string {
    const index = process.argv.indexOf(flag);
    if (index === -1) {
        return "";
    }
    return process.argv[index + 1] ?? "";
}

function hasFlag(flag: string): boolean {
    return process.argv.includes(flag);
}

function readNumberArg(flag: string): number | null {
    const raw = readArgValue(flag).trim();
    if (!raw) {
        return null;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : null;
}


const smsBroker = appConfig.heroSMSApiKey ? createSMSBroker({
    apiKey: appConfig.heroSMSApiKey,
    pollAttempts: appConfig.heroSMSPollAttempts,
    pollIntervalMs: appConfig.heroSMSPollIntervalMs,
    maxPrice: appConfig.heroSMSMaxPrice,
    country: appConfig.heroSMSCountry,
    countries: appConfig.heroSMSCountries,
    priceTiers: appConfig.heroSMSPriceTiers,
    proxyUrl: appConfig.heroSMSProxy || "",
}) : undefined

async function runOnce(db?: LocalDB): Promise<void> {
    const email = readArgValue("--email").trim();
    const manualOtp = hasFlag("--otp");
    const directSignupAuth = hasFlag("--sign");
    const saveAccessToken = hasFlag("--at");
    const phoneFirst = hasFlag("--phone");
    const codexCpa = hasFlag("--codex-cpa");
    const gpTokenOutPath = readArgValue("--gp-token-out").trim();
    const deviceProfile = generateRandomDeviceProfile();

    // ─── 模式 -1: --codex-cpa --phone +xxx (codex CLI OAuth → CPA 入库) ───
    // 用 CPA 持有的 PKCE 完成 OAuth：
    //   1) GET CPA /v0/management/codex-auth-url 拿 authorize URL
    //   2) 走 OAuth 登录（password verify + add-email）
    //   3) 拿到 localhost:1455/auth/callback?code=...
    //   4) POST CPA /v0/management/oauth-callback 由 CPA 完成 token 交换并入库
    if (codexCpa) {
        const phoneArg = readArgValue("--phone").trim();
        const password = readArgValue("--password").trim() || appConfig.defaultPassword;
        const cpaBase = readArgValue("--cpa-base").trim() || process.env.CPA_BASE_URL?.trim() || appConfig.cpa.baseUrl || "https://YOUR_CPA_URL";
        const cpaKey = readArgValue("--cpa-key").trim() || process.env.CPA_MANAGEMENT_KEY?.trim() || appConfig.cpa.managementKey || "";
        if (!cpaKey) {
            throw new Error("--codex-cpa 需要 --cpa-key 或 CPA_MANAGEMENT_KEY 环境变量");
        }

        // add-email 候选邮箱（使用配置的邮箱 provider）
        let bindEmail = readArgValue("--bind-email").trim();
        let fetchAddEmailOtp: (() => Promise<string>) | undefined = undefined;
        let mailboxPrepError = "";

        // 如果没传 phone，就自动 phone signup（hero-sms 取号注册新账号）
        let phone = "";
        let chatgptAccessToken = "";
        let signupClientRef: OpenAIClient | null = null;
        if (phoneArg) {
            phone = phoneArg.startsWith("+") ? phoneArg : `+${phoneArg}`;
            console.log(`[codex-cpa] 复用已注册号 ${phone}`);
            try {
                const mailbox = await import("./mailbox.js");
                if (!bindEmail) {
                    bindEmail = await mailbox.getEmailAddress();
                }
                console.log(`[codex-cpa] add-email 候选: ${bindEmail}`);
                fetchAddEmailOtp = async () => {
                    const startedAt = Date.now();
                    console.log(`[codex-cpa] 等待邮件 OTP for ${bindEmail} (after=${new Date(startedAt).toISOString()})...`);
                    return await mailbox.getEmailVerificationCode(bindEmail, {minTimestampMs: startedAt});
                };
            } catch (e) {
                mailboxPrepError = (e as Error).message;
                console.warn(`[codex-cpa] 邮箱准备失败: ${mailboxPrepError}`);
            }
        } else {
            if (!smsBroker) {
                throw new Error("--codex-cpa 不传 --phone 时需要配置 heroSMSApiKey 自动 phone signup");
            }
            console.log(`[codex-cpa] [0] 未传 --phone，自动 phone signup 注册新号`);

            // 显示当前使用的 IP（通过代理检测出口 IP）
            let ipInfo: any = null;
            try {
                resetIpCache();
                ipInfo = await getIpInfo();
                const residentialTag = ipInfo.isResidential ? "🏠 住宅" : "🏢 数据中心";
                const proxyTag = ipInfo.isProxy ? "🔒 代理" : "";
                const mobileTag = ipInfo.isMobile ? "📱 移动" : "";
                console.log(`[IP] ${ipInfo.ip} | ${ipInfo.country} ${ipInfo.city} | ${ipInfo.isp} | ${residentialTag} ${proxyTag} ${mobileTag}`);
            } catch (error) {
                console.warn(`[IP] 检测失败: ${(error as Error).message}`);
            }

            const MAX_PHONE_TRIES = 8;
            let lastErr: unknown = null;
            for (let phoneTry = 1; phoneTry <= MAX_PHONE_TRIES; phoneTry += 1) {
                // 每次 retry 都完全重建 worker、邮箱、设备指纹
                bindEmail = readArgValue("--bind-email").trim();
                fetchAddEmailOtp = undefined;
                mailboxPrepError = "";
                try {
                    // 优先使用 hotmailProvider 从数据库获取邮箱（支持去重）
                    if (!bindEmail && db) {
                        const {createHotmailProvider} = await import("./mail/hotmail.js");
                        const hotmailProvider = createHotmailProvider(db);
                        try {
                            bindEmail = await hotmailProvider.getEmailAddress();
                            console.log(`[codex-cpa] (${phoneTry}/${MAX_PHONE_TRIES}) 从数据库获取邮箱: ${bindEmail}`);
                            fetchAddEmailOtp = async () => {
                                const startedAt = Date.now();
                                console.log(`[codex-cpa] 等待邮件 OTP for ${bindEmail} (after=${new Date(startedAt).toISOString()})...`);
                                return await hotmailProvider.getEmailVerificationCode(bindEmail, {minTimestampMs: startedAt});
                            };
                        } catch (hotmailErr) {
                            const errMsg = (hotmailErr as Error).message;
                            // 如果是邮箱池用完的错误，结束任务
                            if (errMsg.includes("Hotmail 邮箱池已用完")) {
                                console.error(`[codex-cpa] ❌ ${errMsg}`);
                                console.error(`[codex-cpa] 任务结束：没有可用的邮箱，请补充新账号后重试`);
                                const stats = db.getHotmailAccountStats();
                                console.log(`[codex-cpa] 当前邮箱池状态: 全新=${stats.unused} 可重试=${stats.retryable} 已用=${stats.used} 失败=${stats.failed}`);
                                throw new Error(errMsg);  // 抛出错误，结束整个 runOnce
                            }
                            // 其他错误，回退到原有逻辑
                            console.warn(`[codex-cpa] (${phoneTry}/${MAX_PHONE_TRIES}) hotmailProvider 获取邮箱失败，回退到 mailbox: ${errMsg}`);
                        }
                    }

                    // 如果 hotmailProvider 没有获取到邮箱，使用原有逻辑
                    if (!bindEmail) {
                        const mailbox = await import("./mailbox.js");
                        bindEmail = await mailbox.getEmailAddress();
                    }
                    console.log(`[codex-cpa] (${phoneTry}/${MAX_PHONE_TRIES}) 新 worker 邮箱: ${bindEmail}`);
                    if (!fetchAddEmailOtp) {
                        fetchAddEmailOtp = async () => {
                            const startedAt = Date.now();
                            console.log(`[codex-cpa] 等待邮件 OTP for ${bindEmail} (after=${new Date(startedAt).toISOString()})...`);
                            const mailbox = await import("./mailbox.js");
                            return await mailbox.getEmailVerificationCode(bindEmail, {minTimestampMs: startedAt});
                        };
                    }
                } catch (e) {
                    // 如果是邮箱池用完的错误，直接抛出，结束任务
                    if ((e as Error).message.includes("Hotmail 邮箱池已用完")) {
                        throw e;
                    }
                    mailboxPrepError = (e as Error).message;
                    console.warn(`[codex-cpa] (${phoneTry}/${MAX_PHONE_TRIES}) 邮箱准备失败: ${mailboxPrepError}`);
                }

                const signupClient = new OpenAIClient({
                    email: undefined,
                    password,
                    deviceProfile: generateRandomDeviceProfile(),
                    manualMode: manualOtp,
                    smsBroker,
                });
                console.log(`\n[codex-cpa] (${phoneTry}/${MAX_PHONE_TRIES}) hero 取号...`);
                const lease = await smsBroker.getActivation();
                const phoneNumber = `+${lease.phoneNumber}`;
                console.log(`[codex-cpa] 取到 ${phoneNumber}`);
                try {
                    const sigRes = await signupClient.authPhoneSignupHTTP(phoneNumber, async () => {
                        console.log(`[codex-cpa] 等待 OTP (巡视释放模式: 120s deadline)...`);
                        const SMS_RELEASE_DEADLINE_MS = 120_000;
                        const code = await Promise.race([
                            lease.waitForVerificationCode().then((v) => v.code),
                            new Promise<never>((_, reject) => {
                                setTimeout(async () => {
                                    await cancelHeroSmsActivationById(String(lease.activationId ?? ""));
                                    reject(new Error(`SMS_RELEASE_DEADLINE: ${SMS_RELEASE_DEADLINE_MS}ms 内未收到验证码，立即释放号码`));
                                }, SMS_RELEASE_DEADLINE_MS);
                            }),
                        ]);
                        console.log(`[codex-cpa] 收到 OTP: ${code}`);
                        return code;
                    });
                    phone = phoneNumber;
                    signupClientRef = signupClient;
                    console.log(`[codex-cpa] [✅️phone signup 成功] ${phone}`);
                    // 试用探测移到 OAuth 完成后做（用 CPA 入库后的 access_token）
                    void sigRes; // 暂不消费 callbackURL
                    break;
                } catch (e) {
                    lastErr = e;
                    console.warn(`[codex-cpa] (${phoneTry}/${MAX_PHONE_TRIES}) 失败: ${(e as Error).message} -> 重建 worker 重新注册`);
                    try { await smsBroker.markAsFailed(true); } catch (_) { /* ignore */ }
                    continue;
                }
            }
            if (!phone) {
                throw lastErr ?? new Error("phone signup 多次换号均失败");
            }
        }

        // 前置校验：OAuth 很可能跳到 /add-email（phone-only 账号必然触发）。
        // 此时需要 bindEmail + fetchAddEmailOtp，否则会在 5 步之后才以
        // "OAuth 跳到 /add-email 但未提供 bindEmail" 报错，掩盖真实原因。
        // 这里直接 fail-fast，给出可操作的提示。
        if (!bindEmail) {
            throw new Error(
                `缺少 add-email 绑定邮箱：请用 --bind-email 指定，或检查邮箱 provider 配置。` +
                (mailboxPrepError ? ` 邮箱准备失败原因: ${mailboxPrepError}` : ``)
            );
        }
        if (!fetchAddEmailOtp) {
            throw new Error(
                `已有 bindEmail=${bindEmail} 但无法接收 add-email OTP：邮箱 provider 初始化失败` +
                (mailboxPrepError ? `（${mailboxPrepError}）` : ``) +
                `。请检查邮箱配置。`
            );
        }

        // 根据 tokenBackend 选择后端
        const useSub2api = appConfig.tokenBackend === "sub2api" && appConfig.sub2api.baseUrl && appConfig.sub2api.email;

        let authorizeUrl: string;
        let sub2apiSessionId: string | undefined;
        let sub2apiToken: string | undefined;

        if (useSub2api) {
            // ─── sub2api 路径 ───
            const { getSub2apiToken: sub2apiLogin, generateAuthUrl: sub2apiGenerateAuthUrl } = await import("./sub2api.js");

            sub2apiToken = await sub2apiLogin(appConfig.sub2api.baseUrl, appConfig.sub2api.email, appConfig.sub2api.password);
            console.log(`[codex-cpa] [1] sub2api generate-auth-url`);
            const result = await sub2apiGenerateAuthUrl(appConfig.sub2api.baseUrl, sub2apiToken);
            authorizeUrl = result.authUrl;
            sub2apiSessionId = result.sessionId;
            console.log(`[codex-cpa]     authorize: ${authorizeUrl.slice(0, 120)}...`);
        } else {
            // ─── CPA 路径（原有逻辑）───
            const {requestCodexAuthUrl} = await import("./cpa-codex.js");

            console.log(`[codex-cpa] [1] CPA codex-auth-url`);
            const result = await requestCodexAuthUrl(cpaBase, cpaKey);
            authorizeUrl = result.authorizeUrl;
            console.log(`[codex-cpa]     authorize: ${authorizeUrl.slice(0, 120)}...`);
        }

        const client = new OpenAIClient({
            email: phone,
            password,
            deviceProfile: generateRandomDeviceProfile(),
            manualMode: manualOtp,
            smsBroker,
            bindEmail,
            fetchAddEmailOtp,
        });

        console.log(`[codex-cpa] [2] 走 OAuth 登录 phone=${phone}`);
        let callbackUrl: string;
        try {
            callbackUrl = await client.authLoginViaCpaAuthorizeURL(authorizeUrl);
        } catch (e) {
            const msg = (e as Error)?.message || String(e);
            // 邮箱已被占用 = 该 hotmail 卡密已永久绑死另一个 ChatGPT 账号(race condition 残留),
            // 立即从池里消费掉,避免下次再被随机选到
            if (msg.includes("email_already_in_use") && bindEmail) {
                console.warn(`[codex-cpa] [⚠️] hotmail 卡密 ${bindEmail} 已绑死另一账号,立即消费`);
                try {
                    const {consumeHotmailLine} = await import("./consume-hotmail.js");
                    const cr = consumeHotmailLine(bindEmail);
                    console.log(`[codex-cpa] [hotmail 卡密消费] ${cr.reason}`);
                } catch (consumeErr) {
                    console.warn(`[codex-cpa] [hotmail 卡密消费失败] ${(consumeErr as Error).message}`);
                }
            }
            throw e;
        }
        console.log(`[codex-cpa]     callback: ${callbackUrl.slice(0, 120)}...`);

        if (useSub2api) {
            // ─── sub2api 路径：exchangeCode + createFromOAuth ───
            const { exchangeCode: sub2apiExchangeCode, createFromOAuth: sub2apiCreateFromOAuth } = await import("./sub2api.js");

            console.log(`[codex-cpa] [3] sub2api exchange-code + create-from-oauth`);

            // 从 callback URL 提取 code 和 state
            const callbackUrlObj = new URL(callbackUrl);
            const code = callbackUrlObj.searchParams.get("code") || "";
            const state = callbackUrlObj.searchParams.get("state") || "";

            if (!code) {
                throw new Error(`callback URL 中没有 code 参数: ${callbackUrl.slice(0, 200)}`);
            }

            // 步骤 8: 用 code 换 token
            const exchangeResult = await sub2apiExchangeCode(
                appConfig.sub2api.baseUrl,
                sub2apiToken!,
                sub2apiSessionId!,
                code,
                state,
            );

            // 步骤 9: 创建账户入库
            const createResult = await sub2apiCreateFromOAuth(
                appConfig.sub2api.baseUrl,
                sub2apiToken!,
                sub2apiSessionId!,
                code,
                state,
                appConfig.sub2api.groupIds,
            );

            if (!createResult.success) {
                throw new Error(`sub2api create-from-oauth 失败: status=${createResult.status} body=${createResult.body.slice(0, 300)}`);
            }

            chatgptAccessToken = exchangeResult.accessToken;
            console.log(`[codex-cpa] [✅️] 从 sub2api 拿到 access_token (${chatgptAccessToken.length} 字符, 账户ID=${createResult.accountId || "unknown"})`);
        } else {
            // ─── CPA 路径（原有逻辑）───
            const {submitOAuthCallback, listAuthFiles, downloadAuthFile} = await import("./cpa-codex.js");

            console.log(`[codex-cpa] [3] 提交 callback 给 CPA`);
            const {status, body} = await submitOAuthCallback(cpaBase, cpaKey, callbackUrl);
            console.log(`[codex-cpa]     CPA status=${status}`);
            console.log(`[codex-cpa]     CPA body: ${body.slice(0, 500)}`);
            if (status >= 300) {
                throw new Error(`CPA oauth-callback 失败 status=${status}`);
            }

            // 如果之前还没拿到 ChatGPT accessToken，从 CPA 拉刚入库的 codex auth.json 取 access_token
            if (!chatgptAccessToken) {
                try {
                    console.log(`[codex-cpa] 从 CPA 拉刚入库的 codex auth 文件...`);
                    if (!bindEmail) {
                        throw new Error("没有 bindEmail，无法精确定位 codex auth 文件（拒绝并发场景下的兜底匹配）");
                    }
                    const emailLc = bindEmail.toLowerCase();
                    // CPA 实际命名有两种：codex-<email>.json 与 codex-<email>-plus.json（plus 套餐）
                    // 两者都精确匹配本 email，绝不退化到"最新文件"（避免并发拿到别 worker 的 token）
                    const candidates = [
                        `codex-${emailLc}.json`,
                        `codex-${emailLc}-plus.json`,
                    ];
                    const matchFile = (files: any[]) => {
                        // 优先无后缀，其次 -plus
                        for (const want of candidates) {
                            const hit = files.find(f => String(f.name || "").toLowerCase() === want);
                            if (hit) return hit;
                        }
                        return null;
                    };
                    // CPA 落库可能有延迟（callback 返回 ok 后服务端异步写文件），放宽到 ~36s
                    const POLL_MAX_ATTEMPTS = 12;
                    const POLL_INTERVAL_MS = 3000;
                    let latest: any = null;
                    let lastFileCount = -1;
                    for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt += 1) {
                        const files = await listAuthFiles(cpaBase, cpaKey);
                        lastFileCount = files.length;
                        latest = matchFile(files);
                        if (latest) {
                            console.log(`[codex-cpa]     精确匹配文件: ${latest.name} (attempt=${attempt}, 库内共 ${files.length} 文件)`);
                            break;
                        }
                        if (attempt < POLL_MAX_ATTEMPTS) {
                            console.log(`[codex-cpa]     还没看到 codex-${emailLc}(.json|-plus.json) (attempt=${attempt}/${POLL_MAX_ATTEMPTS}, 库内共 ${files.length} 文件)，${POLL_INTERVAL_MS}ms 后重试`);
                            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                        }
                    }
                    if (!latest) {
                        throw new Error(
                            `等了 ${POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS}ms 仍找不到 codex-${emailLc}(.json|-plus.json)`
                            + `（CPA 库内共 ${lastFileCount} 文件）—— callback 返回 ok 但未落库，疑似 CPA 端入库失败/延迟。`
                            + `拒绝兜底，避免拿到别 worker 的 token`
                        );
                    }
                    const auth = await downloadAuthFile(cpaBase, cpaKey, latest.name);
                    const tok = String(auth?.access_token || "").trim();
                    if (!tok) {
                        throw new Error(`auth 文件里没 access_token: ${JSON.stringify(auth).slice(0, 200)}`);
                    }
                    chatgptAccessToken = tok;
                    console.log(`[codex-cpa] [✅️] 从 CPA 拿到 access_token (${tok.length} 字符, 文件=${latest.name})`);
                } catch (e) {
                    console.warn(`[codex-cpa] 从 CPA 取 access_token 失败: ${(e as Error).message}`);
                }
            }
        }

        // 把 ChatGPT accessToken 写到指定的 token 文件
        if (chatgptAccessToken) {
            // ─── 试用探测（在写 token / 消费 hotmail 卡密 之前）───
            // 用 JP 代理打 chatgpt checkout + stripe init 看 amount_due。
            // 无试用 → exit 2：CPA 入库无法回滚（已发生），但不写 token、不消费 hotmail。
            // hotmail 卡密留着下次还能用（refresh_token 已被 hotmail provider 自动续）。
            const probeJP = readArgValue("--probe-trial-jp").trim() || process.env.PROBE_TRIAL_JP_PROXY?.trim() || appConfig.probeTrialProxyJp || "";
            if (probeJP) {
                try {
                    const {probeTrial} = await import("./probe-trial.js");
                    console.log(`[codex-cpa] [试用探测] 用 JP 代理打 chatgpt checkout + stripe init`);
                    const probeRes = await probeTrial({
                        accessToken: chatgptAccessToken,
                        proxyJP: probeJP,
                    });
                    if (probeRes.hasTrial) {
                        console.log(`[codex-cpa] [✅️有试用] ${probeRes.reason}`);
                    } else {
                        console.warn(`[codex-cpa] [❌️无试用] ${probeRes.reason}`);
                        console.warn(`[codex-cpa] 不写 token 文件，立即退出（CPA 入库已发生但不可回滚；hotmail 卡密已绑该账号必须消费）`);
                        // hotmail 已经绑给这个 ChatGPT 账号 = 卡密已脏，必须消费再退出
                        if (bindEmail) {
                            try {
                                const {consumeHotmailLine} = await import("./consume-hotmail.js");
                                const cr = consumeHotmailLine(bindEmail);
                                if (cr.ok) {
                                    console.log(`[codex-cpa] [hotmail 卡密消费] ${cr.reason}`);
                                } else {
                                    console.warn(`[codex-cpa] [hotmail 卡密消费跳过] ${cr.reason}`);
                                }
                            } catch (e) {
                                console.warn(`[codex-cpa] [hotmail 卡密消费失败，忽略] ${(e as Error).message}`);
                            }
                        }
                        console.log(`[POOL-RESULT] status=no_trial phone=${phone || ""} email=${bindEmail || ""}`);
                        process.exit(2);
                    }
                } catch (probeErr) {
                    console.warn(`[codex-cpa] [试用探测失败，继续主流程] ${(probeErr as Error).message}`);
                }
            } else {
                console.log(`[codex-cpa] [跳过试用探测] 未配置 --probe-trial-jp / PROBE_TRIAL_JP_PROXY`);
            }

            const gpTokenFile = gpTokenOutPath || readArgValue("--token-out").trim();
            if (!gpTokenFile) {
                console.warn(`[codex-cpa] 未指定 --token-out / --gp-token-out，跳过写 token 文件`);
            } else {
                try {
                    const {appendFile, mkdir, readFile, writeFile} = await import("node:fs/promises");
                    const {dirname} = await import("node:path");
                    await mkdir(dirname(gpTokenFile), {recursive: true});
                    // 追加模式：每个 token 一行
                    let existing = "";
                    try {
                        existing = await readFile(gpTokenFile, "utf8");
                    } catch {
                        // 文件不存在
                    }
                    // 去重：如果该 token 已在文件里就不重复写
                    if (existing.includes(chatgptAccessToken)) {
                        console.log(`[codex-cpa] [⏭️] token 已在 ${gpTokenFile} 里，跳过写入`);
                    } else {
                        // 保证文件以换行结尾再 append
                        const needNewline = existing.length > 0 && !existing.endsWith("\n");
                        if (needNewline) {
                            await writeFile(gpTokenFile, existing + "\n", "utf8");
                        }
                        await appendFile(gpTokenFile, chatgptAccessToken + "\n", "utf8");
                        console.log(`[codex-cpa] [✅️] 追加 token 到: ${gpTokenFile}`);
                    }
                } catch (e) {
                    console.warn(`[codex-cpa] 写 token 文件失败: ${(e as Error).message}`);
                }
            }
        } else {
            console.warn(`[codex-cpa] ⚠️ 没拿到 ChatGPT accessToken，GP Plus 订阅会失败`);
            // 让外层 batch_runner 立刻把这单标失败，避免下游 full_auto_stable 拿到空 token
            // 又写一份 stable_account 占用 CDK 池
            process.exit(1);
        }

        console.log(`\n[✅️codex-cpa 成功] phone=${phone} email=${bindEmail || "(none)"} 已入 CPA token 池`);
        console.log(`[POOL-RESULT] status=ok phone=${phone} email=${bindEmail || ""}`);

        // 写入本地数据库
        try {
            const dbPath = "data/codex-register.sqlite";
            const db = new LocalDB(dbPath);

            // 创建或获取单次运行的 workflow_run
            const runId = db.createWorkflowRun("codex-cpa-single", {
                mode: "single",
                phone,
                email: bindEmail,
            });

            // 写入 accounts 表
            db.saveAccount({
                phone: phone,
                email: bindEmail || "",
                password: password,
                access_token: chatgptAccessToken,
                ip_address: ipInfo?.ip || "unknown",
                ip_country: ipInfo?.country || "unknown",
                ip_city: ipInfo?.city || "unknown",
                ip_isp: ipInfo?.isp || "unknown",
                ip_is_residential: ipInfo?.isResidential ? 1 : 0,
                token_backend: useSub2api ? "sub2api" : "cpa",
                status: "active",
            });

            console.log(`[codex-cpa] [✅️] 已写入本地数据库 (phone=${phone}, email=${bindEmail})`);
        } catch (dbError) {
            console.warn(`[codex-cpa] [⚠️] 写入数据库失败: ${(dbError as Error).message}`);
        }

        // 注册成功 → 把用过的 hotmail 卡密从池文件移除，append 到 history
        if (bindEmail) {
            try {
                // 等 hotmail provider 的 IMAP refresh-token 持久化先跑完，避免 race condition
                // （IMAP 收 OTP 时可能触发 refresh，然后 persistTextAccount 写回老内容覆盖我们的删除）
                await new Promise(r => setTimeout(r, 1500));
                const {consumeHotmailLine} = await import("./consume-hotmail.js");
                const cr = consumeHotmailLine(bindEmail);
                if (cr.ok) {
                    console.log(`[codex-cpa] [hotmail 卡密消费] ${cr.reason}`);
                } else {
                    console.warn(`[codex-cpa] [hotmail 卡密消费跳过] ${cr.reason}`);
                }
            } catch (e) {
                console.warn(`[codex-cpa] [hotmail 卡密消费失败，忽略] ${(e as Error).message}`);
            }
        }

        // 启动 GP Plus 订阅链路（稳定号方案：full_auto_stable.py）
        // 默认假设项目结构是 <PROJECT_ROOT>/codex_register/ 和 <PROJECT_ROOT>/plus_subscriber/
        // 可通过 --gp-script + --gp-cwd 覆盖
        if (chatgptAccessToken && hasFlag("--gp-plus")) {
            console.log(`\n========== 启动 GP Plus 订阅（稳定号方案）==========`);
            const {spawn} = await import("node:child_process");
            const {basename, dirname, resolve: resolvePath} = await import("node:path");
            const cwd = process.cwd();
            const projectRoot = basename(cwd) === "codex_register" && basename(dirname(cwd)) === "codexrigester"
                ? resolvePath(cwd, "..", "..")
                : resolvePath(cwd, "..");
            const gpScript = readArgValue("--gp-script").trim()
                || resolvePath(projectRoot, "plus_subscriber", "full_auto_stable.py");
            const gpCwd = readArgValue("--gp-cwd").trim()
                || resolvePath(projectRoot, "plus_subscriber");
            const gpTokenArg = readArgValue("--token-out").trim() || gpTokenOutPath || "token.txt";
            const child = spawn("python", ["-u", gpScript, "--token-file", gpTokenArg], {
                cwd: gpCwd,
                stdio: "inherit",
                shell: false,
            });
            await new Promise<void>((resolve) => {
                child.on("exit", (code) => {
                    console.log(`[gp-plus] python 退出 code=${code}`);
                    resolve();
                });
                child.on("error", (e) => {
                    console.error(`[gp-plus] 启动失败: ${e.message}`);
                    resolve();
                });
            });
        }
        return;
    }

    // ─── 模式 0: --phone (phone-first signup, 走 chatgpt.com web 入口) ───
    // 不需要邮箱，直接用 hero-sms 取号注册 → 拿 ChatGPT plan accessToken
    if (phoneFirst) {
        if (!smsBroker) {
            throw new Error("使用 --phone 需要配置 heroSMSApiKey");
        }
        const callbackOutPath = readArgValue("--callback-out").trim();
        const client = new OpenAIClient({
            email: undefined,
            password: appConfig.defaultPassword,
            deviceProfile,
            manualMode: manualOtp,
            smsBroker,
        });

        let result: {callbackURL: string} | null = null;
        let registeredPhone = "";

        // 复用已注册号：--phone-existing +57xxx 跳过 signup 步骤
        const existingPhone = readArgValue("--phone-existing").trim();
        if (existingPhone) {
            registeredPhone = existingPhone.startsWith("+") ? existingPhone : `+${existingPhone}`;
            console.log(`[phone-signup] 复用已注册号 ${registeredPhone}，跳过 signup 步骤直接登录`);
            result = {callbackURL: ""};
        } else {
            // 从 hero-sms 取号 (用阶梯 priceTiers, service=dr)，最多换号 8 次
            const MAX_PHONE_TRIES = 8;
            let lastErr: unknown = null;

            for (let phoneTry = 1; phoneTry <= MAX_PHONE_TRIES; phoneTry += 1) {
                console.log(`\n[phone-signup] (${phoneTry}/${MAX_PHONE_TRIES}) 取号...`);
                const lease = await smsBroker.getActivation();
                const phoneNumber = `+${lease.phoneNumber}`;
                console.log(`[phone-signup] 取到号码 ${phoneNumber}`);

                try {
                    result = await client.authPhoneSignupHTTP(phoneNumber, async () => {
                        console.log(`[phone-signup] 等待 OTP (45s 超时换号)...`);
                        const {code} = await lease.waitForVerificationCode();
                        console.log(`[phone-signup] 收到 OTP: ${code}`);
                        return code;
                    });
                    if (result) {
                        registeredPhone = phoneNumber;
                        break;
                    }
                } catch (e) {
                    lastErr = e;
                    const msg = (e as Error)?.message ?? String(e);
                    console.warn(`[phone-signup] (${phoneTry}/${MAX_PHONE_TRIES}) 失败: ${msg}`);
                    try { await smsBroker.markAsFailed(true); } catch (_) { /* ignore */ }
                    continue;
                }
            }
            if (!result || !registeredPhone) {
                throw lastErr ?? new Error("phone-signup 多次换号均失败");
            }
        }

        console.log(`[✅️phone 注册成功] callbackURL=${result.callbackURL.slice(0, 80)}...`);

        // 如果指定了 --callback-out，把完整 callback URL 输出到文件，
        // 由 Python 端用 curl_cffi 完成回调拿 ChatGPT plan token（绕过 Cloudflare）
        if (callbackOutPath && result.callbackURL) {
            const {writeFile} = await import("node:fs/promises");
            const phoneInfo = registeredPhone || existingPhone || "";
            const payload = {
                callback_url: result.callbackURL,
                phone: phoneInfo,
                password: appConfig.defaultPassword,
                ts: Date.now(),
            };
            await writeFile(callbackOutPath, JSON.stringify(payload, null, 2), "utf8");
            console.log(`[callback_out] 已写入 ${callbackOutPath}`);
            console.log(`[提示] 现在用 Python 端的 finish_chatgpt_callback.py 完成 callback 拿 token`);
            return;
        }

        // 注意：result.callbackURL 是 chatgpt.com/api/auth/callback/openai 这个 URL
        // 直接 fetch 它会被 Cloudflare 403（codex-register 的 undici TLS 指纹被识别）。
        // 改走 ChatGPT web 登录流程：bootChatGPTSession → openSignupPage → password →
        // finishChatGPTRegistration(callback) → getChatGPTAccessToken()
        // 这样能在 chatgpt.com 建立完整的 session cookies。
        console.log(`[phone-signup] 切换到 ChatGPT web 登录拿 accessToken...`);

        // 如果触发 add-email，用 hotmail 卡密的邮箱绑定 + IMAP 接 OTP
        let bindEmail = "";
        let fetchAddEmailOtp: (() => Promise<string>) | undefined = undefined;

        // 初始化数据库用于 Hotmail 邮箱去重
        let hotmailDb: LocalDB | undefined;
        try {
          const dbPath = "data/codex-register.sqlite";
          hotmailDb = new LocalDB(dbPath);
          // 导入 Hotmail 邮箱到数据库（如果尚未导入）
          const {readFileSync, existsSync} = await import("node:fs");
          const hotmailTokensPath = "hotmail/tokens.txt";
          if (existsSync(hotmailTokensPath)) {
            const tokensContent = readFileSync(hotmailTokensPath, "utf8");
            const accounts = tokensContent
              .split(/\r?\n/)
              .filter(line => line.trim())
              .map(line => {
                const [email, password, client_id, refresh_token] = line.split("----");
                return {email, password, client_id, refresh_token};
              })
              .filter(a => a.email && a.password);
            const imported = hotmailDb.importHotmailAccounts(accounts);
            if (imported > 0) {
              console.log(`[phone-signup] 导入 ${imported} 个新 Hotmail 邮箱到数据库`);
            }
          }
        } catch (dbErr) {
          console.warn(`[phone-signup] 初始化数据库失败（邮箱去重不可用）: ${(dbErr as Error).message}`);
        }

        try {
            const {createHotmailProvider} = await import("./mail/hotmail.js");
            const hotmailProvider = createHotmailProvider(hotmailDb);
            bindEmail = await hotmailProvider.getEmailAddress();
            console.log(`[phone-signup] add-email 候选邮箱: ${bindEmail}`);
            // 记录 fetch 调用时刻作为最低时间戳，避免读到旧邮件
            fetchAddEmailOtp = async () => {
                const startedAt = Date.now();
                console.log(`[add-email] 等待 IMAP 邮件 OTP for ${bindEmail} (after=${new Date(startedAt).toISOString()})...`);
                return await (hotmailProvider as any).getEmailVerificationCode(bindEmail, {minTimestampMs: startedAt});
            };
        } catch (e) {
            const errMsg = (e as Error).message;
            // 如果是邮箱池用完的错误，结束任务
            if (errMsg.includes("Hotmail 邮箱池已用完")) {
                console.error(`[phone-signup] ❌ ${errMsg}`);
                console.error(`[phone-signup] 任务结束：没有可用的邮箱，请补充新账号后重试`);
                if (hotmailDb) {
                  const stats = hotmailDb.getHotmailAccountStats();
                  console.log(`[phone-signup] 当前邮箱池状态: 全新=${stats.unused} 可重试=${stats.retryable} 已用=${stats.used} 失败=${stats.failed}`);
                  hotmailDb.close();
                }
                return;  // 结束任务
            }
            console.warn(`[phone-signup] hotmail 邮箱准备失败 (无 add-email 兜底): ${errMsg}`);
        }

        const webLoginClient = new OpenAIClient({
            email: registeredPhone,
            password: appConfig.defaultPassword,
            deviceProfile: generateRandomDeviceProfile(),
            manualMode: manualOtp,
            smsBroker,
            bindEmail,
            fetchAddEmailOtp,
        });
        try {
            await webLoginClient.authLoginChatGPTWeb();
            console.log(`[phone-signup] ChatGPT web 登录成功，session 已建立`);
        } catch (e) {
            console.warn(`[phone-signup] ChatGPT web 登录失败: ${(e as Error).message}`);
        }

        // 拿 ChatGPT plan accessToken（用 web login 后的 cookie）
        let chatgptAccessToken = "";
        try {
            chatgptAccessToken = await webLoginClient.getChatGPTAccessToken();
        } catch (err) {
            console.warn(`[警告] web login 拿 ChatGPT accessToken 失败: ${(err as Error).message}`);
        }
        if (!chatgptAccessToken) {
            throw new Error("phone-signup 完成但拿不到 ChatGPT accessToken");
        }
        const accessTokenFile = await webLoginClient.saveChatGPTAccessToken(chatgptAccessToken);
        console.log(`[access_token_file] ${accessTokenFile}`);
        console.log(`[access_token] ${chatgptAccessToken}`);

        if (gpTokenOutPath) {
            const {writeFile} = await import("node:fs/promises");
            await writeFile(gpTokenOutPath, chatgptAccessToken, "utf8");
            console.log(`[gp_token_out] 已写入 ${gpTokenOutPath}`);
        }
        return;
    }

    // ─── 模式 1: --sign --at 一体化：codex OAuth + add-phone + ChatGPT accessToken + CPA 上传 ───
    if (directSignupAuth && saveAccessToken) {
        const client = new OpenAIClient({
            email: email || undefined,
            password: appConfig.defaultPassword,
            deviceProfile,
            manualMode: manualOtp,
            signupScreenHint: "signup",
            smsBroker,
        });
        const result = await client.authRegisterAndAuthorizeHTTP();
        console.log(
            `[✅️授权成功] 邮箱：${client.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
        );

        // 同步拿 ChatGPT accessToken（OAuth 流程已经建立 chatgpt.com cookie）
        let chatgptAccessToken = "";
        try {
            chatgptAccessToken = await client.getChatGPTAccessToken();
        } catch (err) {
            console.warn(`[警告] 拿 ChatGPT accessToken 失败 (${(err as Error).message})，尝试重新登录`);
            const reauthClient = new OpenAIClient({
                email: client.email,
                password: appConfig.defaultPassword,
                deviceProfile: generateRandomDeviceProfile(),
                manualMode: manualOtp,
                smsBroker,
            });
            try {
                await reauthClient.authLoginHTTP();
            } catch (loginErr) {
                console.warn(`[警告] 重登录失败: ${(loginErr as Error).message}`);
            }
            chatgptAccessToken = await reauthClient.getChatGPTAccessToken();
        }
        const accessTokenFile = await client.saveChatGPTAccessToken(chatgptAccessToken);
        console.log(`[access_token_file] ${accessTokenFile}`);
        console.log(`[access_token] ${chatgptAccessToken}`);

        // 同时把 access_token 写到 GP 端 token.txt（供 Plus 订阅链路用）
        if (gpTokenOutPath) {
            try {
                const {writeFile} = await import("node:fs/promises");
                await writeFile(gpTokenOutPath, chatgptAccessToken, "utf8");
                console.log(`[gp_token_out] 已写入 ${gpTokenOutPath}`);
            } catch (e) {
                console.warn(`[警告] 写 gp-token-out 失败: ${(e as Error).message}`);
            }
        }
        return;
    }

    // ─── 模式 2: 仅 --sign（codex OAuth + add-phone + CPA 上传，不取 ChatGPT token） ───
    if (directSignupAuth) {
        const client = new OpenAIClient({
            email: email || undefined,
            password: appConfig.defaultPassword,
            deviceProfile,
            manualMode: manualOtp,
            signupScreenHint: "signup",
            smsBroker
        });
        const result = await client.authRegisterAndAuthorizeHTTP();
        console.log(
            `[✅️授权成功] 邮箱：${client.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
        );
        return;
    }

    // ─── 模式 3: 仅 --at（注册 + ChatGPT accessToken，不带 add-phone，不上传 CPA） ───
    const registerClient = new OpenAIClient({
        email: email || undefined,
        password: appConfig.defaultPassword,
        deviceProfile,
        manualMode: manualOtp,
        smsBroker
    });
    await registerClient.authRegisterHTTP();

    if (saveAccessToken) {
        let accessToken = "";
        try {
            accessToken = await registerClient.getChatGPTAccessToken();
        } catch (err) {
            console.warn(`[警告] 注册后直接拿 accessToken 失败 (${(err as Error).message})，尝试重新登录`);
            // Fallback: 用注册的邮箱密码重新登录，重新建立 cookie 后再拿 token
            const reauthClient = new OpenAIClient({
                email: registerClient.email,
                password: appConfig.defaultPassword,
                deviceProfile: generateRandomDeviceProfile(),
                manualMode: manualOtp,
                smsBroker,
            });
            try {
                await reauthClient.authLoginHTTP();
            } catch (loginErr) {
                console.warn(`[警告] 重登录也失败: ${(loginErr as Error).message}`);
            }
            accessToken = await reauthClient.getChatGPTAccessToken();
        }
        const accessTokenFile = await registerClient.saveChatGPTAccessToken(accessToken);
        console.log(`[✅️注册成功] 邮箱：${registerClient.email} 密码：${appConfig.defaultPassword}`);
        console.log(`[access_token_file] ${accessTokenFile}`);
        console.log(`[access_token] ${accessToken}`);

        // 追加到 --gp-token-out 指定的文件（默认 pool_tokens.txt 用于 GoPay charge）
        if (gpTokenOutPath && accessToken) {
            try {
                const {appendFile, mkdir, readFile, writeFile} = await import("node:fs/promises");
                const {existsSync} = await import("node:fs");
                const {dirname} = await import("node:path");
                await mkdir(dirname(gpTokenOutPath), {recursive: true});
                if (!existsSync(gpTokenOutPath)) {
                    await writeFile(gpTokenOutPath, accessToken + "\n", "utf8");
                } else {
                    const existing = await readFile(gpTokenOutPath, "utf8");
                    const needNewline = existing.length > 0 && !existing.endsWith("\n");
                    if (needNewline) {
                        await writeFile(gpTokenOutPath, existing + "\n", "utf8");
                    }
                    await appendFile(gpTokenOutPath, accessToken + "\n", "utf8");
                }
                console.log(`[gp_token_out] 已追加到: ${gpTokenOutPath}`);
            } catch (e) {
                console.warn(`[警告] 写 gp-token-out 失败: ${(e as Error).message}`);
            }
        }

        // 注册成功 → 把用过的 hotmail 卡密从 pool_emails.txt 移除，append 到 history
        // 仅当 provider=hotmail 且 email 来自池里时才执行（其他 provider 文件结构不同）
        if (MAILBOX_CONFIG.provider === "hotmail" && registerClient.email) {
            try {
                // 等 hotmail provider 的 IMAP refresh-token 持久化先跑完，避免 race condition
                // （IMAP 收 OTP 时可能触发 refresh，然后 persistTextAccount 写回老内容覆盖我们的删除）
                await new Promise(r => setTimeout(r, 1500));
                const {consumeHotmailLine} = await import("./consume-hotmail.js");
                const cr = consumeHotmailLine(registerClient.email);
                if (cr.ok) {
                    console.log(`[hotmail 卡密消费] ${cr.reason}`);
                } else {
                    console.warn(`[hotmail 卡密消费跳过] ${cr.reason}`);
                }
            } catch (e) {
                console.warn(`[hotmail 卡密消费失败，忽略] ${(e as Error).message}`);
            }
        }
        return;
    }

    const loginClient = new OpenAIClient({
        email: registerClient.email,
        password: appConfig.defaultPassword,
        deviceProfile,
        manualMode: manualOtp,
        smsBroker
    });
    const result = await loginClient.authLoginHTTP();
    console.log(
        `[✅️授权成功] 邮箱：${loginClient.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
    );
}

async function main() {
    const patrol = startHeroSmsPatrolLoop();
    try {
        let round = 0;
        let successCount = 0;
        let failCount = 0;
        const manualEmail = readArgValue("--email").trim();
    const authOnly = hasFlag("--auth");
    const manualOtp = hasFlag("--otp");
    const maxRounds = readNumberArg("--n");

    // 启动时初始化数据库并导入 Hotmail 邮箱
    try {
      const dbPath = "data/codex-register.sqlite";
      const initDb = new LocalDB(dbPath);

      // 导入 Hotmail 邮箱到数据库
      const {readFileSync, existsSync} = await import("node:fs");
      const hotmailTokensPath = "hotmail/tokens.txt";
      if (existsSync(hotmailTokensPath)) {
        const tokensContent = readFileSync(hotmailTokensPath, "utf8");
        const accounts = tokensContent
          .split(/\r?\n/)
          .filter(line => line.trim())
          .map(line => {
            const [email, password, client_id, refresh_token] = line.split("----");
            return {email, password, client_id, refresh_token};
          })
          .filter(a => a.email && a.password);
        const imported = initDb.importHotmailAccounts(accounts);
        if (imported > 0) {
          console.log(`[启动] 导入 ${imported} 个新 Hotmail 邮箱到数据库`);
        }
        const stats = initDb.getHotmailAccountStats();
        console.log(`[启动] Hotmail 邮箱池状态: 全新=${stats.unused} 可重试=${stats.retryable} 已用=${stats.used} 失败=${stats.failed}`);
      }

      initDb.close();
    } catch (initErr) {
      console.warn(`[启动] 初始化数据库失败: ${(initErr as Error).message}`);
    }

    if (hasFlag("--profile-geo-check")) {
        const {resolveProfileLocale} = await import("./profile-generator.js");
        const info = await resolveProfileLocale();
        console.log(`[profile-geo-check] locale=${info.locale} source=${info.source}${info.country ? ` country=${info.country}` : ``}`);
        return;
    }

    // ─── Workflow 模式: --workflow codex-cpa-register ───
    const workflowName = readArgValue("--workflow").trim();
    if (workflowName) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const count = readNumberArg("--count") || 1;
        const delayMs = readNumberArg("--delay-ms") || appConfig.loopDelayMs;
        const tokenOutPath = readArgValue("--token-out").trim();
        const skipProbeTrial = hasFlag("--skip-probe-trial");
        const concurrency = readNumberArg("--concurrency") || 1;
        const smsTimeoutMs = readNumberArg("--sms-timeout-ms") || 120000;
        const emailTimeoutMs = readNumberArg("--email-timeout-ms") || 90000;
        const cpaTimeoutMs = readNumberArg("--cpa-timeout-ms") || 60000;

        const db = new LocalDB(dbPath);
        const runId = db.createWorkflowRun(workflowName, {
          count,
          delayMs,
          concurrency,
          skipProbeTrial,
          tokenOutPath,
        });

        // 设置全局代理 dispatcher
        const { setGlobalDispatcher } = await import("undici");
        const { createProxyDispatcher } = await import("./proxy-dispatcher.js");
        const proxyUrl = appConfig.defaultProxyUrl;
        if (proxyUrl) {
          setGlobalDispatcher(createProxyDispatcher(proxyUrl, true));
        }

        // 显示启动信息（不检测 IP，IP 在 worker 级别检测）
        console.log(`\n${"=".repeat(60)}`);
        console.log(`[workflow] 启动 workflow=${workflowName} runId=${runId}`);
        console.log(`[workflow] 目标: count=${count} concurrency=${concurrency}`);
        if (proxyUrl) {
          console.log(`[proxy] ${proxyUrl.substring(0, 40)}...`);
        }
        console.log(`${"=".repeat(60)}\n`);

        let successCount = 0;
        let failureCount = 0;

        if (concurrency > 1) {
          // 并发模式
          const useConcurrentPool = hasFlag("--concurrent-pool");

          if (useConcurrentPool) {
            // 并发抢号模式：同时获取多个号码，先收到验证码的优先使用
            console.log(`\n[workflow] 使用并发抢号模式`);

            const results = await runConcurrentRegistration({
              concurrency,
              smsTimeoutMs,
              emailTimeoutMs,
              cpaTimeoutMs,
              skipProbeTrial,
              tokenOutPath,
              db,
              runId,
            });

            // 结果已经实时写入 db，这里只需要统计
            for (const result of results) {
              if (result.success) {
                successCount++;
              } else {
                failureCount++;
              }
            }
          } else {
            // Worker 调度模式：每个 worker 独立运行
            const scheduler = new WorkerScheduler(db, {
              runId,
              concurrency,
              count,
              smsTimeoutMs,
              emailTimeoutMs,
              cpaTimeoutMs,
              skipProbeTrial,
              tokenOutPath,
            });

            const result = await scheduler.run();
            successCount = result.success;
            failureCount = result.failure;
          }
        } else {
          // 串行模式（原有逻辑）
          for (let i = 1; i <= count; i++) {
            console.log(`\n${"=".repeat(60)}`);
            console.log(`[workflow] 第 ${i}/${count} 次 | ✅成功: ${successCount} ❌失败: ${failureCount} 剩余: ${count - i}`);
            console.log(`${"=".repeat(60)}\n`);

            const attemptId = db.createAttempt(runId);

            try {
              if (workflowName === "codex-cpa-register") {
                // 显示当前使用的 IP（通过代理检测出口 IP）
                try {
                  const { getIpInfo, resetIpCache } = await import("./ip-detect.js");
                  resetIpCache();
                  const ipInfo = await getIpInfo();
                  const residentialTag = ipInfo.isResidential ? "🏠 住宅" : "🏢 数据中心";
                  const proxyTag = ipInfo.isProxy ? "🔒 代理" : "";
                  const mobileTag = ipInfo.isMobile ? "📱 移动" : "";
                  console.log(`[workflow] [IP] ${ipInfo.ip} | ${ipInfo.country} ${ipInfo.city} | ${ipInfo.isp} | ${residentialTag} ${proxyTag} ${mobileTag}`);
                } catch (error) {
                  console.warn(`[workflow] [IP] 检测失败: ${(error as Error).message}`);
                }

                // 使用新的接口，从外部注入资源
                const smsBroker = appConfig.heroSMSApiKey ? createSMSBroker({
                  apiKey: appConfig.heroSMSApiKey,
                  pollAttempts: appConfig.heroSMSPollAttempts,
                  pollIntervalMs: appConfig.heroSMSPollIntervalMs,
                  maxPrice: appConfig.heroSMSMaxPrice,
                  country: appConfig.heroSMSCountry,
                  countries: appConfig.heroSMSCountries,
                  priceTiers: appConfig.heroSMSPriceTiers,
                  proxyUrl: appConfig.heroSMSProxy || "",
                }) : undefined;

                if (!smsBroker) {
                  throw new Error("Missing heroSMSApiKey configuration");
                }

                // 获取号码
                const lease = await smsBroker.getActivation();
                const phoneNumber = `+${lease.phoneNumber}`;
                const activationId = String(lease.activationId || "");

                // 更新 attempt 和 worker
                db.updateAttempt(attemptId, {
                  phone: phoneNumber,
                  sms_activation_id: activationId,
                });

                // 执行注册（邮箱延迟到注册成功后由 cpa-registration 内部创建）
                const { runCpaRegistration } = await import("./cpa-registration.js");
                const result = await runCpaRegistration({
                  workerId: `serial-${i}`,
                  attemptId,
                  phoneLease: lease,
                  phoneNumber,
                  activationId,
                  deadlines: {
                    smsDeadlineAt: Date.now() + smsTimeoutMs,
                    emailDeadlineAt: Date.now() + emailTimeoutMs,
                    cpaDeadlineAt: Date.now() + cpaTimeoutMs,
                  },
                  onStatusChange: (status) => {
                    console.log(`[workflow] ${status}`);
                  },
                  db,
                });

                console.log(`[POOL-RESULT] status=${result.status} phone=${result.phone} email=${result.email}`);

                db.updateAttempt(attemptId, {
                  status: result.status,
                  cpa_status: result.status,
                  cpa_auth_file: result.cpaAuthFile || "",
                  error: result.error || "",
                  finished_at: new Date().toISOString(),
                });

                if (result.status === "ok") {
                  successCount++;
                  db.saveAccount({
                    phone: result.phone,
                    email: result.email,
                    password: result.password,
                    access_token: result.accessToken || "",
                    token_expires_at: null,
                    cpa_auth_file: result.cpaAuthFile || "",
                    cpa_base_url: appConfig.cpa.baseUrl || "",
                    ip_address: result.ipAddress || "unknown",
                    ip_country: result.ipCountry || "unknown",
                    ip_city: result.ipCity || "unknown",
                    ip_isp: result.ipIsp || "unknown",
                    ip_is_residential: result.ipIsResidential ? 1 : 0,
                    token_backend: appConfig.tokenBackend || "cpa",
                    status: "active",
                  });

                  // 可选：写入 token 文件
                  if (tokenOutPath && result.accessToken) {
                    try {
                      const { appendFile } = await import("node:fs/promises");
                      await appendFile(tokenOutPath, result.accessToken + "\n", "utf8");
                    } catch (e) {
                      console.warn(`[workflow] 写 token 文件失败: ${(e as Error).message}`);
                    }
                  }

                  console.log(`[workflow] ✅ 第 ${i} 次成功`);
                } else {
                  failureCount++;
                  console.warn(`[workflow] ❌ 第 ${i} 次失败: ${result.error}`);

                  // 释放号码
                  try {
                    await smsBroker.markAsFailed(true);
                  } catch (e) {
                    console.warn(`[workflow] 释放号码失败: ${(e as Error).message}`);
                  }
                }
              } else {
                throw new Error(`Unknown workflow: ${workflowName}`);
              }
            } catch (error) {
              failureCount++;
              const errMsg = (error as Error).message;
              const errStack = (error as Error).stack?.split("\n").slice(0, 5).join(" | ") ?? "";
              console.error(`[workflow] ❌ 第 ${i} 次异常: ${errMsg}`);
              console.error(`[workflow] ❌ 堆栈: ${errStack}`);
              db.updateAttempt(attemptId, {
                status: "failed",
                error: errMsg,
                finished_at: new Date().toISOString(),
              });
            }

            // 延迟
            if (i < count && delayMs > 0) {
              const jitter = Math.floor(Math.random() * 15000) - 5000;
              const actualDelay = Math.max(5000, delayMs + jitter);
              console.log(`[workflow] 等待 ${actualDelay}ms 后继续...`);
              await new Promise(r => setTimeout(r, actualDelay));
            }
          }
        }

        // 完成 workflow run
        const finalStatus = failureCount === 0 ? "completed" : (successCount === 0 ? "failed" : "partial");
        db.finishWorkflowRun(runId, finalStatus, successCount, failureCount);

        const stats = db.getStats();
        console.log(`\n${"=".repeat(60)}`);
        console.log(`[workflow] 完成: status=${finalStatus} success=${successCount} failure=${failureCount}`);
        console.log(`[workflow] 统计: runs=${stats.runs} attempts=${stats.attempts} accounts=${stats.accounts} workers=${stats.workers}`);
        console.log(`${"=".repeat(60)}\n`);

        db.close();
        return;
    }

    // ─── DB 查询命令 ───
    if (hasFlag("--db-list-accounts")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const db = new LocalDB(dbPath);
        const accounts = db.listAccounts();
        console.log(`\n[db] 账号列表 (共 ${accounts.length} 个):\n`);
        for (const acc of accounts) {
          const residential = acc.ip_is_residential ? "🏠 住宅" : "🏢 数据中心";
          console.log(`  ID: ${acc.id}`);
          console.log(`  Phone: ${acc.phone}`);
          console.log(`  Email: ${acc.email}`);
          console.log(`  IP: ${acc.ip_address || "unknown"} | ${acc.ip_country || "?"} ${acc.ip_city || "?"} | ${residential}`);
          console.log(`  ISP: ${acc.ip_isp || "unknown"}`);
          console.log(`  Status: ${acc.status}`);
          console.log(`  Created: ${acc.created_at}`);
          console.log(`  Token: ${acc.access_token.slice(0, 20)}...`);
          console.log("");
        }
        db.close();
        return;
    }

    if (hasFlag("--db-list-runs")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const db = new LocalDB(dbPath);
        const runs = db.listRuns();
        console.log(`\n[db] 运行记录 (共 ${runs.length} 条):\n`);
        for (const run of runs) {
          console.log(`  ID: ${run.id}`);
          console.log(`  Workflow: ${run.workflow}`);
          console.log(`  Status: ${run.status}`);
          console.log(`  Started: ${run.started_at}`);
          console.log(`  Finished: ${run.finished_at || "-"}`);
          console.log(`  Success: ${run.success_count}`);
          console.log(`  Failure: ${run.failure_count}`);
          console.log("");
        }
        db.close();
        return;
    }

    if (hasFlag("--db-export-tokens")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const outputPath = readArgValue("--db-export-tokens").trim() || "tokens_export.txt";
        const db = new LocalDB(dbPath);
        const count = db.exportTokens(outputPath);
        console.log(`[db] 导出 ${count} 个 token 到: ${outputPath}`);
        db.close();
        return;
    }

    if (hasFlag("--db-list-workers")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const runId = readNumberArg("--run-id");
        const db = new LocalDB(dbPath);

        if (runId) {
          const workers = db.getActiveWorkers(runId);
          console.log(`\n[db] Run ${runId} 活跃 workers (共 ${workers.length} 个):\n`);
          for (const w of workers) {
            console.log(`  Worker: ${w.worker_id}`);
            console.log(`  Status: ${w.status}`);
            console.log(`  Phone: ${w.phone || "-"}`);
            console.log(`  Email: ${w.bind_email || "-"}`);
            console.log(`  Started: ${w.started_at}`);
            console.log("");
          }
        } else {
          const stats = db.getStats();
          console.log(`\n[db] Worker 统计: ${stats.workers} 个 worker slots\n`);
        }
        db.close();
        return;
    }

    if (hasFlag("--db-list-orphans")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const db = new LocalDB(dbPath);
        const showAll = hasFlag("--all");
        const orphans = db.listOrphanedAccounts(showAll ? undefined : false);
        const stats = db.getOrphanedAccountStats();

        console.log(`\n[db] 孤儿账号列表 (未解决: ${stats.unresolved} | 已解决: ${stats.resolved} | 总计: ${stats.total}):\n`);
        for (const orphan of orphans) {
          const status = orphan.resolved ? "✅ 已解决" : "❌ 未解决";
          console.log(`  ID: ${orphan.id}`);
          console.log(`  Phone: ${orphan.phone}`);
          console.log(`  Email: ${orphan.email}`);
          console.log(`  Error Type: ${orphan.error_type}`);
          console.log(`  Error Message: ${orphan.error_message || "-"}`);
          console.log(`  OpenAI Registered: ${orphan.openai_registered ? "是" : "否"}`);
          console.log(`  Status: ${status}`);
          console.log(`  Created: ${orphan.created_at}`);
          if (orphan.resolved) {
            console.log(`  Resolved At: ${orphan.resolved_at}`);
            console.log(`  Note: ${orphan.resolved_note || "-"}`);
          }
          console.log("");
        }
        db.close();
        return;
    }

    if (hasFlag("--db-resolve-orphan")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const orphanId = readNumberArg("--db-resolve-orphan");
        if (!orphanId) {
          throw new Error("使用 --db-resolve-orphan 时必须指定孤儿账号 ID (例如: --db-resolve-orphan 1)");
        }
        const note = readArgValue("--note").trim() || "";
        const db = new LocalDB(dbPath);
        db.resolveOrphanedAccount(orphanId, note);
        console.log(`[db] 孤儿账号 ID=${orphanId} 已标记为解决`);
        if (note) {
          console.log(`[db] 备注: ${note}`);
        }
        db.close();
        return;
    }

    if (hasFlag("--recover-orphans")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const maxAttempts = readNumberArg("--max") || 10;
        const cpaBase = readArgValue("--cpa-base").trim() || process.env.CPA_BASE_URL?.trim() || appConfig.cpa.baseUrl || "";
        const cpaKey = readArgValue("--cpa-key").trim() || process.env.CPA_MANAGEMENT_KEY?.trim() || appConfig.cpa.managementKey || "";

        if (!cpaBase || !cpaKey) {
          throw new Error("缺少 CPA 配置: 需要 --cpa-base 和 --cpa-key 参数，或在 config.json 中配置");
        }

        const db = new LocalDB(dbPath);
        const { recoverOrphans } = await import("./recover-orphans.js");

        console.log(`\n[恢复] 开始恢复孤儿账号 (最多 ${maxAttempts} 条)...`);
        const result = await recoverOrphans({ db, maxAttempts, cpaBase, cpaKey });

        console.log(`\n[恢复] ===== 最终统计 =====`);
        console.log(`[恢复] 成功: ${result.success}`);
        console.log(`[恢复] 失败: ${result.failed}`);
        console.log(`[恢复] 跳过: ${result.skipped}`);

        db.close();
        return;
    }

    if (hasFlag("--db-list-hotmail")) {
        const dbPath = readArgValue("--db-path").trim() || "data/codex-register.sqlite";
        const db = new LocalDB(dbPath);
        const filterStatus = readArgValue("--status").trim();  // unused / used / failed
        const accounts = db.listHotmailAccounts(filterStatus || undefined);
        const stats = db.getHotmailAccountStats();

        console.log(`\n[db] Hotmail 邮箱池状态 (全新: ${stats.unused} | 可重试: ${stats.retryable} | 已用: ${stats.used} | 失败: ${stats.failed} | 总计: ${stats.total}):\n`);
        for (const account of accounts) {
          const statusEmoji = account.status === "unused" ? "🟢" : account.status === "retryable" ? "🟡" : account.status === "used" ? "🔵" : "🔴";
          const statusText = account.status === "unused" ? "全新" : account.status === "retryable" ? "可重试" : account.status === "used" ? "已用" : "失败";
          console.log(`  ${statusEmoji} ID: ${account.id}`);
          console.log(`  Email: ${account.email}`);
          console.log(`  Status: ${statusText} (${account.status})`);
          console.log(`  Used At: ${account.used_at || "-"}`);
          console.log(`  Created: ${account.created_at}`);
          console.log("");
        }
        db.close();
        return;
    }

    if (authOnly) {
        if (!manualEmail) {
            throw new Error("使用 --auth 时必须同时指定 --email");
        }
        try {
            const deviceProfile = generateRandomDeviceProfile();
            const client = new OpenAIClient({
                email: manualEmail,
                password: appConfig.defaultPassword,
                deviceProfile,
                manualMode: manualOtp,
                smsBroker,
            });
            const result = await client.authLoginHTTP();
            console.log(
                `[✅️授权成功] 邮箱：${client.email} 密码：${appConfig.defaultPassword} 授权文件：${result.authFile ?? ""}`,
            );

            // 如果加了 --at，再拿 ChatGPT plan accessToken
            if (hasFlag("--at")) {
                let chatgptAccessToken = "";
                try {
                    chatgptAccessToken = await client.getChatGPTAccessToken();
                } catch (err) {
                    console.warn(`[警告] 拿 ChatGPT accessToken 失败 (${(err as Error).message})`);
                }
                if (chatgptAccessToken) {
                    const accessTokenFile = await client.saveChatGPTAccessToken(chatgptAccessToken);
                    console.log(`[access_token_file] ${accessTokenFile}`);
                    console.log(`[access_token] ${chatgptAccessToken}`);
                    const gpOut = readArgValue("--gp-token-out").trim();
                    if (gpOut) {
                        const {writeFile} = await import("node:fs/promises");
                        await writeFile(gpOut, chatgptAccessToken, "utf8");
                        console.log(`[gp_token_out] 已写入 ${gpOut}`);
                    }
                }
            }
        } catch (error) {
            console.error(`[❌️授权失败]`, error);
        }
        return;
    }

    if (manualEmail) {
        try {
            await runOnce(db);
        } catch (error) {
            console.error(`[❌️授权失败]`, error);
        }
        return;
    }

    if (hasFlag("--codex-cpa") || hasFlag("--phone")) {
        let runId: number | null = null;
        let db: any = null;

        try {
            // 初始化数据库
            const dbPath = "data/codex-register.sqlite";
            db = new LocalDB(dbPath);
            runId = db.createWorkflowRun("codex-cpa-single", {
                mode: "single",
            });

            await runOnce(db);
        } catch (error) {
            console.error(`[❌️授权失败]`, error);
            process.exitCode = 1;

            // 失败时写入 registration_attempts 表
            if (db && runId) {
                try {
                    const attemptId = db.createAttempt(runId);
                    db.updateAttempt(attemptId, {
                        status: "failed",
                        error: (error as Error).message || "未知错误",
                    });
                    console.log(`[codex-cpa] [❌️] 已记录失败到数据库 (attemptId=${attemptId})`);
                } catch (dbError) {
                    console.warn(`[codex-cpa] [⚠️] 记录失败到数据库失败: ${(dbError as Error).message}`);
                }
            }
        }
        return;
    }

    while (!maxRounds || round < maxRounds) {
        round += 1;
        console.log(
            `第 ${round} 轮开始: 成功=${successCount} 失败=${failCount} 模式=自动`,
        );
        try {
            await runOnce(db);
            successCount += 1;
        } catch (error) {
            failCount += 1;
            console.error(`[❌️授权失败]`, error);
        }

        if (appConfig.loopDelayMs > 0) {
            const jitter = Math.floor(Math.random() * 15000) - 5000;
            const actualDelay = Math.max(5000, appConfig.loopDelayMs + jitter);
            console.log(`[延迟] 轮次间等待 ${actualDelay}ms`);
            await new Promise((resolve) => setTimeout(resolve, actualDelay));
        }
    }

    console.log(
        `自动模式结束: 已执行=${round} 成功=${successCount} 失败=${failCount}`,
    );
    } finally {
        patrol.stop();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
