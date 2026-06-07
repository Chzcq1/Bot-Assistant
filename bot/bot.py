import telebot
from telebot import types
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
TOPIC_ID = 190

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
    "admins": {},
    "daily_history": [],
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

# ─── Daily History Helpers ─────────────────────────────────────────────────────

def update_daily_history(data, amount):
    today = today_str()
    history = data.setdefault("daily_history", [])
    entry = next((d for d in history if d["date"] == today), None)
    if entry:
        entry["sales"] += amount
        entry["orders"] += 1
    else:
        history.append({"date": today, "sales": amount, "orders": 1})
    history.sort(key=lambda d: d["date"])
    if len(history) > 7:
        data["daily_history"] = history[-7:]
    else:
        data["daily_history"] = history

def undo_daily_history(data, amount):
    today = today_str()
    history = data.get("daily_history", [])
    entry = next((d for d in history if d["date"] == today), None)
    if entry:
        entry["sales"] = max(0, entry["sales"] - amount)
        entry["orders"] = max(0, entry["orders"] - 1)

# ─── Formatting Helpers ────────────────────────────────────────────────────────

def esc(text):
    special = r'\_*[]()~`>#+=|{}.!-'
    return "".join(("\\" + c if c in special else c) for c in str(text))

def num(n):
    return f"{float(n):,.0f}"

def progress_bar(pct, length=10):
    filled = int(min(pct, 100) / (100 / length))
    return "🟩" * filled + "⬜" * (length - filled)

DAY_LABELS = {0: "อา", 1: "จ", 2: "อ", 3: "พ", 4: "พฤ", 5: "ศ", 6: "ส"}

def build_growth_chart(history):
    if not history:
        return ""
    max_sales = max((d["sales"] for d in history), default=1) or 1
    BAR_MAX = 8
    lines = ["\n━━━━━━━━━━━━━━━━━\n", "📊 *ยอดขาย 7 วันที่ผ่านมา*\n"]
    today = today_str()
    for entry in history:
        date_obj = datetime.strptime(entry["date"], "%Y-%m-%d")
        dow = date_obj.weekday()  # Monday=0
        # Convert: Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6, Sun=0 (Python weekday Mon=0)
        tg_dow = (dow + 1) % 7  # shift so Sun=0, Mon=1 ... Sat=6
        label = DAY_LABELS.get(tg_dow, "??")
        is_today = entry["date"] == today
        bar_len = round((entry["sales"] / max_sales) * BAR_MAX)
        bar = "🟩" * bar_len if bar_len > 0 else "▫️"
        today_tag = " \\(วันนี้\\)" if is_today else ""
        label_pad = label if len(label) > 1 else label + " "
        lines.append(f"`{label_pad}` {bar} `{esc(num(entry['sales']))}฿`{today_tag}")
    return "\n".join(lines)

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
    chart         = build_growth_chart(data.get("daily_history", []))

    if total_sales >= target:
        target_line = f"🎉 *TARGET ACHIEVED\\!* 🎊 ยอดเกินเป้า \\+{esc(num(total_sales - target))} บาท\\!"
    else:
        target_line = f"🎯 เหลืออีก `{num(remaining)}` บาท จะถึงเป้า"

    return (
        f"🍆 *\\= EGGPLANT ASSISTANT \\=* 🍆\n\n"
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
        f"{target_line}"
        f"{chart}\n\n"
        f"━━━━━━━━━━━━━━━━━"
    )

# ─── Commands ──────────────────────────────────────────────────────────────────

@bot.message_handler(commands=["start", "status", "dashboard", "st"])
def cmd_status(message):
    data = load_db()
    bot.send_message(
        message.chat.id,
        build_dashboard(data),
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


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
        "📊 `/start` หรือ `/st`\n"
        "   ➜ ดูแดชบอร์ดยอดขายรวม \\+ กราฟ 7 วัน\n\n"
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
        "🗑 `/clearnotes`\n"
        "   ➜ ลบโน้ตทั้งหมด \\(มีการยืนยันก่อน\\)\n\n"
        "📢 `/broadcast ข้อความ`\n"
        "   ➜ จัดรูปแบบประกาศพร้อม copy ไปใช้\n\n"
        "🔄 `/reset`\n"
        "   ➜ รีเซ็ตยอดขายและออร์เดอร์เป็น 0 เริ่มรอบใหม่\n"
        "   \\(มีการยืนยันก่อนดำเนินการ\\)\n\n"
        "❓ `/how`\n"
        "   ➜ แสดงคู่มือการใช้งานนี้\n\n"
        "━━━━━━━━━━━━━━━━━\n"
        "💡 *ตัวอย่างการใช้งานจริง*\n"
        "ปิดออร์เดอร์ 350 บาท → พิมพ์ `นับ350`\n"
        "ปิดออร์เดอร์ 1,200 บาท → พิมพ์ `นับ1200`"
    )
    bot.send_message(
        message.chat.id, text,
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


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
    bot.send_message(
        message.chat.id, text,
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


@bot.message_handler(commands=["settarget"])
def cmd_settarget(message):
    parts = message.text.strip().split()
    if len(parts) < 2:
        bot.send_message(
            message.chat.id,
            "❌ กรุณาระบุตัวเลข เช่น `/settarget 8000`",
            parse_mode="Markdown",
            message_thread_id=TOPIC_ID,
        )
        return
    try:
        new_target = float(parts[1].replace(",", ""))
        if new_target <= 0:
            raise ValueError
    except ValueError:
        bot.send_message(
            message.chat.id,
            "❌ ตัวเลขไม่ถูกต้อง กรุณาใส่ตัวเลขที่มากกว่า 0",
            message_thread_id=TOPIC_ID,
        )
        return

    data = load_db()
    old_target = data["weekly_target"]
    data["weekly_target"] = new_target
    save_db(data)

    bot.send_message(
        message.chat.id,
        f"✅ *อัปเดตเป้าหมายสำเร็จ\\!*\n\n"
        f"📌 เป้าเก่า: `{num(old_target)}` บาท\n"
        f"🎯 เป้าใหม่: `{num(new_target)}` บาท",
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


@bot.message_handler(commands=["undo"])
def cmd_undo(message):
    data = load_db()
    last = data.get("last_entry")

    if last is None:
        bot.send_message(
            message.chat.id,
            "❌ ไม่มีรายการที่สามารถยกเลิกได้",
            message_thread_id=TOPIC_ID,
        )
        return

    amount = last["amount"]
    data["total_sales"]  = max(0, data["total_sales"] - amount)
    data["total_orders"] = max(0, data["total_orders"] - 1)
    data["today_sales"]  = max(0, data.get("today_sales", 0) - amount)
    data["today_orders"] = max(0, data.get("today_orders", 0) - 1)
    undo_daily_history(data, amount)
    data["last_entry"] = None
    save_db(data)

    bot.send_message(
        message.chat.id,
        f"↩️ *ยกเลิกรายการล่าสุดแล้ว\\!*\n\n"
        f"🗑 ลบออก: `{num(amount)}` บาท\n"
        f"💵 ยอดคงเหลือ: `{num(data['total_sales'])}` บาท\n"
        f"📦 ออร์เดอร์ที่เหลือ: `{data['total_orders']}` รายการ",
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


@bot.message_handler(commands=["note"])
def cmd_note(message):
    parts = message.text.split(None, 1)
    if len(parts) < 2 or not parts[1].strip():
        bot.send_message(
            message.chat.id,
            "❌ กรุณาใส่ข้อความ เช่น `/note ลูกค้าสั่งสินค้าพิเศษ`",
            parse_mode="Markdown",
            message_thread_id=TOPIC_ID,
        )
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

    bot.send_message(
        message.chat.id,
        f"📝 *บันทึกโน้ตแล้ว\\!*\n\n"
        f"🕐 {esc(timestamp)}\n"
        f"📌 {esc(note_text)}",
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


@bot.message_handler(commands=["notes"])
def cmd_notes(message):
    data = load_db()
    notes = data.get("notes", [])

    if not notes:
        bot.send_message(
            message.chat.id,
            "📒 ยังไม่มีโน้ตที่บันทึกไว้",
            message_thread_id=TOPIC_ID,
        )
        return

    lines = ["📒 *โน้ตทั้งหมด*\n\n━━━━━━━━━━━━━━━━━\n"]
    for i, n in enumerate(reversed(notes), 1):
        lines.append(f"{i}\\. 🕐 _{esc(n['time'])}_\n   📌 {esc(n['text'])}\n")

    bot.send_message(
        message.chat.id,
        "\n".join(lines),
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


# ─── Two-Step Confirmation: /reset ─────────────────────────────────────────────

@bot.message_handler(commands=["reset"])
def cmd_reset(message):
    markup = types.InlineKeyboardMarkup()
    markup.add(
        types.InlineKeyboardButton("✅ Yes, Confirm", callback_data="confirm_reset"),
        types.InlineKeyboardButton("❌ No, Cancel",   callback_data="cancel_reset"),
    )
    bot.send_message(
        message.chat.id,
        "⚠️ *ยืนยันการรีเซ็ต*\n\n"
        "คุณแน่ใจหรือไม่ที่จะรีเซ็ตยอดขายและออร์เดอร์ทั้งหมด?\n"
        "เป้าหมายจะยังคงอยู่ แต่ยอดขายและออร์เดอร์จะถูกตั้งเป็น 0",
        parse_mode="MarkdownV2",
        reply_markup=markup,
        message_thread_id=TOPIC_ID,
    )


# ─── Two-Step Confirmation: /clearnotes ────────────────────────────────────────

@bot.message_handler(commands=["clearnotes"])
def cmd_clearnotes(message):
    data = load_db()
    count = len(data.get("notes", []))
    if count == 0:
        bot.send_message(
            message.chat.id,
            "📒 ไม่มีโน้ตให้ลบ",
            message_thread_id=TOPIC_ID,
        )
        return

    markup = types.InlineKeyboardMarkup()
    markup.add(
        types.InlineKeyboardButton("✅ Yes, Confirm", callback_data="confirm_clearnotes"),
        types.InlineKeyboardButton("❌ No, Cancel",   callback_data="cancel_clearnotes"),
    )
    bot.send_message(
        message.chat.id,
        f"⚠️ *ยืนยันการลบโน้ต*\n\n"
        f"คุณแน่ใจหรือไม่ที่จะลบโน้ตทั้งหมด *{count} รายการ*?\n"
        f"การกระทำนี้ไม่สามารถย้อนกลับได้",
        parse_mode="MarkdownV2",
        reply_markup=markup,
        message_thread_id=TOPIC_ID,
    )


# ─── Callback Query Handler (inline button responses) ──────────────────────────

@bot.callback_query_handler(func=lambda call: call.data in [
    "confirm_reset", "cancel_reset", "confirm_clearnotes", "cancel_clearnotes"
])
def handle_confirmation(call):
    chat_id = call.message.chat.id
    msg_id  = call.message.message_id

    if call.data == "confirm_reset":
        data = load_db()
        target = data["weekly_target"]
        data["total_sales"]  = 0
        data["total_orders"] = 0
        data["today_sales"]  = 0
        data["today_orders"] = 0
        data["last_entry"]   = None
        data["admins"]       = {}
        save_db(data)
        bot.answer_callback_query(call.id, "✅ รีเซ็ตสำเร็จ!")
        bot.edit_message_text(
            f"🔄 *รีเซ็ตสำเร็จ\\!* เริ่มรอบสัปดาห์ใหม่\n\n"
            f"💰 ยอดขาย: `0` บาท\n"
            f"📦 ออร์เดอร์: `0` รายการ\n"
            f"👥 ยอดแอดมินทุกคน: รีเซ็ตแล้ว\n"
            f"🎯 เป้าหมายยังคงอยู่ที่: `{num(target)}` บาท\n\n"
            f"💪 มาลุยกัน\\! สัปดาห์นี้ต้องปิดให้ได้\\!",
            chat_id=chat_id,
            message_id=msg_id,
            parse_mode="MarkdownV2",
        )

    elif call.data == "cancel_reset":
        bot.answer_callback_query(call.id, "❌ ยกเลิกแล้ว")
        bot.edit_message_text(
            "❌ *ยกเลิกการรีเซ็ต* — ข้อมูลยังคงเดิม",
            chat_id=chat_id,
            message_id=msg_id,
            parse_mode="MarkdownV2",
        )

    elif call.data == "confirm_clearnotes":
        data = load_db()
        count = len(data.get("notes", []))
        data["notes"] = []
        save_db(data)
        bot.answer_callback_query(call.id, "✅ ลบโน้ตแล้ว!")
        bot.edit_message_text(
            f"🗑 *ลบโน้ตทั้งหมด {count} รายการแล้ว\\!*",
            chat_id=chat_id,
            message_id=msg_id,
            parse_mode="MarkdownV2",
        )

    elif call.data == "cancel_clearnotes":
        bot.answer_callback_query(call.id, "❌ ยกเลิกแล้ว")
        bot.edit_message_text(
            "❌ *ยกเลิกการลบโน้ต* — โน้ตยังคงอยู่",
            chat_id=chat_id,
            message_id=msg_id,
            parse_mode="MarkdownV2",
        )


@bot.message_handler(commands=["broadcast", "announce"])
def cmd_broadcast(message):
    parts = message.text.split(None, 1)
    if len(parts) < 2 or not parts[1].strip():
        bot.send_message(
            message.chat.id,
            "❌ กรุณาใส่ข้อความ เช่น `/broadcast ข้อความของคุณ`",
            parse_mode="Markdown",
            message_thread_id=TOPIC_ID,
        )
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
    bot.send_message(
        message.chat.id,
        formatted,
        parse_mode="Markdown",
        message_thread_id=TOPIC_ID,
    )


# ─── นับ[amount] Handler ───────────────────────────────────────────────────────

@bot.message_handler(func=lambda msg: msg.text and msg.text.strip().startswith("นับ"))
def handle_count(message):
    raw = message.text.strip()[3:].replace(",", "").strip()
    try:
        amount = float(raw)
        if amount <= 0:
            raise ValueError
    except ValueError:
        bot.send_message(
            message.chat.id,
            "❌ รูปแบบไม่ถูกต้อง\n\n"
            "✅ ตัวอย่างที่ถูกต้อง:\n"
            "`นับ500`\n`นับ1200`\n`นับ3500`",
            parse_mode="Markdown",
            message_thread_id=TOPIC_ID,
        )
        return

    data = load_db()
    data["total_sales"]  += amount
    data["total_orders"] += 1
    data["today_sales"]   = data.get("today_sales", 0) + amount
    data["today_orders"]  = data.get("today_orders", 0) + 1
    data["last_entry"]    = {"amount": amount}
    update_daily_history(data, amount)
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
    bot.send_message(
        message.chat.id,
        reply,
        parse_mode="MarkdownV2",
        message_thread_id=TOPIC_ID,
    )


# ─── Start ─────────────────────────────────────────────────────────────────────

print("🍆 Eggplant Assistant is running...")
bot.infinity_polling(timeout=30, long_polling_timeout=30)
