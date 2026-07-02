// RetailSalesReport.jsx  –  소매 주유소 마감일보 파싱 및 판매량 표시
// 도매(SalesReport.jsx)와 완전히 독립된 시스템

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

// 테이블 스키마 (daily_station_report):
// id, date, station_name, station_group,
// gasoline_qty, gasoline_amount, diesel_qty, diesel_amount,
// kerosene_qty, total_qty, total_amount,
// car_wash_small, car_wash_large, car_wash_total, car_wash_amount,
// gasoline_inv, diesel_inv, kerosene_inv,
// gasoline_inv_prev, diesel_inv_prev, kerosene_inv_prev,
// created_at, updated_at

const STATIONS = [
  { name: "통일로일품주유소", group: "세영TMS"  },
  { name: "남부순환로주유소", group: "세영TMS"  },
  { name: "용인1주유소",      group: "엘앤케이" },
  { name: "김포2주유소",      group: "엘앤케이" },
  { name: "박달주유소",       group: "세일직영" },
  { name: "안양주유소",       group: "세일직영" },
  { name: "광교주유소",       group: "세일직영" },
];

const GROUP_COLORS = {
  "세일직영": "#2563eb",
  "엘앤케이":  "#059669",
  "세영TMS":   "#d97706",
};


// ── 파싱 ────────────────────────────────────────────────────────
function parseNum(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).replace(/,/g, "").trim();
  if (!s || s === "-") return 0;
  return parseFloat(s) || 0;
}

// 마감일보 CSV/XLS 파싱 (0-indexed row, 0-indexed col)
// Row 3:  날짜  - col[3]=년(2자리), col[5]=월, col[7]=일
// Row 8:  무연 재고 - col[3]=전일재고, col[24]=장부재고(현재고)
// Row 21: 경유 재고 - col[3]=전일재고, col[24]=장부재고(현재고)
// Row 33: 등유 재고 - col[3]=전일재고, col[24]=장부재고(현재고)
// Row 39: 무연 판매 - col[15]=수량, col[18]=매출
// Row 40: 경유 판매 - col[15]=수량, col[18]=매출
// Row 41: 등유 판매 - col[15]=수량, col[18]=매출
// Row 59: 세차 대수 - col[3]=소형, col[7]=대형
// Row 63: 세차 금액 - col[3]=총금액
function parseMagamReport(workbook) {
  // 파일마다 첫 시트가 다르므로(예: 남부순환로 = "Chart1") "마감장" 시트를 이름으로 찾는다
  const sheetName = workbook.SheetNames.includes("마감장")
    ? "마감장"
    : workbook.SheetNames[0];
  const ws = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (raw.length < 65) throw new Error("파일 행 수 부족 — 마감일보 형식이 아닙니다");

  const g = (row, col) => raw[row]?.[col] ?? "";

  // 날짜
  const yearSuffix = String(g(3, 3)).trim();
  const month      = String(g(3, 5)).trim();
  const day        = String(g(3, 7)).trim();
  if (!yearSuffix || !month || !day) throw new Error("날짜 파싱 실패");
  const year    = yearSuffix.length === 2 ? `20${yearSuffix}` : yearSuffix;
  const dateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

  return {
    dateStr,
    gas_qty:       parseNum(g(39, 15)),
    gas_amt:       parseNum(g(39, 18)),
    diesel_qty:    parseNum(g(40, 15)),
    diesel_amt:    parseNum(g(40, 18)),
    kero_qty:      parseNum(g(41, 15)),
    kero_amt:      parseNum(g(41, 18)),
    gas_inv:       parseNum(g(8,  24)),
    diesel_inv:    parseNum(g(21, 24)),
    kero_inv:      parseNum(g(33, 24)),
    gas_inv_prev:    parseNum(g(8,  3)),
    diesel_inv_prev: parseNum(g(21, 3)),
    kero_inv_prev:   parseNum(g(33, 3)),
    carwash_small: parseNum(g(59,  3)),
    carwash_large: parseNum(g(59,  7)),
    carwash_amt:   parseNum(g(63,  3)),
  };
}

// ── Supabase ─────────────────────────────────────────────────────
async function supaGetAll() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/daily_station_report?select=*&order=date.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (res.ok) return { error: null, data: await res.json() };
    const body = await res.json().catch(() => ({}));
    const isTableMissing = (body.code === "42P01") ||
      String(body.message || "").includes("does not exist");
    return { error: isTableMissing ? "table_missing" : "fetch_error", data: [] };
  } catch { return { error: "network_error", data: [] }; }
}

async function supaUpsert(stationName, stationGroup, parsed) {
  // 같은 주유소+날짜 기존 행 삭제 후 재삽입 (upsert 대용)
  await fetch(
    `${SUPABASE_URL}/rest/v1/daily_station_report?station_name=eq.${encodeURIComponent(stationName)}&date=eq.${parsed.dateStr}`,
    { method: "DELETE", headers: supaHeaders }
  );

  const total_qty    = parsed.gas_qty    + parsed.diesel_qty    + parsed.kero_qty;
  const total_amount = parsed.gas_amt    + parsed.diesel_amt    + parsed.kero_amt;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_station_report`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify({
      date:            parsed.dateStr,
      station_name:    stationName,
      station_group:   stationGroup,
      gasoline_qty:    parsed.gas_qty,
      gasoline_amount: parsed.gas_amt,
      diesel_qty:      parsed.diesel_qty,
      diesel_amount:   parsed.diesel_amt,
      kerosene_qty:    parsed.kero_qty,
      total_qty,
      total_amount,
      car_wash_small:  parsed.carwash_small,
      car_wash_large:  parsed.carwash_large,
      car_wash_total:  parsed.carwash_small + parsed.carwash_large,
      car_wash_amount: parsed.carwash_amt,
      gasoline_inv:    parsed.gas_inv,
      diesel_inv:      parsed.diesel_inv,
      kerosene_inv:    parsed.kero_inv,
      gasoline_inv_prev: parsed.gas_inv_prev,
      diesel_inv_prev:   parsed.diesel_inv_prev,
      kerosene_inv_prev: parsed.kero_inv_prev,
      updated_at:      new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
}

// ── 유틸 ─────────────────────────────────────────────────────────
const fmtL = (v) => (v > 0 ? Math.round(v).toLocaleString() : "—");
const fmtW = (v) => (v > 0 ? Math.round(v).toLocaleString() : "—");

function getMonthStr(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── 컴포넌트 ─────────────────────────────────────────────────────
export default function RetailSalesReport() {
  const [rows,           setRows]          = useState([]);
  const [loading,        setLoading]       = useState(true);
  const [tableError,     setTableError]    = useState(false);
  const [selectedStation, setStation]      = useState("전체");
  const [selectedMonth,  setMonth]         = useState(getMonthStr(0));
  const [uploadStation,  setUploadStation] = useState(STATIONS[0].name);
  const [dzState,        setDzState]       = useState("idle");
  const [dzInfo,         setDzInfo]        = useState(null);
  const [drag,           setDrag]          = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const { error, data } = await supaGetAll();
    if (error === "table_missing") {
      setTableError(true);
    } else {
      setTableError(false);
      setRows(data);
      if (data.length) {
        const months = [...new Set(data.map(r => r.date?.substring(0, 7)).filter(Boolean))].sort();
        setMonth(months[months.length - 1]);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleFile = useCallback(async (file) => {
    setDzState("loading");
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: false });
        const parsed = parseMagamReport(wb);
        const stInfo = STATIONS.find(s => s.name === uploadStation);
        await supaUpsert(uploadStation, stInfo?.group || "", parsed);
        await reload();
        setDzInfo({ filename: file.name, date: parsed.dateStr, station: uploadStation });
        setDzState("done");
        setStation(uploadStation);
        setMonth(parsed.dateStr.substring(0, 7));
      } catch (err) {
        console.error(err);
        setDzInfo({ error: err.message });
        setDzState("error");
      }
    };
    reader.readAsArrayBuffer(file);
  }, [uploadStation, reload]);

  // ── 필터 ──────────────────────────────────────────────────────
  const [yr, mo] = selectedMonth.split("-").map(Number);
  const lastDay  = new Date(yr, mo, 0).getDate();
  const start    = `${selectedMonth}-01`;
  const end      = `${selectedMonth}-${String(lastDay).padStart(2, "0")}`;

  const filtered = rows.filter(r => {
    if (!r.date || r.date < start || r.date > end) return false;
    if (selectedStation !== "전체" && r.station_name !== selectedStation) return false;
    return true;
  });

  const months = [...new Set(rows.map(r => r.date?.substring(0, 7)).filter(Boolean))].sort();

  const totals = { gas: 0, diesel: 0, kero: 0, carwash: 0 };
  filtered.forEach(r => {
    totals.gas     += r.gasoline_qty    || 0;
    totals.diesel  += r.diesel_qty      || 0;
    totals.kero    += r.kerosene_qty    || 0;
    totals.carwash += r.car_wash_amount || 0;
  });
  const grandQty = totals.gas + totals.diesel + totals.kero;

  // 전체 뷰: 주유소별 집계
  const stationTotals = {};
  if (selectedStation === "전체") {
    filtered.forEach(r => {
      const key = r.station_name;
      if (!stationTotals[key]) {
        stationTotals[key] = { gas: 0, diesel: 0, kero: 0, carwash: 0, total: 0, group: r.station_group || "" };
      }
      const t = stationTotals[key];
      t.gas     += r.gasoline_qty    || 0;
      t.diesel  += r.diesel_qty      || 0;
      t.kero    += r.kerosene_qty    || 0;
      t.carwash += r.car_wash_amount || 0;
      t.total   += (r.gasoline_qty || 0) + (r.diesel_qty || 0) + (r.kerosene_qty || 0);
    });
  }

  // 상세 뷰: 일별
  const dailyRows = selectedStation !== "전체"
    ? [...filtered].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const stInfo  = STATIONS.find(s => s.name === selectedStation);
  const stColor = GROUP_COLORS[stInfo?.group] || "#2563eb";

  // 재고 현황 & 가용일수 (최신일 기준, 최근 7일 평균 판매량)
  // 전체 데이터(rows) 기준으로 계산 → 월 경계와 무관하게 안정적
  const status = (() => {
    if (selectedStation === "전체") return null;
    const sr = rows
      .filter(r => r.station_name === selectedStation && r.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!sr.length) return null;
    const latest = sr[0];
    const last7  = sr.slice(0, 7);
    const avgQty = (key) =>
      last7.reduce((s, r) => s + (r[key] || 0), 0) / last7.length;
    const mk = (invKey, prevKey, qtyKey) => {
      const inv = latest[invKey] || 0;
      const avg = avgQty(qtyKey);
      return { prev: latest[prevKey] || 0, inv, avg, days: avg > 0 ? inv / avg : null };
    };
    return {
      date: latest.date,
      n:    last7.length,
      fuels: [
        { key: "gas",    label: "휘발유", color: "#2563eb", ...mk("gasoline_inv", "gasoline_inv_prev", "gasoline_qty") },
        { key: "diesel", label: "경유",   color: "#059669", ...mk("diesel_inv",   "diesel_inv_prev",   "diesel_qty") },
        { key: "kero",   label: "등유",   color: "#ea580c", ...mk("kerosene_inv", "kerosene_inv_prev", "kerosene_qty") },
      ].filter(f => f.inv > 0 || f.prev > 0),
    };
  })();

  const daysColor = (d) =>
    d == null ? "#9ca3af" : d < 5 ? "#ef4444" : d < 10 ? "#d97706" : "#16a34a";

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── 업로드 섹션 ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>업로드 주유소</span>
          <select
            value={uploadStation}
            onChange={e => setUploadStation(e.target.value)}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13, color: "#111827", background: "#fff", cursor: "pointer" }}
          >
            {["세일직영", "엘앤케이", "세영TMS"].map(grp => (
              <optgroup key={grp} label={grp}>
                {STATIONS.filter(s => s.group === grp).map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {dzState === "done" && (
            <button
              onClick={() => { setDzState("idle"); setDzInfo(null); }}
              style={{ padding: "6px 12px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 12, color: "#6b7280", background: "#fff", cursor: "pointer" }}
            >
              + 추가 업로드
            </button>
          )}
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => dzState !== "loading" && document.getElementById("retail-magam-input").click()}
          style={{
            border: `2px dashed ${drag ? "#2563eb" : dzState === "done" ? "#16a34a" : dzState === "error" ? "#ef4444" : "#d1d5db"}`,
            borderRadius: 12,
            padding: "18px 24px",
            textAlign: "center",
            cursor: dzState === "loading" ? "default" : "pointer",
            background: dzState === "done" ? "rgba(22,163,74,0.04)" : drag ? "rgba(37,99,235,0.04)" : "#fafafa",
            transition: "all 0.2s",
          }}
        >
          {dzState === "loading" && <div style={{ color: "#9ca3af", fontSize: 13 }}>파싱 중...</div>}
          {dzState === "error" && (
            <div>
              <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 4 }}>파일 파싱 실패</div>
              <div style={{ color: "#9ca3af", fontSize: 11 }}>{dzInfo?.error || "마감일보 CSV/XLS 형식을 확인하세요"}</div>
              <div style={{ color: "#9ca3af", fontSize: 11, marginTop: 4 }}>클릭하여 다시 시도</div>
            </div>
          )}
          {dzState === "done" && dzInfo && (
            <div style={{ color: "#16a34a", fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>✓ {dzInfo.filename}</div>
              <div>{dzInfo.station} · {dzInfo.date} 업로드 완료</div>
            </div>
          )}
          {dzState === "idle" && (
            <>
              <div style={{ fontSize: 22, marginBottom: 6 }}>📂</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>마감일보 파일 드롭 또는 클릭</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>.csv / .xls / .xlsx</div>
            </>
          )}
          <input
            id="retail-magam-input"
            type="file"
            accept=".csv,.xls,.xlsx"
            style={{ display: "none" }}
            onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ""; }}
          />
        </div>
      </div>

      {/* ── 테이블 미생성 안내 ── */}
      {tableError && (
        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 12, padding: "16px 20px", marginBottom: 20, fontSize: 13, color: "#92400e" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Supabase 테이블 설정 필요</div>
          <div style={{ marginBottom: 8 }}>Supabase 대시보드 → SQL Editor에서 아래 쿼리를 실행하세요:</div>
          <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>Supabase 대시보드 → Table Editor에서 <b>daily_station_report</b> 테이블을 생성하세요.</div>
          <button
            onClick={reload}
            style={{ marginTop: 10, padding: "6px 14px", background: "#d97706", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 }}
          >
            다시 시도
          </button>
        </div>
      )}

      {/* ── 필터 바 ── */}
      {!tableError && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <select
            value={selectedStation}
            onChange={e => setStation(e.target.value)}
            style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 13, color: "#111827", background: "#fff", cursor: "pointer", minWidth: 170 }}
          >
            <option value="전체">전체 주유소</option>
            {["세일직영", "엘앤케이", "세영TMS"].map(grp => (
              <optgroup key={grp} label={grp}>
                {STATIONS.filter(s => s.group === grp).map(s => (
                  <option key={s.name} value={s.name}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {months.map(m => (
              <button key={m} onClick={() => setMonth(m)} style={chipStyle(selectedMonth === m)}>
                {m.replace("-", "년 ")}월
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 로딩 ── */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: "#9ca3af", fontSize: 13 }}>불러오는 중...</div>
      )}

      {/* ── 데이터 없음 ── */}
      {!loading && !tableError && rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 24px", color: "#9ca3af" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 6 }}>데이터가 없습니다</div>
          <div style={{ fontSize: 13 }}>주유소를 선택하고 마감일보 파일을 업로드해 주세요</div>
        </div>
      )}

      {/* ── 데이터 표시 ── */}
      {!loading && !tableError && rows.length > 0 && (
        <>
          {/* 요약 카드 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 20 }}>
            {[
              { label: "총 판매량",  value: fmtL(grandQty),      unit: "L",  color: "#111827" },
              { label: "휘발유",     value: fmtL(totals.gas),    unit: "L",  color: "#2563eb" },
              { label: "경유",       value: fmtL(totals.diesel), unit: "L",  color: "#059669" },
              ...(totals.kero > 0 ? [{ label: "등유", value: fmtL(totals.kero), unit: "L", color: "#ea580c" }] : []),
              { label: "세차매출",   value: fmtW(totals.carwash), unit: "원", color: "#7c3aed" },
            ].map(c => (
              <div key={c.label} style={{ background: "#fff", borderRadius: 12, border: "1px solid #e5e7eb", padding: "14px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, marginBottom: 4 }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.color }}>
                  {c.value}
                  <span style={{ fontSize: 10, fontWeight: 400, color: "#9ca3af", marginLeft: 2 }}>{c.unit}</span>
                </div>
              </div>
            ))}
          </div>

          {/* ── 전체: 주유소별 집계 ── */}
          {selectedStation === "전체" && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", fontSize: 14, fontWeight: 700, color: "#111827" }}>
                주유소별 판매량
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                  {selectedMonth.replace("-", "년 ")}월 · 단위: L · 클릭하여 상세 조회
                </span>
              </div>
              {Object.keys(stationTotals).length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>해당 월에 데이터가 없습니다</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      <th style={th("left")}>주유소</th>
                      <th style={th("left")}>그룹</th>
                      <th style={{ ...th("right"), color: "#2563eb" }}>휘발유</th>
                      <th style={{ ...th("right"), color: "#059669" }}>경유</th>
                      <th style={{ ...th("right"), color: "#ea580c" }}>등유</th>
                      <th style={{ ...th("right"), fontWeight: 700 }}>합계</th>
                      <th style={{ ...th("right"), color: "#7c3aed" }}>세차매출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stationTotals).sort((a, b) => b[1].total - a[1].total).map(([name, t]) => {
                      const color = GROUP_COLORS[t.group] || "#6b7280";
                      return (
                        <tr
                          key={name}
                          onClick={() => setStation(name)}
                          style={{ cursor: "pointer" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f8faff")}
                          onMouseLeave={e => (e.currentTarget.style.background = "")}
                        >
                          <td style={{ ...td("left"), fontWeight: 600 }}>{name}</td>
                          <td style={td("left")}>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: `${color}18`, color, borderRadius: 6 }}>{t.group}</span>
                          </td>
                          <td style={{ ...td("right"), color: t.gas    > 0 ? "#2563eb" : "#d1d5db" }}>{fmtL(t.gas)}</td>
                          <td style={{ ...td("right"), color: t.diesel > 0 ? "#059669" : "#d1d5db" }}>{fmtL(t.diesel)}</td>
                          <td style={{ ...td("right"), color: t.kero   > 0 ? "#ea580c" : "#d1d5db" }}>{fmtL(t.kero)}</td>
                          <td style={{ ...td("right"), fontWeight: 700 }}>{fmtL(t.total)}</td>
                          <td style={{ ...td("right"), color: "#7c3aed" }}>{fmtW(t.carwash)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f0f4ff", borderTop: "2px solid #c7d7f5" }}>
                      <td style={{ ...td("left"), fontWeight: 700 }} colSpan={2}>합계</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: "#2563eb" }}>{fmtL(totals.gas)}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: "#059669" }}>{fmtL(totals.diesel)}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: "#ea580c" }}>{fmtL(totals.kero)}</td>
                      <td style={{ ...td("right"), fontWeight: 700 }}>{fmtL(grandQty)}</td>
                      <td style={{ ...td("right"), fontWeight: 700, color: "#7c3aed" }}>{fmtW(totals.carwash)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* ── 상세: 개별 주유소 일별 내역 ── */}
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
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: `${stColor}18`, color: stColor, borderRadius: 6 }}>{stInfo?.group}</span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>판매량: L / 재고·세차: L·원</div>
              </div>

              {/* ── 재고 현황 & 가용일수 ── */}
              {status && status.fuels.length > 0 && (
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", background: "#fbfcfe" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 10 }}>
                    재고 현황 · 가용일수
                    <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>
                      {status.date} 기준 · 최근 {status.n}일 평균 판매량
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                    {status.fuels.map(f => (
                      <div key={f.key} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: f.color }}>{f.label}</span>
                          <span style={{ fontSize: 20, fontWeight: 800, color: daysColor(f.days) }}>
                            {f.days == null ? "—" : f.days.toFixed(1)}
                            <span style={{ fontSize: 11, fontWeight: 500, color: "#9ca3af", marginLeft: 2 }}>일</span>
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "#6b7280", lineHeight: 1.7 }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>전일재고</span><span style={{ color: "#374151" }}>{fmtL(f.prev)} L</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>현재고</span><span style={{ color: "#111827", fontWeight: 700 }}>{fmtL(f.inv)} L</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>7일 평균판매</span><span style={{ color: "#374151" }}>{fmtL(f.avg)} L/일</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dailyRows.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>해당 월에 데이터가 없습니다</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        <th style={th("left")}>날짜</th>
                        <th style={{ ...th("right"), color: "#2563eb" }}>휘발유</th>
                        <th style={{ ...th("right"), color: "#059669" }}>경유</th>
                        <th style={{ ...th("right"), color: "#ea580c" }}>등유</th>
                        <th style={{ ...th("right"), fontWeight: 700 }}>합계</th>
                        <th style={{ ...th("right"), color: "#7c3aed" }}>세차(원)</th>
                        <th style={{ ...th("right"), color: "#9ca3af" }}>재고휘(L)</th>
                        <th style={{ ...th("right"), color: "#9ca3af" }}>재고경(L)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map(r => {
                        const rowTotal = (r.gasoline_qty || 0) + (r.diesel_qty || 0) + (r.kerosene_qty || 0);
                        return (
                          <tr key={r.date}>
                            <td style={{ ...td("left"), color: "#6b7280" }}>{r.date}</td>
                            <td style={{ ...td("right"), color: r.gasoline_qty  > 0 ? "#2563eb" : "#d1d5db" }}>{fmtL(r.gasoline_qty)}</td>
                            <td style={{ ...td("right"), color: r.diesel_qty    > 0 ? "#059669" : "#d1d5db" }}>{fmtL(r.diesel_qty)}</td>
                            <td style={{ ...td("right"), color: r.kerosene_qty  > 0 ? "#ea580c" : "#d1d5db" }}>{fmtL(r.kerosene_qty)}</td>
                            <td style={{ ...td("right"), fontWeight: 600 }}>{fmtL(rowTotal)}</td>
                            <td style={{ ...td("right"), color: "#7c3aed" }}>{fmtW(r.car_wash_amount)}</td>
                            <td style={{ ...td("right"), color: "#9ca3af", fontSize: 12 }}>{fmtL(r.gasoline_inv)}</td>
                            <td style={{ ...td("right"), color: "#9ca3af", fontSize: 12 }}>{fmtL(r.diesel_inv)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#f0f4ff", borderTop: "2px solid #c7d7f5" }}>
                        <td style={{ ...td("left"), fontWeight: 700 }}>합계</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: "#2563eb" }}>{fmtL(totals.gas)}</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: "#059669" }}>{fmtL(totals.diesel)}</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: "#ea580c" }}>{fmtL(totals.kero)}</td>
                        <td style={{ ...td("right"), fontWeight: 700 }}>{fmtL(grandQty)}</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: "#7c3aed" }}>{fmtW(totals.carwash)}</td>
                        <td colSpan={2} />
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

// ── 스타일 헬퍼 ──────────────────────────────────────────────────
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
