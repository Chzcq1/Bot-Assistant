import { Router } from "express";
import fs from "fs";
import path from "path";
import { logger } from "../lib/logger";

const router = Router();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
function findWorkspaceRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
const DB_FILE = path.join(findWorkspaceRoot(), "bot", "database.json");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BotDB {
  total_sales: number;
  total_orders: number;
  weekly_target: number;
  today_sales: number;
  today_orders: number;
  last_date: string;
  last_entry: { amount: number } | null;
  notes: Array<{ text: string; time: string }>;
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

// ─── Database Helpers ──────────────────────────────────────────────────────────

const DB_DEFAULT: BotDB = {
  total_sales: 0, total_orders: 0, weekly_target: 6000,
  today_sales: 0, today_orders: 0, last_date: "",
  last_entry: null, notes: [],
};

function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function todayDisplay(): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date());
}

function nowDisplay(): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

function loadDB(): BotDB {
  let data: BotDB;
  if (!fs.existsSync(DB_FILE)) {
    data = { ...DB_DEFAULT };
    saveDB(data);
    return data;
  }
  data = { ...DB_DEFAULT, ...JSON.parse(fs.readFileSync(DB_FILE, "utf-8")) };
  const today = todayStr();
  if (data.last_date !== today) {
    data.today_sales = 0;
    data.today_orders = 0;
    data.last_date = today;
    saveDB(data);
  }
  return data;
}

function saveDB(data: BotDB) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4), "utf-8");
}

// ─── Formatting Helpers ────────────────────────────────────────────────────────

function esc(text: string | number): string {
  return String(text).replace(/([_*[\]()~`>#+=|{}.!\-\\])/g, "\\$1");
}

function num(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function progressBar(pct: number, length = 10): string {
  const filled = Math.floor(Math.min(pct, 100) / (100 / length));
  return "🟩".repeat(filled) + "⬜".repeat(length - filled);
}

const MOTIVATIONAL_QUOTES = [
  "🔥 อย่าหยุด! ทุกออร์เดอร์คือก้าวหนึ่งสู่เป้าหมาย ไม่มีใครรวยได้โดยไม่ลงมือทำ!",
  "💪 คนที่ชนะไม่ใช่คนที่เก่งที่สุด แต่คือคนที่ไม่ยอมแพ้! ปิดดีลต่อไป!",
  "⚡ เงินรออยู่ข้างหน้า! แค่ก้าวต่อไปอีกก้าวเดียว อย่าให้โอกาสหลุดมือ!",
  "🚀 600 คนในกลุ่มรอคุณอยู่! ทุกข้อความที่ส่งออกไปคือโอกาสทองที่จะเปลี่ยนชีวิต!",
  "🏆 แชมป์ไม่ได้เกิดจากความโชคดี แต่เกิดจากการปิดดีลทุกวันไม่หยุด! GO GO GO!",
  "💰 ยอดขายไม่โกหก! ลงมือทำวันนี้ แล้วตัวเลขจะพูดแทนคุณเอง!",
  "🎯 โฟกัสที่เป้าหมาย! ทุกบาทที่เข้ามาคือหลักฐานว่าคุณเก่งจริง อย่าปล่อยให้โมเมนตัมหยุด!",
  "🌟 นี่คือช่วงเวลาของคุณ! คนที่ลงมือตอนนี้คือคนที่จะได้ผลลัพธ์ก่อนใคร ทำเลย!",
  "💎 ทุกออร์เดอร์ที่ปิดได้คือก้าวที่ใกล้อิสรภาพทางการเงินมากขึ้น ไม่หยุดก็ไม่แพ้!",
  "🔑 ความสำเร็จไม่ได้ขายที่ไหน แต่มันซ่อนอยู่หลังการลงมือทำทุกวัน!",
];

function randomQuote(): string {
  return MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
}

// ─── Telegram API ──────────────────────────────────────────────────────────────

async function sendMessage(chatId: number, text: string, parseMode = "MarkdownV2") {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to send Telegram message");
  }
}

// ─── Dashboard Builder ─────────────────────────────────────────────────────────

function buildDashboard(data: BotDB): string {
  const { total_sales, total_orders, weekly_target, today_sales, today_orders } = data;
  const remaining = weekly_target - total_sales;
  const pct = weekly_target > 0 ? Math.min(Math.floor((total_sales / weekly_target) * 100), 100) : 0;
  const bar = progressBar(pct);
  const date = todayDisplay();

  const targetLine = total_sales >= weekly_target
    ? `🎉 *TARGET ACHIEVED\\!* 🎊 ยอดเกินเป้า \\+${esc(num(total_sales - weekly_target))} บาท\\!`
    : `🎯 เหลืออีก \`${num(remaining)}\` บาท จะถึงเป้า`;

  return [
    `🍆 *\\=\\=\\= EGGPLANT ASSISTANT \\=\\=\\=* 🍆\n`,
    `📅 *วันนี้ ${esc(date)}*`,
    `├ 💵 ยอดวันนี้: \`${num(today_sales)}\` บาท`,
    `└ 📦 ปิดวันนี้: \`${today_orders}\` ออร์เดอร์\n`,
    `━━━━━━━━━━━━━━━━━\n`,
    `📊 *รวมทั้งหมดรอบนี้*`,
    `├ 💰 ยอดขายสะสม: \`${num(total_sales)}\` บาท`,
    `├ ✅ ออร์เดอร์ปิดแล้ว: \`${total_orders}\` รายการ`,
    `└ 🏁 เป้าหมาย: \`${num(weekly_target)}\` บาท\n`,
    `📈 ความคืบหน้า: \`${pct}%\``,
    `${bar}\n`,
    targetLine,
    `\n━━━━━━━━━━━━━━━━━`,
  ].join("\n");
}

// ─── Command Handlers ──────────────────────────────────────────────────────────

async function handleStatus(msg: TgMessage) {
  const data = loadDB();
  await sendMessage(msg.chat.id, buildDashboard(data));
}

async function handleToday(msg: TgMessage) {
  const data = loadDB();
  const { today_sales, today_orders, weekly_target, total_sales, total_orders } = data;
  const avg = today_orders > 0 ? today_sales / today_orders : 0;
  const date = todayDisplay();

  const text = [
    `📅 *สรุปยอดขายวันนี้ ${esc(date)}*\n`,
    `💵 ยอดรวมวันนี้: \`${num(today_sales)}\` บาท`,
    `📦 ออร์เดอร์วันนี้: \`${today_orders}\` รายการ`,
    `📐 เฉลี่ยต่อออร์เดอร์: \`${num(avg)}\` บาท\n`,
    `━━━━━━━━━━━━━━━━━`,
    `🏁 เป้าหมายรอบนี้: \`${num(weekly_target)}\` บาท`,
    `💰 ยอดสะสมรอบนี้: \`${num(total_sales)}\` บาท`,
    `✅ ออร์เดอร์รวมรอบนี้: \`${total_orders}\` รายการ`,
  ].join("\n");
  await sendMessage(msg.chat.id, text);
}

async function handleHow(msg: TgMessage) {
  const text = [
    `🍆 *EGGPLANT ASSISTANT — คู่มือการใช้งาน*\n`,
    `━━━━━━━━━━━━━━━━━\n`,
    `📌 *วิธีนับยอดขาย*`,
    `พิมพ์ \`นับ\` ตามด้วยตัวเลข เช่น:`,
    `\`นับ500\` หรือ \`นับ1200\``,
    `บอทจะบวกยอดเข้าระบบและเพิ่มออร์เดอร์ 1 รายการทันที\n`,
    `━━━━━━━━━━━━━━━━━\n`,
    `📋 *รายการคำสั่งทั้งหมด*\n`,
    `📊 /start หรือ /status`,
    `   ➜ ดูแดชบอร์ดยอดขายรวม\n`,
    `📅 /today`,
    `   ➜ ดูสรุปยอดขายเฉพาะวันนี้\n`,
    `🎯 /settarget 8000`,
    `   ➜ ตั้งเป้าหมายใหม่ ใส่ตัวเลขจำนวนเงิน\n`,
    `↩️ /undo`,
    `   ➜ ยกเลิกการนับครั้งล่าสุด\n`,
    `📝 /note ข้อความ`,
    `   ➜ บันทึกโน้ตหรือหมายเหตุ\n`,
    `📒 /notes`,
    `   ➜ ดูโน้ตทั้งหมดที่บันทึกไว้\n`,
    `📢 /broadcast ข้อความ`,
    `   ➜ จัดรูปแบบประกาศพร้อม copy ไปใช้\n`,
    `🔄 /reset`,
    `   ➜ รีเซ็ตยอดขายและออร์เดอร์เป็น 0 \\(เป้าหมายยังคงเดิม\\)\n`,
    `❓ /how`,
    `   ➜ แสดงคู่มือการใช้งานนี้\n`,
    `━━━━━━━━━━━━━━━━━`,
    `💡 *ตัวอย่างการใช้งานจริง*`,
    `ปิดออร์เดอร์ 350 บาท → พิมพ์ \`นับ350\``,
    `ปิดออร์เดอร์ 1,200 บาท → พิมพ์ \`นับ1200\``,
  ].join("\n");
  await sendMessage(msg.chat.id, text);
}

async function handleSetTarget(msg: TgMessage, args: string) {
  const raw = args.replace(/,/g, "").trim();
  const newTarget = parseFloat(raw);
  if (!raw || isNaN(newTarget) || newTarget <= 0) {
    await sendMessage(msg.chat.id, "❌ กรุณาระบุตัวเลข เช่น `/settarget 8000`", "Markdown");
    return;
  }
  const data = loadDB();
  const oldTarget = data.weekly_target;
  data.weekly_target = newTarget;
  saveDB(data);
  await sendMessage(msg.chat.id,
    `✅ *อัปเดตเป้าหมายสำเร็จ\\!*\n\n` +
    `📌 เป้าเก่า: \`${num(oldTarget)}\` บาท\n` +
    `🎯 เป้าใหม่: \`${num(newTarget)}\` บาท`
  );
}

async function handleUndo(msg: TgMessage) {
  const data = loadDB();
  if (!data.last_entry) {
    await sendMessage(msg.chat.id, "❌ ไม่มีรายการที่สามารถยกเลิกได้", "Markdown");
    return;
  }
  const amount = data.last_entry.amount;
  data.total_sales  = Math.max(0, data.total_sales - amount);
  data.total_orders = Math.max(0, data.total_orders - 1);
  data.today_sales  = Math.max(0, data.today_sales - amount);
  data.today_orders = Math.max(0, data.today_orders - 1);
  data.last_entry = null;
  saveDB(data);
  await sendMessage(msg.chat.id,
    `↩️ *ยกเลิกรายการล่าสุดแล้ว\\!*\n\n` +
    `🗑 ลบออก: \`${num(amount)}\` บาท\n` +
    `💵 ยอดคงเหลือ: \`${num(data.total_sales)}\` บาท\n` +
    `📦 ออร์เดอร์ที่เหลือ: \`${data.total_orders}\` รายการ`
  );
}

async function handleNote(msg: TgMessage, noteText: string) {
  if (!noteText.trim()) {
    await sendMessage(msg.chat.id, "❌ กรุณาใส่ข้อความ เช่น `/note ลูกค้าสั่งสินค้าพิเศษ`", "Markdown");
    return;
  }
  const data = loadDB();
  const timestamp = nowDisplay();
  data.notes.push({ text: noteText.trim(), time: timestamp });
  if (data.notes.length > 20) data.notes = data.notes.slice(-20);
  saveDB(data);
  await sendMessage(msg.chat.id,
    `📝 *บันทึกโน้ตแล้ว\\!*\n\n` +
    `🕐 ${esc(timestamp)}\n` +
    `📌 ${esc(noteText.trim())}`
  );
}

async function handleNotes(msg: TgMessage) {
  const data = loadDB();
  if (!data.notes || data.notes.length === 0) {
    await sendMessage(msg.chat.id, "📒 ยังไม่มีโน้ตที่บันทึกไว้", "Markdown");
    return;
  }
  const lines = ["📒 *โน้ตทั้งหมด*\n\n━━━━━━━━━━━━━━━━━\n"];
  [...data.notes].reverse().forEach((n, i) => {
    lines.push(`${i + 1}\\. 🕐 _${esc(n.time)}_\n   📌 ${esc(n.text)}\n`);
  });
  await sendMessage(msg.chat.id, lines.join("\n"));
}

async function handleReset(msg: TgMessage) {
  const data = loadDB();
  const target = data.weekly_target;
  data.total_sales  = 0;
  data.total_orders = 0;
  data.today_sales  = 0;
  data.today_orders = 0;
  data.last_entry   = null;
  saveDB(data);
  await sendMessage(msg.chat.id,
    `🔄 *รีเซ็ตสำเร็จ\\!* เริ่มรอบสัปดาห์ใหม่\n\n` +
    `💰 ยอดขาย: \`0\` บาท\n` +
    `📦 ออร์เดอร์: \`0\` รายการ\n` +
    `🎯 เป้าหมายยังคงอยู่ที่: \`${num(target)}\` บาท\n\n` +
    `💪 มาลุยกัน\\! สัปดาห์นี้ต้องปิดให้ได้\\!`
  );
}

async function handleBroadcast(msg: TgMessage, content: string) {
  if (!content.trim()) {
    await sendMessage(msg.chat.id, "❌ กรุณาใส่ข้อความ เช่น `/broadcast ข้อความของคุณ`", "Markdown");
    return;
  }
  const formatted =
    `✨✨✨✨✨✨✨✨✨✨\n` +
    `🍆 *ประกาศจากทีมงาน* 🍆\n` +
    `✨✨✨✨✨✨✨✨✨✨\n\n` +
    `${content.trim()}\n\n` +
    `━━━━━━━━━━━━━━━━━\n` +
    `💌 _ขอบคุณทุกท่านที่ติดตาม_ 🙏`;
  await sendMessage(msg.chat.id, formatted, "Markdown");
}

async function handleCount(msg: TgMessage, raw: string) {
  const amount = parseFloat(raw.replace(/,/g, "").trim());
  if (isNaN(amount) || amount <= 0) {
    await sendMessage(msg.chat.id,
      `❌ รูปแบบไม่ถูกต้อง\n\n✅ ตัวอย่างที่ถูกต้อง:\n\`นับ500\`\n\`นับ1200\`\n\`นับ3500\``,
      "Markdown"
    );
    return;
  }
  const data = loadDB();
  data.total_sales  += amount;
  data.total_orders += 1;
  data.today_sales  += amount;
  data.today_orders += 1;
  data.last_entry = { amount };
  saveDB(data);

  const { total_sales, total_orders, today_orders, weekly_target } = data;
  const remaining = weekly_target - total_sales;
  const pct = weekly_target > 0 ? Math.min(Math.floor((total_sales / weekly_target) * 100), 100) : 100;

  const statusLine = total_sales >= weekly_target
    ? `🎉 *TARGET ACHIEVED\\!* ปิดเป้าแล้ว\\!`
    : `🎯 เหลืออีก \`${num(remaining)}\` บาท \\(${pct}%\\)`;

  const text =
    `💰 *\\+${esc(num(amount))} บาท* บันทึกแล้ว\\!\n\n` +
    `📦 ออร์เดอร์รอบนี้: \`${total_orders}\` รายการ\n` +
    `📅 ออร์เดอร์วันนี้: \`${today_orders}\` รายการ\n` +
    `💵 ยอดรวมรอบนี้: \`${num(total_sales)}\` บาท\n` +
    `${statusLine}\n\n` +
    `${esc(randomQuote())}`;

  await sendMessage(msg.chat.id, text);
}

// ─── Main Message Router ───────────────────────────────────────────────────────

async function handleMessage(msg: TgMessage) {
  const text = (msg.text ?? "").trim();
  if (!text) return;

  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().split("@")[0];
  const args = rest.join(" ");

  if (cmd === "/start" || cmd === "/status") return handleStatus(msg);
  if (cmd === "/today")                      return handleToday(msg);
  if (cmd === "/how")                        return handleHow(msg);
  if (cmd === "/settarget")                  return handleSetTarget(msg, args);
  if (cmd === "/undo")                       return handleUndo(msg);
  if (cmd === "/note")                       return handleNote(msg, args);
  if (cmd === "/notes")                      return handleNotes(msg);
  if (cmd === "/reset")                      return handleReset(msg);
  if (cmd === "/broadcast" || cmd === "/announce") return handleBroadcast(msg, args);

  if (text.startsWith("นับ")) return handleCount(msg, text.slice(3));
}

// ─── Webhook Setup ─────────────────────────────────────────────────────────────

export async function setupWebhook() {
  if (!BOT_TOKEN) {
    logger.warn("TELEGRAM_BOT_TOKEN not set — skipping webhook setup");
    return;
  }
  const rawDomain = process.env.REPLIT_DOMAINS ?? process.env.REPLIT_DEV_DOMAIN;
  if (!rawDomain) {
    logger.warn("No domain env var found — skipping webhook setup");
    return;
  }
  const domain = rawDomain.split(",")[0].trim();
  const webhookUrl = `https://${domain}/api/telegram`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true }),
    });
    const json = await res.json() as { ok: boolean; description?: string };
    if (json.ok) {
      logger.info({ webhookUrl }, "✅ Telegram webhook registered");
    } else {
      logger.error({ json }, "❌ Failed to register Telegram webhook");
    }
  } catch (err) {
    logger.error({ err }, "❌ Error setting Telegram webhook");
  }
}

// ─── Webhook Route ─────────────────────────────────────────────────────────────

router.get("/bot-status", (_req, res) => {
  try {
    const data = loadDB();
    res.json({
      total_sales: data.total_sales,
      total_orders: data.total_orders,
      weekly_target: data.weekly_target,
      today_sales: data.today_sales,
      today_orders: data.today_orders,
    });
  } catch {
    res.status(500).json({ error: "Could not read database" });
  }
});

router.post("/telegram", (req, res) => {
  res.sendStatus(200);
  const message: TgMessage | undefined = req.body?.message ?? req.body?.edited_message;
  if (message?.text) {
    handleMessage(message).catch((err) => logger.error({ err }, "Error handling message"));
  }
});

export default router;
