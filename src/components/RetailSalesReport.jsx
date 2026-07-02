// ============================================================
//  RetailSalesReport.jsx  –  직영·관계사 주유소 소매 판매 리포트
//  ERP 매출자료등록(매출거래상세) 파일 업로드 → 주유소별 판매량 집계
// ============================================================

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";
const supaHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

// ── 유종 코드 ────────────────────────────────────────────────
const YUJONG_MAP = {
  "휘발유":         "G",
  "고급휘발유":     "PG",
  "경유":           "D",
  "화물차우대":     "D",
  "공공조달(경유)": "D",
  "등유":           "K",
};

const YJ_COLS = ["PG", "G", "D", "K"];
const YJ_LABELS = { PG: "고급휘발유", G: "휘발유", D: "경유", K: "등유" };
const YJ_COLORS = { PG: "#7c3aed", G: "#2563eb", D: "#059669", K: "#ea580c" };

// ── 관계사 주유소 키워드 매핑 ────────────────────────────────
const RETAIL_STATIONS = [
  { keywords: ["세영tms 통일로", "통일로일품"],          name: "통일로일품주유소", group: "세영TMS"   },
  { keywords: ["엘엔케이토탈 용인", "용인제1주유소"],     name: "용인1주유소",     group: "엘앤케이"  },
  { keywords: ["김포제2주유소"],                         name: "김포2주유소",     group: "엘앤케이"  },
  { keywords: ["세일온산주유소", "온산주유소(계열)"],     name: "온산주유소",      group: "세일계열"  },
  { keywords: ["남부순환로주유소"],                       name: "남부순환로주유소", group: "세영TMS"  },
  { keywords: ["박달주유소"],                            name: "박달주유소",      group: "세일직영"  },
  { keywords: ["안양주유소"],                            name: "안양주유소",      group: "세일직영"  },
  { keywords: ["광교주유소"],                            name: "광교주유소",      group: "세일직영"  },
];

const GROUP_COLORS = {
  "세일직영": "#2563eb",
  "엘앤케이":  "#059669",
  "세영TMS":   "#d97706",
  "세일계열":  "#7c3aed",
};

function matchStation(maechulName) {
  const s = (maechulName || "").toLowerCase();
  return RETAIL_STATIONS.find(st => st.keywords.some(k => s.includes(k))) || null;
}

// ── ERP 매출거래상세 파싱 ────────────────────────────────────
// 형식: row0=제목, row2=기간, row3=지점, row5=헤더, row6+=데이터
// col[0]=거래일자, col[7]=매출처, col[13]=거래유종, col[16]=거래수량
function parseERPFile(workbook) {
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const records = [];
  for (let i = 6; i < raw.length; i++) {
    const row = raw[i];
    const dateVal = row[0];
    const maechul = String(row[7] || "").trim();
    const yujong  = String(row[13] || "").trim();
    const qty     = parseFloat(row[16]) || 0;

    if (!dateVal || qty <= 0) continue;

    const yj = YUJONG_MAP[yujong];
    if (!yj) continue;

    const stMatch = matchStation(maechul);
    if (!stMatch) continue;

    let ds;
    if (typeof dateVal === "string")       ds = dateVal.substring(0, 10);
    else if (typeof dateVal === "number")  ds = new Date(Math.round((dateVal - 25569) * 86400 * 1000)).toISOString().substring(0, 10);
    else                                   ds = String(dateVal).substring(0, 10);

    records.push({ date: ds, station: stMatch.name, group: stMatch.group, yj, qty });
  }
  return records;
}

// ── Supabase helpers (sales_current 테이블, jiyeok="retail") ─
const SUPA_JIYEOK = "retail";

async function supaGetRecords() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sales_current?jiyeok=eq.${SUPA_JIYEOK}&select=records`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json();
    return rows.flatMap(r => r.records || []);
  } catch { return []; }
}

async function supaUpsertRecords(newRecords) {
  const existing = await supaGetRecords();
  const dates = newRecords.map(r => r.date).filter(Boolean).sort();
  if (!dates.length) return;
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  // 업로드 날짜 범위만 교체, 나머지 보존
  const preserved = existing.filter(r => r.date < minDate || r.date > maxDate);
  const merged = [...preserved, ...newRecords];

  await fetch(`${SUPABASE_URL}/rest/v1/sales_current`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ jiyeok: SUPA_JIYEOK, records: merged, updated_at: new Date().toISOString() }),
  });
}

// ── 유틸 ──────────────────────────────────────────────────────
const fmtKL = (v) => (v ? (v / 1000).toFixed(1) : "-");
const fmtL  = (v) => (v ? Math.round(v).toLocaleString() : "-");

function getMonthStr(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function RetailSalesReport() {
  const [records, setRecords]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selectedStation, setStation] = useState("전체");
  const [selectedMonth, setMonth]   = useState(getMonthStr(0));
  const [dzState, setDzState]       = useState("idle"); // idle | loading | done | error
  const [dzInfo, setDzInfo]         = useState(null);
  const [drag, setDrag]             = useState(false);

  // 초기 로드
  useEffect(() => {
    (async () => {
      setLoading(true);
      const data = await supaGetRecords();
      setRecords(data);
      if (data.length) {
        const months = [...new Set(data.map(r => r.date?.substring(0, 7)).filter(Boolean))].sort();
        setMonth(months[months.length - 1]);
      }
      setLoading(false);
    })();
  }, []);

  // 파일 처리
  const handleFile = useCallback(async (file) => {
    setDzState("loading");
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: false });
        const parsed = parseERPFile(wb);
        if (!parsed.length) {
          setDzState("error");
          return;
        }
        await supaUpsertRecords(parsed);
        const updated = await supaGetRecords();
        setRecords(updated);
        const dates = parsed.map(r => r.date).sort();
        const stationSet = [...new Set(parsed.map(r => r.station))];
        setDzInfo({
          filename: file.name,
          count:    parsed.length,
          stations: stationSet.join(", "),
          range:    `${dates[0]} ~ ${dates[dates.length - 1]}`,
        });
        setDzState("done");
        setMonth(dates[dates.length - 1].substring(0, 7));
      } catch (err) {
        console.error(err);
        setDzState("error");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // ── 필터 계산 ─────────────────────────────────────────────
  const [yr, mo] = selectedMonth.split("-").map(Number);
  const lastDay  = new Date(yr, mo, 0).getDate();
  const start    = `${selectedMonth}-01`;
  const end      = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

  const filtered = records.filter(r => {
    if (!r.date || r.date < start || r.date > end) return false;
    if (selectedStation !== "전체" && r.station !== selectedStation) return false;
    return true;
  });

  const months = [...new Set(records.map(r => r.date?.substring(0, 7)).filter(Boolean))].sort();

  // 총계
  const totals = { PG: 0, G: 0, D: 0, K: 0 };
  filtered.forEach(r => { totals[r.yj] = (totals[r.yj] || 0) + r.qty; });
  const grandTotal = YJ_COLS.reduce((s, c) => s + (totals[c] || 0), 0);

  // 전체 뷰: 주유소별 집계
  const stationTotals = {};
  if (selectedStation === "전체") {
    filtered.forEach(r => {
      if (!stationTotals[r.station]) stationTotals[r.station] = { PG:0, G:0, D:0, K:0, total:0, group: r.group };
      stationTotals[r.station][r.yj] = (stationTotals[r.station][r.yj] || 0) + r.qty;
      stationTotals[r.station].total += r.qty;
    });
  }

  // 상세 뷰: 일별 집계
  const byDate = {};
  if (selectedStation !== "전체") {
    filtered.forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = { PG:0, G:0, D:0, K:0 };
      byDate[r.date][r.yj] = (byDate[r.date][r.yj] || 0) + r.qty;
    });
  }
  const dailyRows = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));

  const stInfo  = RETAIL_STATIONS.find(s => s.name === selectedStation);
  const stColor = GROUP_COLORS[stInfo?.group] || "#2563eb";

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── 업로드 드롭존 ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => {
          e.preventDefault(); setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => document.getElementById("retail-erp-input").click()}
        style={{
          border: `2px dashed ${drag ? "#2563eb" : dzState === "done" ? "#16a34a" : "#d1d5db"}`,
          borderRadius: 12,
          padding: "20px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: dzState === "done" ? "rgba(22,163,74,0.04)" : drag ? "rgba(37,99,235,0.04)" : "#fafafa",
          marginBottom: 20,
          transition: "all 0.2s",
        }}
      >
        {dzState === "loading" && (
          <div style={{ color: "#9ca3af", fontSize: 13 }}>⏳ 파싱 중...</div>
        )}
        {dzState === "error" && (
          <div>
            <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 4 }}>❌ 파일 파싱 실패 또는 관계사 주유소 데이터 없음</div>
            <div style={{ color: "#9ca3af", fontSize: 11 }}>ERP 매출자료등록 파일(.xls/.xlsx)이어야 합니다. 클릭하여 다시 시도하세요.</div>
          </div>
        )}
        {dzState === "done" && dzInfo && (
          <div style={{ color: "#16a34a", fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ {dzInfo.filename}</div>
            <div style={{ marginBottom: 2 }}>{dzInfo.range} · {dzInfo.count.toLocaleString()}건</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>추출된 주유소: {dzInfo.stations}</div>
          </div>
        )}
        {dzState === "idle" && (
          <>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📂</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>ERP 매출자료등록 파일 드롭 또는 클릭</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>.xls / .xlsx · 매출거래상세 시트 · 복수 업로드 가능</div>
          </>
        )}
        <input
          id="retail-erp-input"
          type="file"
          accept=".xls,.xlsx"
          style={{ display: "none" }}
          onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
        />
      </div>

      {/* ── 필터 바 ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {/* 주유소 드롭다운 */}
        <select
          value={selectedStation}
          onChange={e => setStation(e.target.value)}
          style={{
            padding: "8px 14px", borderRadius: 10,
            border: "1.5px solid #e5e7eb", fontSize: 13,
            color: "#111827", background: "#fff", cursor: "pointer",
            minWidth: 170, appearance: "auto",
          }}
        >
          <option value="전체">전체 주유소</option>
          {["세일직영", "엘앤케이", "세영TMS", "세일계열"].map(grp => (
            <optgroup key={grp} label={grp}>
              {RETAIL_STATIONS.filter(s => s.group === grp).map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {/* 월 칩 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {months.map(m => (
            <button key={m} onClick={() => setMonth(m)} style={chipStyle(selectedMonth === m)}>
              {m.replace("-", "년 ")}월
            </button>
          ))}
        </div>
      </div>

      {/* ── 로딩 ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af", fontSize: 13 }}>
          데이터 불러오는 중...
        </div>
      )}

      {/* ── 데이터 없음 ── */}
      {!loading && records.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px", color: "#9ca3af" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 6 }}>데이터가 없습니다</div>
          <div style={{ fontSize: 13 }}>위 드롭존에 ERP 매출자료등록 파일(.xls)을 업로드해 주세요</div>
        </div>
      )}

      {/* ── 데이터 있음 ── */}
      {!loading && records.length > 0 && (
        <>
          {/* 요약 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 20 }}>
            {[
              { label: "총 판매량", value: fmtKL(grandTotal), accent: "#111827" },
              ...YJ_COLS.filter(c => totals[c] > 0).map(c => ({
                label: YJ_LABELS[c], value: fmtKL(totals[c]), accent: YJ_COLORS[c]
              })),
            ].map(c => (
              <div key={c.label} style={{
                background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb",
                padding: "14px 16px", textAlign: "center",
              }}>
                <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: c.accent }}>
                  {c.value}
                  <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af", marginLeft: 2 }}>kL</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── 전체 뷰: 주유소별 집계 테이블 ── */}
          {selectedStation === "전체" && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", fontSize: 14, fontWeight: 700, color: "#111827" }}>
                주유소별 판매량
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                  {selectedMonth.replace("-", "년 ")}월 · 단위: kL · 행 클릭 시 상세 조회
                </span>
              </div>
              {Object.keys(stationTotals).length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                  해당 월에 데이터가 없습니다
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={th("left")}>주유소</th>
                      <th style={th("left")}>그룹</th>
                      {YJ_COLS.map(c => <th key={c} style={th("right")}>{YJ_LABELS[c]}</th>)}
                      <th style={{ ...th("right"), fontWeight: 700 }}>합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stationTotals)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([name, t]) => {
                        const color = GROUP_COLORS[t.group] || "#6b7280";
                        return (
                          <tr
                            key={name}
                            onClick={() => setStation(name)}
                            style={{ cursor: "pointer" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#f8faff"}
                            onMouseLeave={e => e.currentTarget.style.background = ""}
                          >
                            <td style={{ ...td("left"), fontWeight: 600, color: "#111827" }}>{name}</td>
                            <td style={td("left")}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: `${color}18`, color, borderRadius: 6 }}>
                                {t.group}
                              </span>
                            </td>
                            {YJ_COLS.map(c => (
                              <td key={c} style={{ ...td("right"), color: t[c] > 0 ? YJ_COLORS[c] : "#d1d5db" }}>
                                {t[c] > 0 ? fmtKL(t[c]) : "—"}
                              </td>
                            ))}
                            <td style={{ ...td("right"), fontWeight: 700 }}>{fmtKL(t.total)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f0f4ff", borderTop: "2px solid #c7d7f5" }}>
                      <td style={{ ...td("left"), fontWeight: 700 }} colSpan={2}>합계</td>
                      {YJ_COLS.map(c => (
                        <td key={c} style={{ ...td("right"), fontWeight: 700, color: totals[c] > 0 ? YJ_COLORS[c] : "#d1d5db" }}>
                          {totals[c] > 0 ? fmtKL(totals[c]) : "—"}
                        </td>
                      ))}
                      <td style={{ ...td("right"), fontWeight: 700 }}>{fmtKL(grandTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* ── 상세 뷰: 특정 주유소 일별 내역 ── */}
          {selectedStation !== "전체" && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => setStation("전체")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                  >
                    ←
                  </button>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{selectedStation}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: `${stColor}18`, color: stColor, borderRadius: 6 }}>
                    {stInfo?.group}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>단위: L</div>
              </div>

              {dailyRows.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                  해당 월에 데이터가 없습니다
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        <th style={th("left")}>날짜</th>
                        {YJ_COLS.map(c => <th key={c} style={{ ...th("right"), color: YJ_COLORS[c] }}>{YJ_LABELS[c]}</th>)}
                        <th style={{ ...th("right"), fontWeight: 700 }}>합계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map(([date, t]) => {
                        const rowTotal = YJ_COLS.reduce((s, c) => s + (t[c] || 0), 0);
                        return (
                          <tr key={date}>
                            <td style={{ ...td("left"), color: "#6b7280" }}>{date}</td>
                            {YJ_COLS.map(c => (
                              <td key={c} style={{ ...td("right"), color: t[c] > 0 ? YJ_COLORS[c] : "#d1d5db" }}>
                                {t[c] > 0 ? fmtL(t[c]) : "—"}
                              </td>
                            ))}
                            <td style={{ ...td("right"), fontWeight: 600 }}>{fmtL(rowTotal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#f0f4ff", borderTop: "2px solid #c7d7f5" }}>
                        <td style={{ ...td("left"), fontWeight: 700 }}>합계</td>
                        {YJ_COLS.map(c => (
                          <td key={c} style={{ ...td("right"), fontWeight: 700, color: totals[c] > 0 ? YJ_COLORS[c] : "#d1d5db" }}>
                            {totals[c] > 0 ? fmtL(totals[c]) : "—"}
                          </td>
                        ))}
                        <td style={{ ...td("right"), fontWeight: 700 }}>{fmtL(grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── 스타일 헬퍼 ──────────────────────────────────────────────
const th = (align) => ({
  padding: "10px 14px",
  textAlign: align,
  fontWeight: 600,
  color: "#374151",
  fontSize: 12,
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
});

const td = (align) => ({
  padding: "10px 14px",
  textAlign: align,
  borderBottom: "1px solid #f3f4f6",
  color: "#374151",
  whiteSpace: "nowrap",
});

const chipStyle = (active) => ({
  padding: "6px 12px",
  borderRadius: 8,
  border: "none",
  fontSize: 12,
  cursor: "pointer",
  fontWeight: 600,
  background: active ? "#2563eb" : "#f3f4f6",
  color: active ? "#fff" : "#6b7280",
  transition: "all 0.15s",
});
