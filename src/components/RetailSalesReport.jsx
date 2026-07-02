// ============================================================
//  RetailSalesReport.jsx  –  직영·관계사 주유소 소매 판매 리포트
//  엑셀(마감일보) 업로드 → 파싱 → Supabase 저장 → 대시보드 표시
// ============================================================

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from "recharts";

const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";
const TABLE = "daily_station_report";

const SUPA_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
};

// ── 사업장 설정 ─────────────────────────────────────────────
const STATIONS = [
  { name: "박달주유소",       group: "세일직영" },
  { name: "안양주유소",       group: "세일직영" },
  { name: "광교주유소",       group: "세일직영" },
  { name: "용인1주유소",      group: "엘앤케이" },
  { name: "김포2주유소",      group: "엘앤케이" },
  { name: "통일로일품주유소", group: "세영TMS" },
  { name: "남부순환로주유소", group: "세영TMS" },
];

const GROUP_COLOR = {
  "세일직영": "#2563eb",
  "엘앤케이": "#059669",
  "세영TMS":  "#d97706",
};

// ── 마감일보 파싱 ────────────────────────────────────────────
function parseReport(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const cleanNum = (val) => {
    if (val === null || val === undefined || val === "" || val === " - ") return 0;
    const n = parseInt(String(val).replace(/[^0-9]/g, ""), 10);
    return isNaN(n) ? 0 : n;
  };

  // 날짜: 행3(0-indexed), 예) "마감일자 :20" | "" | "" | "26" | "년" | "7" | "월" | "1" | "일"
  const dr = raw[3] || [];
  const yearSuffix = String(dr[3] || "").trim();
  const month      = String(dr[5] || "").trim();
  const day        = String(dr[7] || "").trim();
  const date = yearSuffix && month && day
    ? `20${yearSuffix}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    : null;

  // 판매현황 (0-indexed 행 39~42)
  const gasRow = raw[39] || [];  // 무연
  const dieRow = raw[40] || [];  // 경유
  const kerRow = raw[41] || [];  // 등유
  const totRow = raw[42] || [];  // 계

  // 재고 (0-indexed 행 8, 21, 33)
  const gasInvRow = raw[8]  || [];  // 무연
  const dieInvRow = raw[21] || [];  // 경유
  const kerInvRow = raw[33] || [];  // 등유

  // 세차 (0-indexed 행 61, 63)
  const cwRow    = raw[61] || [];  // 유료세차 대수 (소형 col3 / 대형 col7)
  const cwAmtRow = raw[63] || [];  // 세차 금액 (col3)

  const small = cleanNum(cwRow[3]);
  const large = cleanNum(cwRow[7]);

  return {
    date,
    gasoline_qty:    cleanNum(gasRow[15]),
    diesel_qty:      cleanNum(dieRow[15]),
    kerosene_qty:    cleanNum(kerRow[15]),
    total_qty:       cleanNum(totRow[15]),
    gasoline_amount: cleanNum(gasRow[18]),
    diesel_amount:   cleanNum(dieRow[18]),
    total_amount:    cleanNum(totRow[18]),
    gasoline_inv:    cleanNum(gasInvRow[24]),
    diesel_inv:      cleanNum(dieInvRow[24]),
    kerosene_inv:    cleanNum(kerInvRow[24]),
    car_wash_small:  small,
    car_wash_large:  large,
    car_wash_total:  small + large,
    car_wash_amount: cleanNum(cwAmtRow[3]),
  };
}

// ── 유틸 ────────────────────────────────────────────────────
const fmt = (n) => (n ? n.toLocaleString() : "0");
const fmtM = (n) => (n ? Math.round(n / 1000).toLocaleString() : "0");

const getMonthStr = (offset = 0) => {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ── Supabase helpers ─────────────────────────────────────────
async function fetchRecords(monthStr) {
  const start = `${monthStr}-01`;
  const [year, mon] = monthStr.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const end = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}?date=gte.${start}&date=lte.${end}&order=date.asc,station_name.asc`;
  const res = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function upsertRecord(record) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}`, {
    method: "POST",
    headers: SUPA_HEADERS,
    body: JSON.stringify(record),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── 가용재고 일수 계산 ───────────────────────────────────────
// records: 해당 사업장의 최근 데이터, latest: 최신 레코드
function calcDaysRemaining(records, stationName, fuelKey, invKey) {
  const stRecs = records
    .filter((r) => r.station_name === stationName && r[fuelKey] > 0)
    .slice(-7);
  if (!stRecs.length) return null;
  const avgSales = stRecs.reduce((s, r) => s + r[fuelKey], 0) / stRecs.length;
  const latest = stRecs[stRecs.length - 1];
  if (!avgSales || !latest[invKey]) return null;
  return Math.round(latest[invKey] / avgSales);
}

// ── 서브 컴포넌트 ────────────────────────────────────────────

function StationCard({ station, latestRec, allRecs, onUpload }) {
  const color = GROUP_COLOR[station.group] || "#6b7280";

  if (!latestRec) {
    return (
      <div style={cardStyle(color, 0.04)}>
        <div style={cardHeader(color)}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{station.name}</div>
            <div style={{ fontSize: 11, color, marginTop: 2, fontWeight: 600 }}>{station.group}</div>
          </div>
          <button
            onClick={() => onUpload(station.name)}
            style={uploadBtnStyle(color)}
          >
            업로드
          </button>
        </div>
        <div style={{ padding: "20px 16px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
          데이터 없음
        </div>
      </div>
    );
  }

  const gasDays = calcDaysRemaining(allRecs, station.name, "gasoline_qty", "gasoline_inv");
  const dieDays = calcDaysRemaining(allRecs, station.name, "diesel_qty", "diesel_inv");

  return (
    <div style={cardStyle(color, 0.04)}>
      <div style={cardHeader(color)}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{station.name}</div>
          <div style={{ fontSize: 11, color, marginTop: 2, fontWeight: 600 }}>{station.group}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#9ca3af" }}>{latestRec.date}</div>
          <button onClick={() => onUpload(station.name)} style={uploadBtnStyle(color)}>
            업로드
          </button>
        </div>
      </div>

      {/* 판매량 */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8, fontWeight: 600 }}>일 판매량 (L)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Metric label="휘발유" value={fmt(latestRec.gasoline_qty)} color="#2563eb" />
          <Metric label="경유"   value={fmt(latestRec.diesel_qty)}   color="#059669" />
          <Metric label="합계"   value={fmt(latestRec.total_qty)}    color="#111827" bold />
        </div>
      </div>

      {/* 재고 & 가용일수 */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8, fontWeight: 600 }}>재고 (L) / 가용일수</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <InvMetric label="휘발유" inv={latestRec.gasoline_inv} days={gasDays} />
          <InvMetric label="경유"   inv={latestRec.diesel_inv}   days={dieDays} />
        </div>
      </div>

      {/* 세차 */}
      <div style={{ padding: "12px 16px" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8, fontWeight: 600 }}>세차</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "#374151" }}>
            <span style={{ fontWeight: 700, color: "#111827" }}>{latestRec.car_wash_total}</span>
            <span style={{ color: "#9ca3af", fontSize: 11 }}> 대</span>
            <span style={{ color: "#d1d5db", margin: "0 6px" }}>|</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>소형 {latestRec.car_wash_small} · 대형 {latestRec.car_wash_large}</span>
          </div>
          <div style={{ fontSize: 13, color: "#374151", fontFamily: "'JetBrains Mono', monospace" }}>
            {fmt(latestRec.car_wash_amount)}
            <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: 2 }}>원</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const Metric = ({ label, value, color, bold }) => (
  <div style={{ textAlign: "center" }}>
    <div style={{ fontSize: 10, color: "#9ca3af" }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: bold ? 700 : 600, color: color || "#374151", fontFamily: "'JetBrains Mono', monospace" }}>
      {value}
    </div>
  </div>
);

const InvMetric = ({ label, inv, days }) => (
  <div>
    <div style={{ fontSize: 10, color: "#9ca3af", marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", fontFamily: "'JetBrains Mono', monospace" }}>
      {fmt(inv)}
      <span style={{ fontSize: 9, color: "#9ca3af", marginLeft: 2 }}>L</span>
    </div>
    {days !== null && (
      <div style={{
        fontSize: 11, fontWeight: 700,
        color: days <= 3 ? "#ef4444" : days <= 7 ? "#f59e0b" : "#16a34a",
        marginTop: 2,
      }}>
        약 {days}일치
      </div>
    )}
  </div>
);

// ── 업로드 패널 ──────────────────────────────────────────────
function UploadPanel({ initialStation, onSaved, onCancel }) {
  const [station, setStation]   = useState(initialStation || "");
  const [preview, setPreview]   = useState(null);
  const [error, setError]       = useState("");
  const [saving, setSaving]     = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((file) => {
    if (!file) return;
    setError("");
    setPreview(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const parsed = parseReport(wb);
        if (!parsed.date) {
          setError("날짜를 파싱할 수 없습니다. 마감일보 형식을 확인해 주세요.");
          return;
        }
        setPreview(parsed);
      } catch (err) {
        setError(`파일 파싱 오류: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSave = async () => {
    if (!station || !preview) return;
    setSaving(true);
    setError("");
    try {
      const st = STATIONS.find((s) => s.name === station);
      await upsertRecord({
        date:            preview.date,
        station_name:    station,
        station_group:   st?.group || "",
        gasoline_qty:    preview.gasoline_qty,
        diesel_qty:      preview.diesel_qty,
        kerosene_qty:    preview.kerosene_qty,
        total_qty:       preview.total_qty,
        gasoline_amount: preview.gasoline_amount,
        diesel_amount:   preview.diesel_amount,
        total_amount:    preview.total_amount,
        car_wash_small:  preview.car_wash_small,
        car_wash_large:  preview.car_wash_large,
        car_wash_total:  preview.car_wash_total,
        car_wash_amount: preview.car_wash_amount,
        gasoline_inv:    preview.gasoline_inv,
        diesel_inv:      preview.diesel_inv,
        kerosene_inv:    preview.kerosene_inv,
      });
      onSaved();
    } catch (err) {
      setError(`저장 오류: ${err.message}`);
    }
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: 680, margin: "0 auto" }}>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
        {/* 헤더 */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827" }}>마감일보 업로드</div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>엑셀(.xlsx) 파일을 업로드하면 자동으로 데이터를 추출합니다</div>
          </div>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 20, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: 24 }}>
          {/* 사업장 선택 */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 8 }}>
              사업장 선택
            </label>
            <select
              value={station}
              onChange={(e) => setStation(e.target.value)}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: "1.5px solid #e5e7eb", fontSize: 14, color: "#111827",
                background: "#fafafa", cursor: "pointer", outline: "none",
                appearance: "none",
              }}
            >
              <option value="">-- 사업장을 선택하세요 --</option>
              {["세일직영", "엘앤케이", "세영TMS"].map((grp) => (
                <optgroup key={grp} label={grp}>
                  {STATIONS.filter((s) => s.group === grp).map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* 파일 드롭존 */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            style={{
              border: `2px dashed ${dragging ? "#2563eb" : "#d1d5db"}`,
              borderRadius: 12, padding: "32px 24px", textAlign: "center",
              background: dragging ? "rgba(37,99,235,0.04)" : "#fafafa",
              transition: "all 0.2s", cursor: "pointer",
              marginBottom: 20,
            }}
            onClick={() => document.getElementById("retail-file-input").click()}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
              엑셀 파일을 드래그하거나 클릭하여 선택
            </div>
            <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
              .xlsx, .xls 형식 지원
            </div>
            <input
              id="retail-file-input"
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
          </div>

          {/* 오류 */}
          {error && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "12px 16px", color: "#b91c1c", fontSize: 13, marginBottom: 16 }}>
              {error}
            </div>
          )}

          {/* 미리보기 */}
          {preview && (
            <div style={{ background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.15)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e40af", marginBottom: 14 }}>
                파싱 결과 확인 — {station || "사업장 미선택"} / {preview.date}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
                <PreviewItem label="휘발유 판매량" value={`${fmt(preview.gasoline_qty)} L`} />
                <PreviewItem label="경유 판매량"   value={`${fmt(preview.diesel_qty)} L`} />
                <PreviewItem label="합계 판매량"   value={`${fmt(preview.total_qty)} L`} />
                <PreviewItem label="휘발유 매출"   value={`${fmt(preview.gasoline_amount)} 원`} />
                <PreviewItem label="경유 매출"     value={`${fmt(preview.diesel_amount)} 원`} />
                <PreviewItem label="합계 매출"     value={`${fmt(preview.total_amount)} 원`} />
                <PreviewItem label="휘발유 재고"   value={`${fmt(preview.gasoline_inv)} L`} />
                <PreviewItem label="경유 재고"     value={`${fmt(preview.diesel_inv)} L`} />
                <PreviewItem label="등유 재고"     value={`${fmt(preview.kerosene_inv)} L`} />
                <PreviewItem label="세차 소형"     value={`${preview.car_wash_small} 대`} />
                <PreviewItem label="세차 대형"     value={`${preview.car_wash_large} 대`} />
                <PreviewItem label="세차 금액"     value={`${fmt(preview.car_wash_amount)} 원`} />
              </div>

              {!station && (
                <div style={{ color: "#f59e0b", fontSize: 12, marginBottom: 8 }}>⚠ 사업장을 먼저 선택해 주세요</div>
              )}

              <button
                onClick={handleSave}
                disabled={!station || saving}
                style={{
                  width: "100%", padding: "12px", borderRadius: 10, border: "none",
                  background: station ? "#2563eb" : "#d1d5db",
                  color: "#fff", fontWeight: 700, fontSize: 14, cursor: station ? "pointer" : "not-allowed",
                  transition: "all 0.2s",
                }}
              >
                {saving ? "저장 중..." : "Supabase에 저장"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const PreviewItem = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 10, color: "#9ca3af" }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: "#1e40af", fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
  </div>
);

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function RetailSalesReport() {
  const [view, setView]             = useState("dashboard"); // "dashboard" | "upload"
  const [uploadStation, setUpload]  = useState("");
  const [selectedMonth, setMonth]   = useState(getMonthStr(0));
  const [records, setRecords]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [loadError, setLoadError]   = useState("");
  const [selectedGroup, setGroup]   = useState("전체");

  const loadData = useCallback(async (month) => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchRecords(month);
      setRecords(data);
    } catch (e) {
      setLoadError(e.message.includes("does not exist")
        ? "테이블이 없습니다. Supabase에서 daily_station_report 테이블을 먼저 생성해 주세요."
        : `데이터 조회 오류: ${e.message}`
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(selectedMonth); }, [selectedMonth, loadData]);

  const handleUpload = (stationName) => {
    setUpload(stationName);
    setView("upload");
  };

  const handleSaved = () => {
    setView("dashboard");
    loadData(selectedMonth);
  };

  // 사업장별 최신 레코드 추출
  const latestByStation = STATIONS.reduce((acc, s) => {
    const recs = records.filter((r) => r.station_name === s.name);
    acc[s.name] = recs.length ? recs[recs.length - 1] : null;
    return acc;
  }, {});

  // 월 합계 (전체 or 그룹 필터)
  const filteredStations = selectedGroup === "전체"
    ? STATIONS
    : STATIONS.filter((s) => s.group === selectedGroup);

  const monthSummary = filteredStations.reduce(
    (acc, s) => {
      const recs = records.filter((r) => r.station_name === s.name);
      recs.forEach((r) => {
        acc.gasoline_qty    += r.gasoline_qty    || 0;
        acc.diesel_qty      += r.diesel_qty      || 0;
        acc.total_qty       += r.total_qty       || 0;
        acc.total_amount    += r.total_amount    || 0;
        acc.car_wash_total  += r.car_wash_total  || 0;
        acc.car_wash_amount += r.car_wash_amount || 0;
      });
      return acc;
    },
    { gasoline_qty: 0, diesel_qty: 0, total_qty: 0, total_amount: 0, car_wash_total: 0, car_wash_amount: 0 }
  );

  // 일별 합계 차트 데이터 (전체 합산)
  const dailyChartData = (() => {
    const byDate = {};
    records
      .filter((r) => filteredStations.some((s) => s.name === r.station_name))
      .forEach((r) => {
        if (!byDate[r.date]) byDate[r.date] = { date: r.date.slice(8), gasoline: 0, diesel: 0, total: 0 };
        byDate[r.date].gasoline += r.gasoline_qty || 0;
        byDate[r.date].diesel   += r.diesel_qty   || 0;
        byDate[r.date].total    += r.total_qty     || 0;
      });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  })();

  const tooltipStyle = {
    background: "#fff", border: "1px solid #e5e7eb",
    borderRadius: 8, fontSize: 12, color: "#111827",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  };

  if (view === "upload") {
    return (
      <div style={{ padding: "24px 0" }}>
        <UploadPanel
          initialStation={uploadStation}
          onSaved={handleSaved}
          onCancel={() => setView("dashboard")}
        />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 40 }}>
      {/* ── 상단 툴바 ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* 월 선택 */}
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setMonth(e.target.value)}
            style={{
              padding: "8px 12px", borderRadius: 10, border: "1.5px solid #e5e7eb",
              fontSize: 14, color: "#111827", background: "#fff", cursor: "pointer",
            }}
          />

          {/* 그룹 필터 */}
          <div style={{ display: "flex", gap: 4 }}>
            {["전체", "세일직영", "엘앤케이", "세영TMS"].map((g) => (
              <button
                key={g}
                onClick={() => setGroup(g)}
                style={{
                  padding: "7px 14px", borderRadius: 8, border: "none",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: selectedGroup === g ? (GROUP_COLOR[g] || "#2563eb") : "#f3f4f6",
                  color: selectedGroup === g ? "#fff" : "#6b7280",
                  transition: "all 0.15s",
                }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => { setUpload(""); setView("upload"); }}
          style={{
            padding: "9px 18px", borderRadius: 10, border: "none",
            background: "#2563eb", color: "#fff", fontWeight: 700,
            fontSize: 14, cursor: "pointer",
            boxShadow: "0 2px 8px rgba(37,99,235,0.3)",
          }}
        >
          + 마감일보 업로드
        </button>
      </div>

      {/* ── 오류 ── */}
      {loadError && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: "16px 20px", color: "#b91c1c", fontSize: 13, marginBottom: 20 }}>
          {loadError}
        </div>
      )}

      {/* ── 월 합계 요약 카드 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "월 합계 판매량", value: `${fmt(monthSummary.total_qty)} L`, sub: `휘발유 ${fmtM(monthSummary.gasoline_qty)}kL / 경유 ${fmtM(monthSummary.diesel_qty)}kL`, accent: "#2563eb" },
          { label: "월 합계 매출", value: `${fmtM(monthSummary.total_amount)}천원`, sub: `${(monthSummary.total_amount / 1e8).toFixed(1)}억원`, accent: "#059669" },
          { label: "월 세차 합계", value: `${fmt(monthSummary.car_wash_total)} 대`, sub: `${fmt(monthSummary.car_wash_amount)}원`, accent: "#d97706" },
        ].map((c) => (
          <div key={c.label} style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.accent, fontFamily: "'JetBrains Mono', monospace" }}>{c.value}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* ── 사업장 카드 그리드 ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "#9ca3af", fontSize: 15 }}>데이터 불러오는 중...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginBottom: 28 }}>
          {filteredStations.map((s) => (
            <StationCard
              key={s.name}
              station={s}
              latestRec={latestByStation[s.name]}
              allRecs={records}
              onUpload={handleUpload}
            />
          ))}
        </div>
      )}

      {/* ── 일별 판매 추이 차트 ── */}
      {dailyChartData.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 20 }}>
            일별 판매량 추이 — {selectedMonth}
            <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 400, marginLeft: 8 }}>{selectedGroup}</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dailyChartData} barGap={2} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${fmt(v)} L`, n]} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="gasoline" name="휘발유" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={28} opacity={0.85} />
              <Bar dataKey="diesel"   name="경유"   fill="#059669" radius={[3, 3, 0, 0]} maxBarSize={28} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {records.length === 0 && !loading && !loadError && (
        <div style={{ textAlign: "center", padding: "60px 24px", color: "#9ca3af" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#374151", marginBottom: 8 }}>이 달의 데이터가 없습니다</div>
          <div style={{ fontSize: 13 }}>마감일보 파일을 업로드하면 여기에 표시됩니다</div>
        </div>
      )}
    </div>
  );
}

// ── 스타일 헬퍼 ─────────────────────────────────────────────
function cardStyle(color, alpha) {
  return {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderTop: `3px solid ${color}`,
    borderRadius: 14,
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  };
}

function cardHeader(color) {
  return {
    padding: "14px 16px",
    background: `rgba(${hexToRgb(color)}, 0.04)`,
    borderBottom: "1px solid #f3f4f6",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  };
}

function uploadBtnStyle(color) {
  return {
    padding: "5px 12px", borderRadius: 8,
    border: `1.5px solid ${color}`,
    background: "transparent", color: color,
    fontSize: 12, fontWeight: 700, cursor: "pointer",
  };
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}
