import { useEffect, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AdminStats {
  sales: number;
  orders: number;
  today_sales: number;
  today_orders: number;
}

interface BotDB {
  total_sales: number;
  total_orders: number;
  weekly_target: number;
  today_sales: number;
  today_orders: number;
  admins: { [key: string]: AdminStats };
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}

function pctOf(sales: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(Math.round((sales / target) * 100), 100);
}

const MEDALS = ["🥇", "🥈", "🥉"];
const MEDAL_COLORS = ["#ffd700", "#c0c0c0", "#cd7f32"];

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
    ? pctOf(db.total_sales, db.weekly_target)
    : 0;

  const adminEntries = db
    ? Object.entries(db.admins)
        .filter(([, s]) => s.sales > 0 || s.orders > 0)
        .sort(([, a], [, b]) => b.sales - a.sales)
    : [];

  const card = (style?: React.CSSProperties): React.CSSProperties => ({
    background: "rgba(255,255,255,0.07)",
    borderRadius: 14,
    padding: "16px",
    border: "1px solid rgba(255,255,255,0.1)",
    ...style,
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      fontFamily: "'Segoe UI', sans-serif", padding: "32px 16px",
    }}>
      <div style={{ maxWidth: 500, width: "100%", textAlign: "center" }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 60, marginBottom: 6 }}>🍆</div>
          <h1 style={{ color: "#fff", fontSize: 26, fontWeight: 700, margin: 0 }}>
            Eggplant Assistant
          </h1>
          <p style={{ color: "#94a3b8", fontSize: 13, margin: "6px 0 0" }}>Telegram Sales Bot</p>
        </div>

        {/* Online status */}
        <div style={{ ...card(), marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 6 }}>
            <div style={{
              width: 11, height: 11, borderRadius: "50%",
              background: online === null ? "#94a3b8" : online ? "#22c55e" : "#ef4444",
              boxShadow: online ? "0 0 8px #22c55e" : "none",
            }} />
            <span style={{ color: "#fff", fontWeight: 600, fontSize: 17 }}>
              {online === null ? "กำลังตรวจสอบ..." : online ? "บอทออนไลน์ ✅" : "บอทออฟไลน์ ❌"}
            </span>
          </div>
          {lastCheck && (
            <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>
              อัปเดตล่าสุด {lastCheck}
            </p>
          )}
        </div>

        {db && (
          <>
            {/* 4 stat cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              {[
                { label: "💵 ยอดรวมรอบนี้", value: `฿${fmt(db.total_sales)}` },
                { label: "✅ ออร์เดอร์รวม", value: `${db.total_orders} รายการ` },
                { label: "📅 ยอดวันนี้", value: `฿${fmt(db.today_sales)}` },
                { label: "📦 ออร์เดอร์วันนี้", value: `${db.today_orders} รายการ` },
              ].map(({ label, value }) => (
                <div key={label} style={card()}>
                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>{label}</div>
                  <div style={{ color: "#fff", fontSize: 19, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div style={{ ...card(), marginBottom: 14, textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ color: "#94a3b8", fontSize: 13 }}>🏁 เป้าหมายรอบนี้</span>
                <span style={{ color: "#fff", fontWeight: 600 }}>฿{fmt(db.weekly_target)}</span>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.1)", borderRadius: 8, height: 12, overflow: "hidden",
                marginBottom: 8,
              }}>
                <div style={{
                  height: "100%", borderRadius: 8,
                  width: `${pct}%`,
                  background: pct >= 100
                    ? "linear-gradient(90deg, #22c55e, #16a34a)"
                    : "linear-gradient(90deg, #6366f1, #8b5cf6)",
                  transition: "width 0.6s ease",
                }} />
              </div>
              <div style={{
                color: pct >= 100 ? "#22c55e" : "#a78bfa",
                fontWeight: 600, fontSize: 13, textAlign: "center",
              }}>
                {pct >= 100
                  ? "🎉 ถึงเป้าหมายแล้ว!"
                  : `${pct}% — เหลืออีก ฿${fmt(db.weekly_target - db.total_sales)}`}
              </div>
            </div>

            {/* Admin breakdown */}
            {adminEntries.length > 0 && (
              <div style={{ ...card(), textAlign: "left", marginBottom: 14 }}>
                <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginBottom: 14, textAlign: "center" }}>
                  👥 ฝีมือแอดมิน
                </div>

                {adminEntries.map(([name, stats], i) => {
                  const adminPct = db.weekly_target > 0
                    ? pctOf(stats.sales, db.weekly_target)
                    : 0;
                  const medal = MEDALS[i] ?? `#${i + 1}`;
                  const medalColor = MEDAL_COLORS[i] ?? "#94a3b8";

                  return (
                    <div key={name} style={{
                      background: "rgba(255,255,255,0.05)",
                      borderRadius: 10, padding: "12px 14px",
                      marginBottom: i < adminEntries.length - 1 ? 10 : 0,
                      border: i === 0 ? "1px solid rgba(255,215,0,0.2)" : "1px solid rgba(255,255,255,0.06)",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ color: "#fff", fontWeight: 600, fontSize: 14 }}>
                          <span style={{ color: medalColor }}>{medal}</span> {name}
                        </span>
                        <span style={{ color: "#a78bfa", fontSize: 13, fontWeight: 600 }}>
                          ฿{fmt(stats.sales)}
                        </span>
                      </div>

                      {/* mini progress */}
                      <div style={{
                        background: "rgba(255,255,255,0.08)", borderRadius: 4, height: 5, overflow: "hidden", marginBottom: 8,
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 4,
                          width: `${adminPct}%`,
                          background: i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : "#cd7f32",
                        }} />
                      </div>

                      <div style={{ display: "flex", gap: 14 }}>
                        <div>
                          <div style={{ color: "#64748b", fontSize: 10 }}>รอบนี้</div>
                          <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>
                            {stats.orders} ออร์เดอร์
                          </div>
                        </div>
                        <div>
                          <div style={{ color: "#64748b", fontSize: 10 }}>วันนี้</div>
                          <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>
                            ฿{fmt(stats.today_sales)} / {stats.today_orders} ออร์เดอร์
                          </div>
                        </div>
                        {stats.orders > 0 && (
                          <div>
                            <div style={{ color: "#64748b", fontSize: 10 }}>เฉลี่ย/ออร์เดอร์</div>
                            <div style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>
                              ฿{fmt(Math.round(stats.sales / stats.orders))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {adminEntries.length === 0 && (
              <div style={{ ...card({ padding: "20px" }), marginBottom: 14 }}>
                <div style={{ color: "#64748b", fontSize: 14 }}>
                  👥 ยังไม่มีข้อมูลแอดมิน<br/>
                  <span style={{ fontSize: 12 }}>เมื่อแอดมินพิมพ์ "นับ500" ในบอท จะแสดงที่นี่</span>
                </div>
              </div>
            )}
          </>
        )}

        <p style={{ color: "#1e293b", fontSize: 11, marginTop: 8 }}>
          อัปเดตอัตโนมัติทุก 30 วินาที
        </p>
      </div>
    </div>
  );
}
