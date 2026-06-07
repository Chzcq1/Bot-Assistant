import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BotDB {
  total_sales: number;
  total_orders: number;
  weekly_target: number;
  today_sales: number;
  today_orders: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function progressBar(pct: number) {
  const filled = Math.min(Math.floor(pct / 10), 10);
  return "🟩".repeat(filled) + "⬜".repeat(10 - filled);
}

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [db, setDb] = useState<BotDB | null>(null);
  const [lastCheck, setLastCheck] = useState<string>("");

  async function check() {
    try {
      const [hRes, dbRes] = await Promise.all([
        fetch(`${BASE}/api/healthz`),
        fetch(`${BASE}/api/bot-status`),
      ]);
      setOnline(hRes.ok);
      if (dbRes.ok) setDb(await dbRes.json());
    } catch {
      setOnline(false);
    }
    setLastCheck(new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" }));
  }

  useEffect(() => {
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const pct = db && db.weekly_target > 0
    ? Math.min(Math.floor((db.total_sales / db.weekly_target) * 100), 100)
    : 0;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', sans-serif", padding: "24px",
    }}>
      <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 64, marginBottom: 8 }}>🍆</div>
          <h1 style={{ color: "#fff", fontSize: 28, fontWeight: 700, margin: 0 }}>
            Eggplant Assistant
          </h1>
          <p style={{ color: "#94a3b8", fontSize: 14, margin: "8px 0 0" }}>
            Telegram Sales Bot
          </p>
        </div>

        {/* Status Card */}
        <div style={{
          background: "rgba(255,255,255,0.07)", borderRadius: 16,
          padding: "24px", marginBottom: 16, backdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 12, height: 12, borderRadius: "50%",
              background: online === null ? "#94a3b8" : online ? "#22c55e" : "#ef4444",
              boxShadow: online ? "0 0 8px #22c55e" : "none",
            }} />
            <span style={{ color: "#fff", fontWeight: 600, fontSize: 18 }}>
              {online === null ? "กำลังตรวจสอบ..." : online ? "บอทออนไลน์ ✅" : "บอทออฟไลน์ ❌"}
            </span>
          </div>
          {lastCheck && (
            <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>
              อัปเดตล่าสุด: {lastCheck}
            </p>
          )}
        </div>

        {/* Stats Cards */}
        {db && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div style={{
                background: "rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 12px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>💵 ยอดรวมรอบนี้</div>
                <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
                  ฿{fmt(db.total_sales)}
                </div>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 12px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>✅ ออร์เดอร์รวม</div>
                <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
                  {db.total_orders} รายการ
                </div>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 12px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>📅 ยอดวันนี้</div>
                <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
                  ฿{fmt(db.today_sales)}
                </div>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px 12px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}>
                <div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>📦 ออร์เดอร์วันนี้</div>
                <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
                  {db.today_orders} รายการ
                </div>
              </div>
            </div>

            {/* Progress */}
            <div style={{
              background: "rgba(255,255,255,0.07)", borderRadius: 12, padding: "16px",
              border: "1px solid rgba(255,255,255,0.1)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>🏁 เป้าหมายรอบนี้</span>
                <span style={{ color: "#fff", fontWeight: 600 }}>฿{fmt(db.weekly_target)}</span>
              </div>
              <div style={{ fontSize: 18, letterSpacing: 2, marginBottom: 6 }}>
                {progressBar(pct)}
              </div>
              <div style={{ color: pct >= 100 ? "#22c55e" : "#f59e0b", fontWeight: 600, fontSize: 14 }}>
                {pct >= 100
                  ? "🎉 ถึงเป้าหมายแล้ว!"
                  : `${pct}% — เหลืออีก ฿${fmt(db.weekly_target - db.total_sales)}`}
              </div>
            </div>
          </>
        )}

        <p style={{ color: "#334155", fontSize: 12, marginTop: 24 }}>
          หน้านี้อัปเดตอัตโนมัติทุก 30 วินาที
        </p>
      </div>
    </div>
  );
}
