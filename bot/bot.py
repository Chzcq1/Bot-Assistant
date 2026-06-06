import telebot
import json
import os
import random

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
]

def load_db():
    if not os.path.exists(DB_FILE):
        data = {"total_sales": 0, "total_orders": 0, "weekly_target": 6000}
        save_db(data)
        return data
    with open(DB_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_db(data):
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

def build_dashboard(data):
    total_sales = data["total_sales"]
    total_orders = data["total_orders"]
    weekly_target = data["weekly_target"]
    remaining = weekly_target - total_sales
    progress_pct = min(int((total_sales / weekly_target) * 100), 100) if weekly_target > 0 else 0

    filled = int(progress_pct / 10)
    bar = "🟩" * filled + "⬜" * (10 - filled)

    if total_sales >= weekly_target:
        target_line = f"🎉 *TARGET ACHIEVED\\!* 🎊 ยอดเกินเป้าแล้ว \\+{total_sales - weekly_target:,.0f} บาท"
    else:
        target_line = f"🎯 *เหลืออีก:* `{remaining:,.0f}` บาท"

    msg = (
        f"🍆 *\\=\\=\\= EGGPLANT ASSISTANT \\=\\=\\=* 🍆\n\n"
        f"📊 *สรุปยอดขายประจำสัปดาห์*\n"
        f"━━━━━━━━━━━━━━━━━\n\n"
        f"💵 *ยอดขายสะสม:*\n"
        f"   `{total_sales:,.0f}` บาท\n\n"
        f"✅ *ออร์เดอร์ที่ปิดสำเร็จ:*\n"
        f"   `{total_orders}` ออร์เดอร์\n\n"
        f"🏁 *เป้าหมายสัปดาห์นี้:*\n"
        f"   `{weekly_target:,.0f}` บาท\n\n"
        f"📈 *ความคืบหน้า:* `{progress_pct}%`\n"
        f"   {bar}\n\n"
        f"{target_line}\n\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"_อัปเดตล่าสุด: ยอดขายรวม {total_orders} รายการ_"
    )
    return msg

@bot.message_handler(commands=["start", "status"])
def cmd_status(message):
    data = load_db()
    bot.reply_to(message, build_dashboard(data), parse_mode="MarkdownV2")

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
        f"📌 เป้าเก่า: `{old_target:,.0f}` บาท\n"
        f"🎯 เป้าใหม่: `{new_target:,.0f}` บาท",
        parse_mode="MarkdownV2"
    )

@bot.message_handler(commands=["reset"])
def cmd_reset(message):
    data = load_db()
    target = data["weekly_target"]
    data["total_sales"] = 0
    data["total_orders"] = 0
    save_db(data)

    bot.reply_to(
        message,
        f"🔄 *รีเซ็ตสำเร็จ\\!* เริ่มรอบสัปดาห์ใหม่\n\n"
        f"💰 ยอดขาย: `0` บาท\n"
        f"📦 ออร์เดอร์: `0` รายการ\n"
        f"🎯 เป้าหมายยังคงอยู่ที่: `{target:,.0f}` บาท\n\n"
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
        f"✨✨✨✨✨✨✨✨✨✨\n"
        f"🍆 *ประกาศจากทีมงาน* 🍆\n"
        f"✨✨✨✨✨✨✨✨✨✨\n\n"
        f"{content}\n\n"
        f"━━━━━━━━━━━━━━━━━\n"
        f"💌 _ขอบคุณทุกท่านที่ติดตาม_ 🙏"
    )
    bot.reply_to(message, formatted, parse_mode="Markdown")

@bot.message_handler(func=lambda msg: True, content_types=["text"])
def handle_number(message):
    text = message.text.strip().replace(",", "")
    try:
        amount = float(text)
        if amount <= 0:
            raise ValueError
    except ValueError:
        return

    data = load_db()
    data["total_sales"] += amount
    data["total_orders"] += 1
    save_db(data)

    total_sales = data["total_sales"]
    total_orders = data["total_orders"]
    weekly_target = data["weekly_target"]
    remaining = weekly_target - total_sales
    progress_pct = min(int((total_sales / weekly_target) * 100), 100) if weekly_target > 0 else 100

    quote = random.choice(MOTIVATIONAL_QUOTES)

    if total_sales >= weekly_target:
        status_line = f"🎉 *TARGET ACHIEVED\\!* ปิดเป้าแล้ว\\!"
    else:
        status_line = f"🎯 เหลืออีก `{remaining:,.0f}` บาท \\({progress_pct}%\\)"

    amount_escaped = f"{amount:,.0f}".replace(",", "\\,")
    total_escaped = f"{total_sales:,.0f}".replace(",", "\\,")

    reply = (
        f"💰 *\\+{amount_escaped} บาท* บันทึกแล้ว\\!\n\n"
        f"📦 ออร์เดอร์ที่ {total_orders}: ✅\n"
        f"💵 ยอดรวม: `{total_escaped}` บาท\n"
        f"{status_line}\n\n"
        f"{quote}"
    )
    bot.reply_to(message, reply, parse_mode="MarkdownV2")

print("🍆 Eggplant Assistant is running...")
bot.infinity_polling(timeout=30, long_polling_timeout=30)
