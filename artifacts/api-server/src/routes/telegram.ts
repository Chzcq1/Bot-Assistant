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

interface AdminStats {
  sales: number;
  orders: number;
  today_sales: number;
  today_orders: number;
  last_date: string;
}

interface DailyEntry {
  date: string;   // YYYY-MM-DD
  sales: number;
  orders: number;
}

interface BotDB {
  total_sales: number;
  total_orders: number;
  weekly_target: number;
  today_sales: number;
  today_orders: number;
  last_date: string;
  last_entry: { amount: number; admin?: string } | null;
  notes: Array<{ text: string; time: string }>;
  admins: { [identifier: string]: AdminStats };
  daily_history: DailyEntry[];
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
}

interface TgCallbackQuery {
  id: string;
  from: { id: number; username?: string; first_name?: string; last_name?: string };
  message: { message_id: number; chat: { id: number } };
  data?: string;
}

// ─── Database Helpers ──────────────────────────────────────────────────────────

const DB_DEFAULT: BotDB = {
  total_sales: 0, total_orders: 0, weekly_target: 6000,
  today_sales: 0, today_orders: 0, last_date: "",
  last_entry: null, notes: [], admins: {}, daily_history: [],
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
  const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  data = { ...DB_DEFAULT, ...raw, admins: raw.admins ?? {}, daily_history: raw.daily_history ?? [] };

  const today = todayStr();
  if (data.last_date !== today) {
    data.today_sales = 0;
    data.today_orders = 0;
    data.last_date = today;
    for (const key of Object.keys(data.admins)) {
      if (data.admins[key].last_date !== today) {
        data.admins[key].today_sales = 0;
        data.admins[key].today_orders = 0;
        data.admins[key].last_date = today;
      }
    }
    saveDB(data);
  }
  return data;
}

function saveDB(data: BotDB) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 4), "utf-8");
}

// ─── Daily History Helpers ─────────────────────────────────────────────────────

function updateDailyHistory(data: BotDB, amount: number) {
  const today = todayStr();
  if (!data.daily_history) data.daily_history = [];
  const entry = data.daily_history.find(d => d.date === today);
  if (entry) {
    entry.sales += amount;
    entry.orders += 1;
  } else {
    data.daily_history.push({ date: today, sales: amount, orders: 1 });
  }
  // Keep last 7 days only, sorted ascending
  data.daily_history.sort((a, b) => a.date.localeCompare(b.date));
  if (data.daily_history.length > 7) {
    data.daily_history = data.daily_history.slice(-7);
  }
}

function undoDailyHistory(data: BotDB, amount: number) {
  const today = todayStr();
  if (!data.daily_history) return;
  const entry = data.daily_history.find(d => d.date === today);
  if (entry) {
    entry.sales = Math.max(0, entry.sales - amount);
    entry.orders = Math.max(0, entry.orders - 1);
  }
}

// ─── Admin Identifier ──────────────────────────────────────────────────────────

function getAdminId(msg: TgMessage): string {
  if (msg.from?.username) return `@${msg.from.username}`;
  if (msg.from?.first_name) {
    const name = msg.from.last_name
      ? `${msg.from.first_name} ${msg.from.last_name}`
      : msg.from.first_name;
    return name;
  }
  return `User${msg.from?.id ?? "unknown"}`;
}

function ensureAdmin(data: BotDB, adminId: string): AdminStats {
  if (!data.admins[adminId]) {
    data.admins[adminId] = { sales: 0, orders: 0, today_sales: 0, today_orders: 0, last_date: "" };
  }
  const today = todayStr();
  if (data.admins[adminId].last_date !== today) {
    data.admins[adminId].today_sales = 0;
    data.admins[adminId].today_orders = 0;
    data.admins[adminId].last_date = today;
  }
  return data.admins[adminId];
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

const DAY_LABELS: Record<number, string> = {
  0: "อา", 1: "จ", 2: "อ", 3: "พ", 4: "พฤ", 5: "ศ", 6: "ส",
};

function buildGrowthChart(history: DailyEntry[]): string {
  if (!history || history.length === 0) return "";

  const maxSales = Math.max(...history.map(d => d.sales), 1);
  const BAR_MAX = 8;

  const lines: string[] = [
    `\n━━━━━━━━━━━━━━━━━\n`,
    `📊 *ยอดขาย 7 วันที่ผ่านมา*\n`,
  ];

  for (const entry of history) {
    const dateObj = new Date(`${entry.date}T12:00:00+07:00`);
    const dow = dateObj.getDay();
    const label = DAY_LABELS[dow] ?? "??";
    const isToday = entry.date === todayStr();

    const barLen = Math.round((entry.sales / maxSales) * BAR_MAX);
    const bar = "🟩".repeat(barLen) || "▫️";
    const salesStr = esc(num(entry.sales));
    const todayTag = isToday ? " \\(วันนี้\\)" : "";

    const dayPad = label.length <= 1 ? `${label} ` : label;
    lines.push(`\`${dayPad}\` ${bar} \`${salesStr}฿\`${todayTag}`);
  }

  return lines.join("\n");
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

const TOPIC_ID = 190;

async function sendMessage(chatId: number, text: string, parseMode = "MarkdownV2") {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        message_thread_id: TOPIC_ID,
      }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to send Telegram message");
  }
}

async function sendMessageWithKeyboard(
  chatId: number,
  text: string,
  inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>,
  parseMode = "MarkdownV2",
) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        message_thread_id: TOPIC_ID,
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to send Telegram keyboard message");
  }
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to answer callback query");
  }
}

async function editMessageText(chatId: number, messageId: number, text: string, parseMode = "MarkdownV2") {
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: parseMode }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to edit Telegram message");
  }
}

// ─── Dashboard Builder ──────────────────────────────────────────────────────────

function buildAdminSection(admins: { [key: string]: AdminStats }): string {
  const entries = Object.entries(admins).filter(([, s]) => s.sales > 0 || s.orders > 0);
  if (entries.length === 0) return "";

  entries.sort(([, a], [, b]) => b.sales - a.sales);

  const lines = [`\n━━━━━━━━━━━━━━━━━\n`, `👥 *ฝีมือแอดมิน*\n`];
  entries.forEach(([name, stats], i) => {
    const prefix = i === entries.length - 1 ? "└" : "├";
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    lines.push(
      `${prefix} ${medal} ${esc(name)}`,
      `   💵 รอบนี้: \`${num(stats.sales)}\` บาท \\(${stats.orders} ออร์เดอร์\\)`,
      `   📅 วันนี้: \`${num(stats.today_sales)}\` บาท \\(${stats.today_orders} ออร์เดอร์\\)`,
    );
  });
  return lines.join("\n");
}

function buildDashboard(data: BotDB): string {
  const { total_sales, total_orders, weekly_target, today_sales, today_orders } = data;
  const remaining = weekly_target - total_sales;
  const pct = weekly_target > 0 ? Math.min(Math.floor((total_sales / weekly_target) * 100), 100) : 0;
  const bar = progressBar(pct);
  const date = todayDisplay();

  const targetLine = total_sales >= weekly_target
    ? `🎉 *TARGET ACHIEVED\\!* 🎊 ยอดเกินเป้า \\+${esc(num(total_sales - weekly_target))} บาท\\!`
    : `🎯 เหลืออีก \`${num(remaining)}\` บาท จะถึงเป้า`;

  const adminSection = buildAdminSection(data.admins);
  const chartSection = buildGrowthChart(data.daily_history ?? []);

  return [
    `🍆 *\\=\\= EGGPLANT ASSISTANT \\=\\=* 🍆\n`,
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
    adminSection,
    chartSection,
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

async function handleMyStats(msg: TgMessage) {
  const adminId = getAdminId(msg);
  const data = loadDB();
  const stats = data.admins[adminId];

  if (!stats || (stats.sales === 0 && stats.orders === 0)) {
    await sendMessage(msg.chat.id,
      `📊 *ยอดของคุณ \\(${esc(adminId)}\\)*\n\nยังไม่มีข้อมูลยอดขาย\\!\nลองพิมพ์ \`นับ500\` เพื่อเริ่มต้น`,
    );
    return;
  }

  const entries = Object.entries(data.admins).filter(([, s]) => s.sales > 0);
  entries.sort(([, a], [, b]) => b.sales - a.sales);
  const rank = entries.findIndex(([k]) => k === adminId) + 1;
  const medals = ["🥇", "🥈", "🥉"];
  const medal = rank <= 3 ? medals[rank - 1] : `#${rank}`;

  const avg = stats.orders > 0 ? Math.floor(stats.sales / stats.orders) : 0;

  const text = [
    `📊 *ยอดของคุณ ${medal}*`,
    `👤 ${esc(adminId)}\n`,
    `━━━━━━━━━━━━━━━━━\n`,
    `📅 *วันนี้*`,
    `├ 💵 ยอด: \`${num(stats.today_sales)}\` บาท`,
    `└ 📦 ออร์เดอร์: \`${stats.today_orders}\` รายการ\n`,
    `🗓 *รอบนี้รวม*`,
    `├ 💰 ยอดสะสม: \`${num(stats.sales)}\` บาท`,
    `├ ✅ ออร์เดอร์: \`${stats.orders}\` รายการ`,
    `└ 📐 เฉลี่ย: \`${num(avg)}\` บาท/ออร์เดอร์\n`,
    `━━━━━━━━━━━━━━━━━`,
    `🏆 อันดับของคุณในทีม: ${medal} อันดับที่ ${rank}`,
  ].join("\n");
  await sendMessage(msg.chat.id, text);
}

async function handleHow(msg: TgMessage) {
  const text = [
    `🍆 *EGGPLANT BOT — Quick Ref*\n`,
    `นับยอด: พิมพ์ \`นับ500\` \`นับ1200\`\n`,
    `━━━━━━━━━━━━━━━━━`,
    `/status — แดชบอร์ดรวม \\+ กราฟ 7 วัน`,
    `/today — ยอดวันนี้`,
    `/mystats — ยอดของฉัน`,
    `/settarget 8000 — ตั้งเป้า`,
    `/undo — ยกเลิกครั้งล่าสุด`,
    `/note ข้อความ — บันทึกโน้ต`,
    `/notes — ดูโน้ตทั้งหมด`,
    `/delnote 1 — ลบโน้ตที่ 1`,
    `/clearnotes — ลบโน้ตทั้งหมด`,
    `/broadcast ข้อความ — ประกาศ`,
    `/reset — รีเซ็ตยอดใหม่`,
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
  const { amount, admin: lastAdmin } = data.last_entry;
  data.total_sales  = Math.max(0, data.total_sales - amount);
  data.total_orders = Math.max(0, data.total_orders - 1);
  data.today_sales  = Math.max(0, data.today_sales - amount);
  data.today_orders = Math.max(0, data.today_orders - 1);

  if (lastAdmin && data.admins[lastAdmin]) {
    data.admins[lastAdmin].sales  = Math.max(0, data.admins[lastAdmin].sales - amount);
    data.admins[lastAdmin].orders = Math.max(0, data.admins[lastAdmin].orders - 1);
    data.admins[lastAdmin].today_sales  = Math.max(0, data.admins[lastAdmin].today_sales - amount);
    data.admins[lastAdmin].today_orders = Math.max(0, data.admins[lastAdmin].today_orders - 1);
  }

  undoDailyHistory(data, amount);
  data.last_entry = null;
  saveDB(data);
  await sendMessage(msg.chat.id,
    `↩️ *ยกเลิกรายการล่าสุดแล้ว\\!*\n\n` +
    `🗑 ลบออก: \`${num(amount)}\` บาท${lastAdmin ? ` \\(${esc(lastAdmin)}\\)` : ""}\n` +
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
    await sendMessage(msg.chat.id, "📒 ยังไม่มีโน้ต\nพิมพ์ `/note ข้อความ` เพื่อเพิ่ม", "Markdown");
    return;
  }
  const lines = [`📒 *โน้ต \\(${data.notes.length} รายการ\\)*\n━━━━━━━━━━━━━━━━━\n`];
  [...data.notes].reverse().forEach((n, i) => {
    lines.push(`${i + 1}\\. 🕐 _${esc(n.time)}_\n   📌 ${esc(n.text)}\n`);
  });
  lines.push(`━━━━━━━━━━━━━━━━━\n_ลบ: /delnote 1  ล้างทั้งหมด: /clearnotes_`);
  await sendMessage(msg.chat.id, lines.join("\n"));
}

async function handleDelNote(msg: TgMessage, args: string) {
  const n = parseInt(args.trim(), 10);
  const data = loadDB();
  const total = data.notes.length;
  if (isNaN(n) || n < 1 || n > total) {
    await sendMessage(msg.chat.id,
      total === 0
        ? "📒 ยังไม่มีโน้ต"
        : `❌ ใส่ตัวเลข 1–${total} เช่น \`/delnote 1\``,
      "Markdown"
    );
    return;
  }
  const realIdx = total - n;
  const removed = data.notes.splice(realIdx, 1)[0];
  saveDB(data);
  await sendMessage(msg.chat.id,
    `🗑 *ลบโน้ตแล้ว\\!*\n\n📌 ${esc(removed.text)}\n\nเหลือโน้ต ${data.notes.length} รายการ`
  );
}

// ─── Two-Step Confirmation: ClearNotes ─────────────────────────────────────────

async function handleClearNotes(msg: TgMessage) {
  const data = loadDB();
  const count = data.notes.length;
  if (count === 0) {
    await sendMessage(msg.chat.id, "📒 ไม่มีโน้ตให้ลบ", "Markdown");
    return;
  }
  await sendMessageWithKeyboard(
    msg.chat.id,
    `⚠️ *ยืนยันการลบโน้ต*\n\nคุณแน่ใจหรือไม่ที่จะลบโน้ตทั้งหมด *${count} รายการ*?\nการกระทำนี้ไม่สามารถย้อนกลับได้`,
    [[
      { text: "✅ Yes, Confirm", callback_data: "confirm_clearnotes" },
      { text: "❌ No, Cancel", callback_data: "cancel_clearnotes" },
    ]],
  );
}

// ─── Two-Step Confirmation: Reset ──────────────────────────────────────────────

async function handleReset(msg: TgMessage) {
  await sendMessageWithKeyboard(
    msg.chat.id,
    `⚠️ *ยืนยันการรีเซ็ต*\n\nคุณแน่ใจหรือไม่ที่จะรีเซ็ตยอดขายและออร์เดอร์ทั้งหมด?\nเป้าหมายจะยังคงอยู่ แต่ยอดขายและออร์เดอร์จะถูกตั้งเป็น 0`,
    [[
      { text: "✅ Yes, Confirm", callback_data: "confirm_reset" },
      { text: "❌ No, Cancel", callback_data: "cancel_reset" },
    ]],
  );
}

// ─── Callback Query Handler ─────────────────────────────────────────────────────

async function handleCallbackQuery(cbq: TgCallbackQuery) {
  const { id: cbqId, message, data: cbData } = cbq;
  const chatId = message.chat.id;
  const msgId = message.message_id;

  if (cbData === "confirm_reset") {
    const db = loadDB();
    const target = db.weekly_target;
    db.total_sales  = 0;
    db.total_orders = 0;
    db.today_sales  = 0;
    db.today_orders = 0;
    db.last_entry   = null;
    db.admins       = {};
    saveDB(db);
    await answerCallbackQuery(cbqId, "✅ รีเซ็ตสำเร็จ!");
    await editMessageText(chatId, msgId,
      `🔄 *รีเซ็ตสำเร็จ\\!* เริ่มรอบสัปดาห์ใหม่\n\n` +
      `💰 ยอดขาย: \`0\` บาท\n` +
      `📦 ออร์เดอร์: \`0\` รายการ\n` +
      `👥 ยอดแอดมินทุกคน: รีเซ็ตแล้ว\n` +
      `🎯 เป้าหมายยังคงอยู่ที่: \`${num(target)}\` บาท\n\n` +
      `💪 มาลุยกัน\\! สัปดาห์นี้ต้องปิดให้ได้\\!`
    );
  } else if (cbData === "cancel_reset") {
    await answerCallbackQuery(cbqId, "❌ ยกเลิกแล้ว");
    await editMessageText(chatId, msgId, `❌ *ยกเลิกการรีเซ็ต* — ข้อมูลยังคงเดิม`);
  } else if (cbData === "confirm_clearnotes") {
    const db = loadDB();
    const count = db.notes.length;
    db.notes = [];
    saveDB(db);
    await answerCallbackQuery(cbqId, "✅ ลบโน้ตแล้ว!");
    await editMessageText(chatId, msgId,
      `🗑 *ลบโน้ตทั้งหมด ${count} รายการแล้ว\\!*`
    );
  } else if (cbData === "cancel_clearnotes") {
    await answerCallbackQuery(cbqId, "❌ ยกเลิกแล้ว");
    await editMessageText(chatId, msgId, `❌ *ยกเลิกการลบโน้ต* — โน้ตยังคงอยู่`);
  }
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

  const adminId = getAdminId(msg);
  const data = loadDB();

  data.total_sales  += amount;
  data.total_orders += 1;
  data.today_sales  += amount;
  data.today_orders += 1;
  data.last_entry = { amount, admin: adminId };

  const adminStats = ensureAdmin(data, adminId);
  adminStats.sales  += amount;
  adminStats.orders += 1;
  adminStats.today_sales  += amount;
  adminStats.today_orders += 1;

  updateDailyHistory(data, amount);
  saveDB(data);

  const { total_sales, total_orders, today_orders, weekly_target } = data;
  const remaining = weekly_target - total_sales;
  const pct = weekly_target > 0 ? Math.min(Math.floor((total_sales / weekly_target) * 100), 100) : 100;

  const statusLine = total_sales >= weekly_target
    ? `🎉 *TARGET ACHIEVED\\!* ปิดเป้าแล้ว\\!`
    : `🎯 เหลืออีก \`${num(remaining)}\` บาท \\(${pct}%\\)`;

  const text =
    `💰 *\\+${esc(num(amount))} บาท* บันทึกแล้ว\\!\n` +
    `👤 โดย: ${esc(adminId)}\n\n` +
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

  if (cmd === "/start" || cmd === "/status" || cmd === "/dashboard" || cmd === "/st")
    return handleStatus(msg);
  if (cmd === "/today")     return handleToday(msg);
  if (cmd === "/mystats")   return handleMyStats(msg);
  if (cmd === "/how")       return handleHow(msg);
  if (cmd === "/settarget") return handleSetTarget(msg, args);
  if (cmd === "/undo")      return handleUndo(msg);
  if (cmd === "/note")      return handleNote(msg, args);
  if (cmd === "/notes")     return handleNotes(msg);
  if (cmd === "/delnote")   return handleDelNote(msg, args);
  if (cmd === "/clearnotes") return handleClearNotes(msg);
  if (cmd === "/reset")     return handleReset(msg);
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

// ─── API Routes ─────────────────────────────────────────────────────────────────

router.get("/bot-status", (_req, res) => {
  try {
    const data = loadDB();
    res.json({
      total_sales: data.total_sales,
      total_orders: data.total_orders,
      weekly_target: data.weekly_target,
      today_sales: data.today_sales,
      today_orders: data.today_orders,
      admins: data.admins,
      daily_history: data.daily_history,
    });
  } catch {
    res.status(500).json({ error: "Could not read database" });
  }
});

router.post("/telegram", (req, res) => {
  res.sendStatus(200);
  const body = req.body;

  // Handle normal messages
  const message: TgMessage | undefined = body?.message ?? body?.edited_message;
  if (message?.text) {
    handleMessage(message).catch((err) => logger.error({ err }, "Error handling message"));
  }

  // Handle inline keyboard button presses
  const cbq: TgCallbackQuery | undefined = body?.callback_query;
  if (cbq?.data) {
    handleCallbackQuery(cbq).catch((err) => logger.error({ err }, "Error handling callback query"));
  }
});

export default router;
