import { readFileSync } from "node:fs";

// 读取配置
const config = JSON.parse(readFileSync("config.json", "utf8"));
const apiKey = config.heroSMSApiKey;

if (!apiKey) {
  console.error("❌ config.json 中没有 heroSMSApiKey");
  process.exit(1);
}

const API_BASE = "https://hero-sms.com/stubs/handler_api.php";

interface Activation {
  activationId: string;
  phoneNumber: string;
  activationTime: string;
  activationStatus: string;
  ageSeconds: number;
}

// 获取所有活跃号码
async function getActiveActivations(): Promise<Activation[]> {
  const results: Activation[] = [];
  let start = 0;
  const limit = 100;

  const url = `${API_BASE}?action=getActiveActivations&api_key=${encodeURIComponent(apiKey)}&start=${start}&limit=${limit}`;
  console.log(`📡 正在获取活跃号码...`);

  const res = await fetch(url, { method: "GET" });
  const body = await res.text();

  let payload: any = {};
  try {
    payload = JSON.parse(body);
  } catch (e) {
    console.error("❌ JSON 解析失败:", body);
    return results;
  }

  if (payload.status !== "success") {
    console.error("❌ API 返回错误:", payload);
    return results;
  }

  const data: any[] = Array.isArray(payload?.data) ? payload.data : [];
  console.log(`📡 获取到 ${data.length} 条数据\n`);

  const now = Date.now();

  for (const item of data) {
    const activationId = String(item?.activationId ?? "").trim();
    const phoneNumber = String(item?.phoneNumber ?? "").trim();
    const activationTime = String(item?.activationTime ?? "").trim();

    if (!activationId || !phoneNumber) continue;

    // 自动检测 HeroSMS 时间的时区
    // HeroSMS 返回格式：2026-06-16 13:40:25（无时区信息）
    // 策略：先尝试 UTC 解析，如果年龄是负数或超过 24 小时，切换到 UTC+8

    let activationDate = new Date(activationTime.replace(" ", "T") + "Z"); // 先尝试 UTC
    let ageMs = now - activationDate.getTime();
    let ageSeconds = Math.floor(ageMs / 1000);

    // 如果年龄是负数或超过 24 小时（86400 秒），说明时区解析错误
    if (ageSeconds < 0 || ageSeconds > 86400) {
      // 尝试 UTC+8（北京时间）
      activationDate = new Date(activationTime.replace(" ", "T") + "+08:00");
      ageMs = now - activationDate.getTime();
      ageSeconds = Math.floor(ageMs / 1000);
    }

    results.push({
      activationId,
      phoneNumber,
      activationTime,
      activationStatus: String(item?.activationStatus ?? "").trim(),
      ageSeconds,
    });
  }

  return results;
}

// 取消号码
async function cancelActivation(activationId: string): Promise<{ success: boolean; message: string }> {
  const url = `${API_BASE}?action=setStatus&id=${encodeURIComponent(activationId)}&status=8&api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { method: "GET" });
  const body = await res.text();

  try {
    const json = JSON.parse(body);
    if (json.title === "EARLY_CANCEL_DENIED") {
      return { success: false, message: `需要等待 ${json.info?.minActivationTime || 120} 秒` };
    }
  } catch {}

  const upper = body.toUpperCase();
  if (
    upper.includes("ACCESS_CANCEL") ||
    upper.includes("ACCESS_READY") ||
    upper.includes("BAD_STATUS") ||
    upper.includes("NO_ACTIVATION")
  ) {
    return { success: true, message: body };
  }

  return { success: false, message: body };
}

// 格式化时间
function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}分${secs}秒`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}时${mins}分`;
}

// 主函数
async function main() {
  console.log("🔍 正在获取所有活跃号码...\n");

  const activations = await getActiveActivations();

  if (activations.length === 0) {
    console.log("✅ 没有活跃号码，无需清理");
    return;
  }

  // 分类：可取消 / 需等待
  const canCancel: Activation[] = [];
  const needWait: Activation[] = [];

  for (const act of activations) {
    if (act.ageSeconds >= 120) {
      canCancel.push(act);
    } else {
      needWait.push(act);
    }
  }

  // 显示所有号码
  console.log(`📋 发现 ${activations.length} 个活跃号码:\n`);

  for (const act of activations) {
    const status = act.ageSeconds >= 120 ? "✅ 可取消" : `⏳ 需等待 ${120 - act.ageSeconds}秒`;
    console.log(`  号码: +${act.phoneNumber}`);
    console.log(`  ID: ${act.activationId}`);
    console.log(`  时间: ${act.activationTime} (${formatAge(act.ageSeconds)}前)`);
    console.log(`  状态: ${act.activationStatus} | ${status}`);
    console.log("");
  }

  // 显示汇总
  console.log("=".repeat(50));
  console.log(`📊 汇总: 可取消=${canCancel.length} | 需等待=${needWait.length} | 总计=${activations.length}`);
  console.log("=".repeat(50));

  if (needWait.length > 0) {
    console.log(`\n⏳ 以下号码需要等待:`);
    for (const act of needWait) {
      const waitSec = 120 - act.ageSeconds;
      console.log(`  +${act.phoneNumber} - 还需等待 ${waitSec}秒 (${formatAge(act.ageSeconds)}后可取消)`);
    }
  }

  // 取消可取消的号码
  if (canCancel.length > 0) {
    console.log(`\n🗑️  开始取消 ${canCancel.length} 个号码...\n`);

    let success = 0;
    let failed = 0;

    for (const act of canCancel) {
      const result = await cancelActivation(act.activationId);

      if (result.success) {
        console.log(`  ✅ +${act.phoneNumber} 已取消 (${formatAge(act.ageSeconds)})`);
        success++;
      } else {
        console.log(`  ❌ +${act.phoneNumber} 取消失败: ${result.message}`);
        failed++;
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log(`📊 取消完成: 成功=${success} 失败=${failed}`);
    console.log("=".repeat(50));
  } else {
    console.log("\n⚠️  没有可取消的号码（所有号码都需要等待 120 秒）");
  }
}

main().catch((error) => {
  console.error("❌ 脚本执行失败:", error.message);
  process.exit(1);
});
