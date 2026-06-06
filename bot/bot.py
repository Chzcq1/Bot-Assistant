import telebot
import json
import os
import random
import re
from datetime import datetime

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("TELEGRAM_BOT_TOKEN environment variable not set")

bot = telebot.TeleBot(BOT_TOKEN)
DB_FILE = os.path.join(os.path.dirname(__file__), "database.json")

MOTIVATIONAL_QUOTES = [
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
]

# ─── Database Helpers ──────────────────────────────────────────────────────────

DB_DEFAULT = {
    "total_sales": 0,
    "total_orders": 0,
    "weekly_target": 6000,
    "today_sales": 0,
    "today_orders": 0,
    "last_date": "",
    "last_entry": None,
    "notes": [],
}

def today_str():
    return datetime.now().strftime("%Y-%m-%d")

def load_db():
    if not os.path.exists(DB_FILE):
        save_db(dict(DB_DEFAULT))
        return dict(DB_DEFAULT)
    with open(DB_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    for k, v in DB_DEFAULT.items():
        if k not in data:
            data[k] = v
    today = today_str()
    if data.get("last_date") != today:
        data["today_sales"] = 0
        data["today_orders"] = 0
        data["last_date"] = today
        save_db(data)
    return data

def save_db(data):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

# ─── Formatting Helpers ────────────────────────────────────────────────────────

def esc(text):
    """Escape all MarkdownV2 special characters."""
    special = r'\_*[]()~`>#+=|{}.!-'
    return "".join(("\\" + c if c in special else c) for c in str(text))

def num(n):
    """Format number with Thai-style comma grouping, no decimals."""
    return f"{float(n):,.0f}"

def progress_bar(pct, length=10):
    filled = int(min(pct, 100) / (100 / length))
    return "🟩" * filled + "⬜" * (length - filled)

# ─── Dashboard Builder ─────────────────────────────────────────────────────────

def build_dashboard(data):
    total_sales   = data["total_sales"]
    total_orders  = data["total_orders"]
    target        = data["weekly_target"]
    today_sales   = data.get("today_sales", 0)
    today_orders  = data.get("today_orders", 0)
    remaining     = target - total_sales
    pct           = min(int((total_sales / target) * 100), 100) if target > 0 else 0
    bar           = progress_bar(pct)
    today_date    = datetime.now().strftime("%d/%m/%Y")

    if total_sales >= target:
        target_line = f"🎉 *TARGET ACHIEVED\\!* 🎊 ยอดเกินเป้า \\+{esc(num(total_sales - target))} บาท\\!"
    else:
        target_line = f"🎯 เหลืออีก `{num(remaining)}` บาท จะถึงเป้า"

    return (
        f"🍆 *\\=\\= EGGPLANT ASSISTANT \\=\\=* 🍆\n\n"
        f"📅 *วันนี้ {esc(today_date)}*\n"
        f"├ 💵 ยอดวันนี้: `{num(today_sales)}` บาท\n"
        f"└ 📦 ปิดวันนี้: `{today_orders}` ออร์เดอร์\n\n"
        f"━━━━━━━━━━━━━━━━━\n\n"
        f"📊 *รวมทั้งหมดรอบนี้*\n"
        f"├ 💰 ยอดขายสะสม: `{num(total_sales)}` บาท\n"
        f"├ ✅ ออร์เดอร์ปิดแล้ว: `{total_orders}` รายการ\n"
        f"└ 🏁 เป้าหมาย: `{num(target)}` บาท\n\n"
        f"📈 ความคืบหน้า: `{pct}%`\n"
        f"{bar}\n\n"
        f"{target_line}\n\n"
        f"━━━━━━━━━━━━━━━━━"
    )

# ─── Commands ──────────────────────────────────────────────────────────────────

@bot.message_handler(commands=["start", "status"])
def cmd_status(message):
    data = load_db()
    bot.reply_to(message, build_dashboard(data), parse_mode="MarkdownV2")


@bot.message_handler(commands=["how"])
def cmd_how(message):
    text = (
        "🍆 *EGGPLANT ASSISTANT — คู่มือการใช้งาน*\n\n"
        "━━━━━━━━━━━━━━━━━\n\n"
        "📌 *วิธีนับยอดขาย*\n"
        "พิมพ์ `นับ` ตามด้วยตัวเลข เช่น:\n"
        "`นับ500` หรือ `นับ1200`\n"
        "บอทจะบวกยอดเข้าระบบและเพิ่มออร์เดอร์ 1 รายการทันที\n\n"
        "━━━━━━━━━━━━━━━━━\n\n"
        "📋 *รายการคำสั่งทั้งหมด*\n\n"
        "📊 `/start` หรือ `/status`\n"
        "   ➜ ดูแดชบอร์ดยอดขายรวม\n\n"
        "📅 `/today`\n"
        "   ➜ ดูสรุปยอดขายเฉพาะวันนี้\n\n"
        "🎯 `/settarget 8000`\n"
        "   ➜ ตั้งเป้าหมายใหม่ ใส่ตัวเลขจำนวนเงิน\n\n"
        "↩️ `/undo`\n"
        "   ➜ ยกเลิกการนับครั้งล่าสุด ✅\n\n"
        "📝 `/note ข้อความ`\n"
        "   ➜ บันทึกโน้ตหรือหมายเหตุ เช่น สินค้าพิเศษ\n\n"
        "📒 `/notes`\n"
        "   ➜ ดูโน้ตทั้งหมดที่บันทึกไว้\n\n"
        "📢 `/broadcast ข้อความ`\n"
        "   ➜ จัดรูปแบบประกาศพร้อม copy ไปใช้\n\n"
        "🔄 `/reset`\n"
        "   ➜ รีเซ็ตยอดขายและออร์เดอร์เป็น 0 เริ่มรอบใหม่\n"
        "   \\(เป้าหมายยังคงเดิม\\)\n\n"
        "❓ `/how`\n"
        "   ➜ แสดงคู่มือการใช้งานนี้\n\n"
        "━━━━━━━━━━━━━━━━━\n"
        "💡 *ตัวอย่างการใช้งานจริง*\n"
        "ปิดออร์เดอร์ 350 บาท → พิมพ์ `นับ350`\n"
        "ปิดออร์เดอร์ 1,200 บาท → พิมพ์ `นับ1200`"
    )
    bot.reply_to(message, text, parse_mode="MarkdownV2")


@bot.message_handler(commands=["today"])
def cmd_today(message):
    data = load_db()
    today_sales  = data.get("today_sales", 0)
    today_orders = data.get("today_orders", 0)
    target       = data["weekly_target"]
    today_date   = datetime.now().strftime("%d/%m/%Y")

    avg = (today_sales / today_orders) if today_orders > 0 else 0

    text = (
        f"📅 *สรุปยอดขายวันนี้ {esc(today_date)}*\n\n"
        f"💵 ยอดรวมวันนี้: `{num(today_sales)}` บาท\n"
        f"📦 ออร์เดอร์วันนี้: `{today_orders}` รายการ\n"
        f"📐 เฉลี่ยต่อออร์เดอร์: `{num(avg)}` บาท\n\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"🏁 เป้าหมายรอบนี้: `{num(target)}` บาท\n"
        f"💰 ยอดสะสมรอบนี้: `{num(data['total_sales'])}` บาท\n"
        f"✅ ออร์เดอร์รวมรอบนี้: `{data['total_orders']}` รายการ"
    )
    bot.reply_to(message, text, parse_mode="MarkdownV2")


@bot.message_handler(commands=["settarget"])
def cmd_settarget(message):
    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.reply_to(message, "❌ กรุณาระบุตัวเลข เช่น `/settarget 8000`", parse_mode="Markdown")
        return
    try:
        new_target = float(parts[1].replace(",", ""))
        if new_target <= 0:
            raise ValueError
    except ValueError:
        bot.reply_to(message, "❌ ตัวเลขไม่ถูกต้อง กรุณาใส่ตัวเลขที่มากกว่า 0")
        return

    data = load_db()
    old_target = data["weekly_target"]
    data["weekly_target"] = new_target
    save_db(data)

    bot.reply_to(
        message,
        f"✅ *อัปเดตเป้าหมายสำเร็จ\\!*\n\n"
        f"📌 เป้าเก่า: `{num(old_target)}` บาท\n"
        f"🎯 เป้าใหม่: `{num(new_target)}` บาท",
        parse_mode="MarkdownV2"
    )


@bot.message_handler(commands=["undo"])
def cmd_undo(message):
    data = load_db()
    last = data.get("last_entry")

    if last is None:
        bot.reply_to(message, "❌ ไม่มีรายการที่สามารถยกเลิกได้")
        return

    amount = last["amount"]
    data["total_sales"]  = max(0, data["total_sales"] - amount)
    data["total_orders"] = max(0, data["total_orders"] - 1)
    data["today_sales"]  = max(0, data.get("today_sales", 0) - amount)
    data["today_orders"] = max(0, data.get("today_orders", 0) - 1)
    data["last_entry"] = None
    save_db(data)

    bot.reply_to(
        message,
        f"↩️ *ยกเลิกรายการล่าสุดแล้ว\\!*\n\n"
        f"🗑 ลบออก: `{num(amount)}` บาท\n"
        f"💵 ยอดคงเหลือ: `{num(data['total_sales'])}` บาท\n"
        f"📦 ออร์เดอร์ที่เหลือ: `{data['total_orders']}` รายการ",
        parse_mode="MarkdownV2"
    )


@bot.message_handler(commands=["note"])
def cmd_note(message):
    parts = message.text.split(None, 1)
    if len(parts) < 2 or not parts[1].strip():
        bot.reply_to(message, "❌ กรุณาใส่ข้อความ เช่น `/note ลูกค้าสั่งสินค้าพิเศษ`", parse_mode="Markdown")
        return

    note_text = parts[1].strip()
    data = load_db()
    if "notes" not in data:
        data["notes"] = []

    timestamp = datetime.now().strftime("%d/%m %H:%M")
    data["notes"].append({"text": note_text, "time": timestamp})
    if len(data["notes"]) > 20:
        data["notes"] = data["notes"][-20:]
    save_db(data)

    bot.reply_to(
        message,
        f"📝 *บันทึกโน้ตแล้ว\\!*\n\n"
        f"🕐 {esc(timestamp)}\n"
        f"📌 {esc(note_text)}",
        parse_mode="MarkdownV2"
    )


@bot.message_handler(commands=["notes"])
def cmd_notes(message):
    data = load_db()
    notes = data.get("notes", [])

    if not notes:
        bot.reply_to(message, "📒 ยังไม่มีโน้ตที่บันทึกไว้")
        return

    lines = ["📒 *โน้ตทั้งหมด*\n\n━━━━━━━━━━━━━━━━━\n"]
    for i, n in enumerate(reversed(notes), 1):
        lines.append(f"{i}\\. 🕐 _{esc(n['time'])}_\n   📌 {esc(n['text'])}\n")

    bot.reply_to(message, "\n".join(lines), parse_mode="MarkdownV2")


@bot.message_handler(commands=["reset"])
def cmd_reset(message):
    data = load_db()
    target = data["weekly_target"]
    data["total_sales"]  = 0
    data["total_orders"] = 0
    data["today_sales"]  = 0
    data["today_orders"] = 0
    data["last_entry"]   = None
    save_db(data)

    bot.reply_to(
        message,
        f"🔄 *รีเซ็ตสำเร็จ\\!* เริ่มรอบสัปดาห์ใหม่\n\n"
        f"💰 ยอดขาย: `0` บาท\n"
        f"📦 ออร์เดอร์: `0` รายการ\n"
        f"🎯 เป้าหมายยังคงอยู่ที่: `{num(target)}` บาท\n\n"
        f"💪 มาลุยกัน\\! สัปดาห์นี้ต้องปิดให้ได้\\!",
        parse_mode="MarkdownV2"
    )


@bot.message_handler(commands=["broadcast", "announce"])
def cmd_broadcast(message):
    parts = message.text.split(None, 1)
    if len(parts) < 2 or not parts[1].strip():
        bot.reply_to(message, "❌ กรุณาใส่ข้อความ เช่น `/broadcast ข้อความของคุณ`", parse_mode="Markdown")
        return

    content = parts[1].strip()
    formatted = (
        "✨✨✨✨✨✨✨✨✨✨\n"
        "🍆 *ประกาศจากทีมงาน* 🍆\n"
        "✨✨✨✨✨✨✨✨✨✨\n\n"
        f"{content}\n\n"
        "━━━━━━━━━━━━━━━━━\n"
        "💌 _ขอบคุณทุกท่านที่ติดตาม_ 🙏"
    )
    bot.reply_to(message, formatted, parse_mode="Markdown")


# ─── นับ[amount] Handler ───────────────────────────────────────────────────────

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().startswith("นับ"))
def handle_count(message):
    raw = message.text.strip()[3:].replace(",", "").strip()
    try:
        amount = float(raw)
        if amount <= 0:
            raise ValueError
    except ValueError:
        bot.reply_to(
            message,
            "❌ รูปแบบไม่ถูกต้อง\n\n"
            "✅ ตัวอย่างที่ถูกต้อง:\n"
            "`นับ500`\n`นับ1200`\n`นับ3500`",
            parse_mode="Markdown"
        )
        return

    data = load_db()
    data["total_sales"]  += amount
    data["total_orders"] += 1
    data["today_sales"]  = data.get("today_sales", 0) + amount
    data["today_orders"] = data.get("today_orders", 0) + 1
    data["last_entry"]   = {"amount": amount}
    save_db(data)

    total_sales   = data["total_sales"]
    total_orders  = data["total_orders"]
    today_orders  = data["today_orders"]
    target        = data["weekly_target"]
    remaining     = target - total_sales
    pct           = min(int((total_sales / target) * 100), 100) if target > 0 else 100
    quote         = random.choice(MOTIVATIONAL_QUOTES)

    if total_sales >= target:
        status_line = "🎉 *TARGET ACHIEVED\\!* ปิดเป้าแล้ว\\!"
    else:
        status_line = f"🎯 เหลืออีก `{num(remaining)}` บาท \\({pct}%\\)"

    reply = (
        f"💰 *\\+{esc(num(amount))} บาท* บันทึกแล้ว\\!\n\n"
        f"📦 ออร์เดอร์รอบนี้: `{total_orders}` รายการ\n"
        f"📅 ออร์เดอร์วันนี้: `{today_orders}` รายการ\n"
        f"💵 ยอดรวมรอบนี้: `{num(total_sales)}` บาท\n"
        f"{status_line}\n\n"
        f"{esc(quote)}"
    )
    bot.reply_to(message, reply, parse_mode="MarkdownV2")


# ─── Start ─────────────────────────────────────────────────────────────────────

print("🍆 Eggplant Assistant is running...")
bot.infinity_polling(timeout=30, long_polling_timeout=30)
