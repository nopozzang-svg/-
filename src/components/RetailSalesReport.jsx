// RetailSalesReport.jsx  –  소매 주유소 마감일보 파싱 및 판매 현황 대시보드
// 도매(SalesReport.jsx)와 완전히 독립된 시스템 — 이 파일만 수정하면 다른 탭에 영향 없음

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
// car_wash_free, car_wash_paid,
// gasoline_inv, diesel_inv, kerosene_inv,
// created_at, updated_at

// aliases: 파일 자동 분류용 키워드 (파일 내 주유소명 + 파일명에서 탐색). 서로 겹치지 않게 유지
const STATIONS = [
  { name: "통일로일품주유소", group: "세영TMS",  aliases: ["일품"] },
  { name: "남부순환로주유소", group: "세영TMS",  aliases: ["남부순환"] },
  { name: "용인1주유소",      group: "엘앤케이", aliases: ["용인"] },
  { name: "김포2주유소",      group: "엘앤케이", aliases: ["김포"] },
  { name: "박달주유소",       group: "세일직영", aliases: ["박달"] },
  { name: "안양주유소",       group: "세일직영", aliases: ["안양"] },
  { name: "광교주유소",       group: "세일직영", aliases: ["광교"] },
];

// 워크북 + 파일명으로 주유소 자동 판별. 정확히 1곳만 매칭될 때만 반환(모호하면 null → 수동 지정)
function detectStation(workbook, filename) {
  let inFileName = "";
  try {
    const sheet = workbook.Sheets[workbook.SheetNames.includes("마감장") ? "마감장" : workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    inFileName = String(raw[1]?.[3] ?? ""); // 마감장 r1 col3 = 주유소명
  } catch { /* 무시 */ }
  const hay = `${inFileName} ${filename}`.replace(/\s/g, "");
  const matches = STATIONS.filter(s => s.aliases.some(a => hay.includes(a)));
  return matches.length === 1 ? matches[0] : null;
}

const GROUP_COLORS = {
  "세일직영": "#2563eb",
  "엘앤케이":  "#059669",
  "세영TMS":   "#d97706",
};

// 표·드롭다운 공통 운영사 정렬 순서
const GROUP_ORDER = ["세일직영", "엘앤케이", "세영TMS"];
const groupRank = (g) => { const i = GROUP_ORDER.indexOf(g); return i === -1 ? 99 : i; };

// 단위 상수
const DM_LITERS = 200; // 1 DM = 200 L (드럼)

// 유종 색상
const C_GAS = "#2563eb", C_DIESEL = "#059669", C_KERO = "#ea580c", C_WASH = "#7c3aed";

// ── 파싱 ────────────────────────────────────────────────────────
function parseNum(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).replace(/,/g, "").trim();
  if (!s || s === "-") return 0;
  return parseFloat(s) || 0;
}

// 마감일보 파싱 (0-indexed row, 0-indexed col)  — "마감장" 시트
// Row 3:  날짜  - col[3]=년(2자리), col[5]=월, col[7]=일
// Row 8:  무연 재고 - col[24]=장부재고(현재고)
// Row 21: 경유 재고 - col[24]=장부재고(현재고)
// Row 33: 등유 재고 - col[24]=장부재고(현재고)
// Row 39: 무연 판매 - col[15]=수량, col[18]=매출
// Row 40: 경유 판매 - col[15]=수량, col[18]=매출
// Row 41: 등유 판매 - col[15]=수량, col[18]=매출
// Row 63: 세차 금액 - col[3]=총금액
// 세차 대수(무료/유료)는 "세차" 시트에서 파싱 (구조가 주유소 간 통일돼 있음)
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

  // 세차 시트에서 무료/유료 대수 파싱
  let carwash_free = 0, carwash_paid = 0;
  if (workbook.SheetNames.includes("세차")) {
    const cw = XLSX.utils.sheet_to_json(workbook.Sheets["세차"], { header: 1, defval: "" });
    const dayNum = parseInt(day, 10);
    for (let r = 6; r < cw.length; r++) {
      if (parseInt(String(cw[r]?.[0]).trim(), 10) === dayNum) {
        carwash_free = parseNum(cw[r][3]); // 무료 소계
        carwash_paid = parseNum(cw[r][6]); // 유료 소계
        break;
      }
    }
  }

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
    carwash_free,
    carwash_paid,
    carwash_amt:   parseNum(g(63, 3)),
  };
}

// ── 엘앤케이 전용 파서 ───────────────────────────────────────────
// 엘앤케이는 다른 주유소와 달리 "월간·2개소 통합" 엑셀 한 파일로 옴.
//   · 일자별 매출 시트:  "26.06(용인제1)", "26.06(김포제2)" (월 prefix는 매달 바뀜)
//   · 유류재고 관리대장: "무연(용인제1)", "경유(용인제1)" …
// 한 파일 → 2개소 × 그 달 일수 만큼의 일별 행을 만들어 반환. 저장은 기존 supaUpsert 재사용.
const LNK_DAILY_RE = /^\d{2}\.\d{2}\((.+)\)$/; // "26.06(용인제1)" → 캡처: "용인제1"

// 엘앤케이 통합 파일 여부 (일자별 시트 패턴 존재). 세일·세영 마감일보엔 이런 시트명이 없어 오탐 불가
function isLnkWorkbook(wb) {
  return wb.SheetNames.some(n => LNK_DAILY_RE.test(n));
}

// 시트명 안의 주유소 라벨("용인제1")을 STATIONS(엘앤케이)로 매핑
function lnkStationFor(label) {
  const clean = String(label).replace(/\s/g, "");
  return STATIONS.find(s => s.group === "엘앤케이" && s.aliases.some(a => clean.includes(a))) || null;
}

// Excel 날짜(직렬번호 또는 Date) → "YYYY-MM-DD". 날짜가 아니면(합계·일평균·과거월 행 등) null
function lnkDateStr(cell) {
  if (cell instanceof Date) {
    if (cell.getFullYear() < 2000) return null;
    return `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, "0")}-${String(cell.getDate()).padStart(2, "0")}`;
  }
  if (typeof cell === "number") {
    // 1900 날짜체계: 25569 = 1899-12-30 ~ 1970-01-01 일수. UTC로 계산해 시차 오차 방지
    const dt = new Date(Math.round((cell - 25569) * 86400 * 1000));
    if (isNaN(dt.getTime()) || dt.getUTCFullYear() < 2000) return null;
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}

// 시트를 2차원 배열로 읽되, 선행 빈 열(A 등)이 잘려 인덱스가 밀리지 않도록 항상 A열(0)부터 포함.
// (재고대장 시트는 A열이 통째로 비어 SheetJS 기본 파싱 시 열이 1칸 밀리는 문제가 있음)
function lnkSheetRows(ws) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  range.s.c = 0;
  range.s.r = 0;
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", range });
}

// 유류재고 관리대장 시트에서 "날짜 → 실재고(L)" 맵 생성 (col: 1=일자, 8=실재고)
function lnkInventoryMap(wb, label, fuelPrefix) {
  const name = `${fuelPrefix}(${label})`;
  const map = {};
  if (!wb.SheetNames.includes(name)) return map;
  const raw = lnkSheetRows(wb.Sheets[name]);
  for (let r = 3; r < raw.length; r++) {            // R4~ (데이터 시작)
    const ds = lnkDateStr(raw[r]?.[1]);
    if (!ds) continue;                              // 월계·합계 등 비-날짜 행 제외
    map[ds] = parseNum(raw[r][8]);                  // 실재고
  }
  return map;
}

// 엘앤케이 통합 워크북 → [{ stationName, group, parsed }, …]
// 일자별 시트 컬럼(0-index): 1=일자, 7=무연L, 11=무연매출, 13=경유L, 17=경유매출, 19=세차매출, 21=세차댓수
function parseLnkWorkbook(wb) {
  const items = [];
  const dailySheets = wb.SheetNames.filter(n => LNK_DAILY_RE.test(n));
  for (const sheetName of dailySheets) {
    const label = sheetName.match(LNK_DAILY_RE)[1];
    const st = lnkStationFor(label);
    if (!st) continue;                              // 매핑 실패 시 해당 시트 건너뜀
    const gasInv = lnkInventoryMap(wb, label, "무연");
    const dieInv = lnkInventoryMap(wb, label, "경유");
    const raw = lnkSheetRows(wb.Sheets[sheetName]);
    for (let r = 5; r < raw.length; r++) {          // R6~ (당월 일자 행). 과거월 행은 col1이 문자열이라 자동 제외
      const ds = lnkDateStr(raw[r]?.[1]);
      if (!ds) continue;
      const gasAmt = parseNum(raw[r][11]);
      const dieAmt = parseNum(raw[r][17]);
      // 아직 안 지난(미기입) 날은 매출이 비어 있고 실재고도 공란 → 저장하지 않음.
      // 이걸 넣으면 "마지막 날짜"가 미래 빈 날이 되어 현재고가 0으로 표시됨.
      if (gasAmt === 0 && dieAmt === 0) continue;
      items.push({
        stationName: st.name,
        group:       st.group,
        parsed: {
          dateStr:      ds,
          gas_qty:      parseNum(raw[r][7]),
          gas_amt:      gasAmt,
          diesel_qty:   parseNum(raw[r][13]),
          diesel_amt:   dieAmt,
          kero_qty:     0,
          kero_amt:     0,
          gas_inv:      gasInv[ds] || 0,
          diesel_inv:   dieInv[ds] || 0,
          kero_inv:     0,
          carwash_free: 0,                          // 엘앤케이는 무료/유료 구분 없음 → 전량 유료로 기록
          carwash_paid: parseNum(raw[r][21]),
          carwash_amt:  parseNum(raw[r][19]),
        },
      });
    }
  }
  return items;
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

// 특정 주유소의 날짜 구간 행 일괄 삭제 (엘앤케이 월간 파일 재업로드 시 이전 잔재·빈 행 정리용)
async function supaDeleteRange(stationName, startDate, endDate) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/daily_station_report?station_name=eq.${encodeURIComponent(stationName)}&date=gte.${startDate}&date=lte.${endDate}`,
    { method: "DELETE", headers: supaHeaders }
  );
}

async function supaUpsert(stationName, stationGroup, parsed) {
  // 같은 주유소+날짜 기존 행 삭제 후 재삽입 (upsert 대용)
  await fetch(
    `${SUPABASE_URL}/rest/v1/daily_station_report?station_name=eq.${encodeURIComponent(stationName)}&date=eq.${parsed.dateStr}`,
    { method: "DELETE", headers: supaHeaders }
  );

  const total_qty    = parsed.gas_qty + parsed.diesel_qty + parsed.kero_qty;
  const total_amount = parsed.gas_amt + parsed.diesel_amt + parsed.kero_amt;

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
      car_wash_free:   parsed.carwash_free,
      car_wash_paid:   parsed.carwash_paid,
      car_wash_total:  parsed.carwash_free + parsed.carwash_paid,
      car_wash_amount: parsed.carwash_amt,
      gasoline_inv:    parsed.gas_inv,
      diesel_inv:      parsed.diesel_inv,
      kerosene_inv:    parsed.kero_inv,
      updated_at:      new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
}

// ── 포맷 유틸 ────────────────────────────────────────────────────
// 유류: L → DM (1 DM = 200 L), 소수 1자리
const fmtDM = (l) =>
  l > 0 ? (l / DM_LITERS).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—";
// 세차 매출: 원 → 천원
const fmtKW = (won) => (won > 0 ? Math.round(won / 1000).toLocaleString() : "—");
// 대수 (평균 모드에서는 소수 가능)
const fmtCnt = (n) => (n > 0 ? n.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "—");
// 가용일수
const fmtDays = (d) => (d == null ? "—" : d.toLocaleString("ko-KR", { maximumFractionDigits: 1 }));

// 가용일수 색상: 3일 미만 빨강 / 7일 이내 주황 / 그 외 초록
const daysColor = (d) =>
  d == null ? "#d1d5db" : d < 3 ? "#ef4444" : d <= 7 ? "#d97706" : "#16a34a";

const monthLastDay = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
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
  const [dateFrom,       setDateFrom]      = useState("");
  const [dateTo,         setDateTo]        = useState("");
  const [avgMode,        setAvgMode]       = useState(true);    // 기본=일평균(주유소별 데이터 일수가 달라 합계 비교는 불공정). 토글로 합계 전환 가능
  const [showKero,       setShowKero]      = useState(false);   // 등유 컬럼 표시
  const [processing,     setProcessing]    = useState(false);
  const [results,        setResults]       = useState([]);
  const [drag,           setDrag]          = useState(false);
  const [hoverRow,       setHoverRow]      = useState(null);

  const setMonthRange = useCallback((ym) => {
    setDateFrom(`${ym}-01`);
    setDateTo(`${ym}-${String(monthLastDay(ym)).padStart(2, "0")}`);
  }, []);

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
        const latest = months[months.length - 1];
        setDateFrom(`${latest}-01`);
        setDateTo(`${latest}-${String(monthLastDay(latest)).padStart(2, "0")}`);
      } else {
        setMonthRange(getMonthStr(0));
      }
    }
    setLoading(false);
  }, [setMonthRange]);

  useEffect(() => { reload(); }, [reload]);

  // 여러 파일을 한 번에 받아 주유소 자동 분류 후 업로드
  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setProcessing(true);
    const res = [];
    let lastDate = null;
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: false });

        // 엘앤케이: 월간·2개소 통합 파일 → 전용 파서로 여러 행 한 번에 저장
        if (isLnkWorkbook(wb)) {
          const items = parseLnkWorkbook(wb);
          if (!items.length) throw new Error("엘앤케이 일자별 데이터를 찾지 못했습니다");
          // 재업로드 대비: 파일에 담긴 (주유소×월)별로 기존 행을 먼저 정리 후 삽입
          // (이전에 잘못 들어간 미래 빈 날 행까지 제거)
          const monthKeys = [...new Set(items.map(i => `${i.stationName}|${i.parsed.dateStr.substring(0, 7)}`))];
          for (const key of monthKeys) {
            const [sn, ym] = key.split("|");
            await supaDeleteRange(sn, `${ym}-01`, `${ym}-${String(monthLastDay(ym)).padStart(2, "0")}`);
          }
          for (const it of items) await supaUpsert(it.stationName, it.group, it.parsed);
          const dates = items.map(i => i.parsed.dateStr).sort();
          const stns  = [...new Set(items.map(i => i.stationName))].join(", ");
          lastDate = dates[dates.length - 1];
          res.push({
            filename: file.name, station: stns,
            date: `${dates[0]} ~ ${dates[dates.length - 1]} · ${items.length}건`,
            status: "done",
          });
          continue;
        }

        const parsed = parseMagamReport(wb);
        const st = detectStation(wb, file.name);
        if (st) {
          await supaUpsert(st.name, st.group, parsed);
          res.push({ filename: file.name, station: st.name, date: parsed.dateStr, status: "done" });
          lastDate = parsed.dateStr;
        } else {
          // 자동 인식 실패 → 수동 지정용으로 파싱 결과 보관
          res.push({ filename: file.name, date: parsed.dateStr, status: "manual", parsed });
        }
      } catch (err) {
        console.error(err);
        res.push({ filename: file.name, status: "error", error: err.message });
      }
    }
    setResults(res);
    setProcessing(false);
    await reload();
    if (lastDate) { setStation("전체"); setMonthRange(lastDate.substring(0, 7)); }
  }, [reload, setMonthRange]);

  // 자동 인식 실패 파일을 수동으로 주유소 지정 후 업로드
  const assignManual = useCallback(async (idx, stationName) => {
    const st = STATIONS.find(s => s.name === stationName);
    const item = results[idx];
    if (!st || !item?.parsed) return;
    try {
      await supaUpsert(st.name, st.group, item.parsed);
      setResults(rs => rs.map((r, i) => i === idx ? { filename: r.filename, station: st.name, date: r.date, status: "done" } : r));
      await reload();
      setMonthRange(item.date.substring(0, 7));
    } catch (err) {
      setResults(rs => rs.map((r, i) => i === idx ? { ...r, status: "error", error: err.message } : r));
    }
  }, [results, reload, setMonthRange]);

  // ── 구간 필터 ──────────────────────────────────────────────────
  const rangeRows = rows.filter(r => r.date && r.date >= dateFrom && r.date <= dateTo);
  const months = [...new Set(rows.map(r => r.date?.substring(0, 7)).filter(Boolean))].sort();
  const allDates = rows.map(r => r.date).filter(Boolean).sort();
  const isAllRange = allDates.length > 0 && dateFrom === allDates[0] && dateTo === allDates[allDates.length - 1];

  // ── 주유소별 집계 ──────────────────────────────────────────────
  function aggregate(list) {
    const dates = new Set();
    let gas = 0, diesel = 0, kero = 0, free = 0, paid = 0, washAmt = 0;
    let latest = null;
    list.forEach(r => {
      dates.add(r.date);
      gas    += r.gasoline_qty    || 0;
      diesel += r.diesel_qty      || 0;
      kero   += r.kerosene_qty    || 0;
      free   += r.car_wash_free   || 0;
      paid   += r.car_wash_paid   || 0;
      washAmt += r.car_wash_amount || 0;
      if (!latest || r.date > latest.date) latest = r;
    });
    const nDays = dates.size || 1;
    // 표시값: 평균 모드면 /일수
    const d = (v) => (avgMode ? v / nDays : v);
    // 가용일수: 현재고 ÷ (구간 일평균 판매량)  — 모드와 무관
    const days = (inv, sum) => (sum > 0 ? inv / (sum / nDays) : null);
    return {
      nDays,
      gas: d(gas), diesel: d(diesel), kero: d(kero),
      total: d(gas + diesel + kero),
      free: d(free), paid: d(paid), washAmt: d(washAmt),
      gasInv:    latest?.gasoline_inv || 0,
      dieselInv: latest?.diesel_inv   || 0,
      keroInv:   latest?.kerosene_inv || 0,
      gasDays:    days(latest?.gasoline_inv || 0, gas),
      dieselDays: days(latest?.diesel_inv   || 0, diesel),
      keroDays:   days(latest?.kerosene_inv || 0, kero),
      latestDate: latest?.date,
    };
  }

  const stationNames = [...new Set(rangeRows.map(r => r.station_name))];
  const aggs = stationNames.map(name => {
    const sr = rangeRows.filter(r => r.station_name === name);
    const a = aggregate(sr);
    a.name = name;
    a.group = sr[0]?.station_group || STATIONS.find(s => s.name === name)?.group || "";
    return a;
  }).sort((a, b) => groupRank(a.group) - groupRank(b.group) || b.total - a.total); // 운영사 순 → 그룹 내 판매량 많은 순

  // 표시 대상 (전체 or 특정 주유소)
  const visibleAggs = selectedStation === "전체" ? aggs : aggs.filter(a => a.name === selectedStation);

  // 요약 카드용 총계 (표시값 합)
  const grand = visibleAggs.reduce((t, a) => {
    t.gas += a.gas; t.diesel += a.diesel; t.kero += a.kero; t.washAmt += a.washAmt;
    return t;
  }, { gas: 0, diesel: 0, kero: 0, washAmt: 0 });
  const grandTotal = grand.gas + grand.diesel + grand.kero;

  // 상세 뷰: 일별
  const dailyRows = selectedStation !== "전체"
    ? [...rangeRows.filter(r => r.station_name === selectedStation)].sort((a, b) => a.date.localeCompare(b.date))
    : [];

  const stInfo  = STATIONS.find(s => s.name === selectedStation);
  const stColor = GROUP_COLORS[stInfo?.group] || "#2563eb";
  const modeLabel = avgMode ? "일평균" : "합계";

  return (
    <div style={{ paddingBottom: 40 }}>

      {/* ── 업로드 섹션 (여러 파일 자동 분류) ── */}
      <div style={{ marginBottom: 20 }}>
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => !processing && document.getElementById("retail-magam-input").click()}
          style={{
            border: `2px dashed ${drag ? "#2563eb" : "#d1d5db"}`,
            borderRadius: 12, padding: "18px 24px", textAlign: "center",
            cursor: processing ? "default" : "pointer",
            background: drag ? "rgba(37,99,235,0.04)" : "#fafafa", transition: "all 0.2s",
          }}
        >
          {processing ? (
            <div style={{ color: "#9ca3af", fontSize: 13 }}>파싱 중...</div>
          ) : (
            <>
              <div style={{ fontSize: 22, marginBottom: 6 }}>📂</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>마감일보 파일을 한 번에 드롭 또는 클릭 (여러 개 동시 가능)</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>주유소는 파일에서 자동 인식 · .xls / .xlsx / .xlsm</div>
            </>
          )}
          <input
            id="retail-magam-input"
            type="file"
            accept=".csv,.xls,.xlsx,.xlsm"
            multiple
            style={{ display: "none" }}
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        {/* 업로드 결과 목록 */}
        {results.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((r, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                padding: "8px 12px", borderRadius: 8, fontSize: 12,
                background: r.status === "done" ? "rgba(22,163,74,0.06)" : r.status === "error" ? "rgba(239,68,68,0.06)" : "#fff7ed",
                border: `1px solid ${r.status === "done" ? "#bbf7d0" : r.status === "error" ? "#fecaca" : "#fed7aa"}`,
              }}>
                <span style={{ fontSize: 13 }}>{r.status === "done" ? "✓" : r.status === "error" ? "✕" : "?"}</span>
                <span style={{ fontWeight: 600, color: "#374151" }}>{r.filename}</span>
                {r.status === "done" && <span style={{ color: "#16a34a" }}>{r.station} · {r.date} 완료</span>}
                {r.status === "error" && <span style={{ color: "#ef4444" }}>{r.error}</span>}
                {r.status === "manual" && (
                  <>
                    <span style={{ color: "#c2410c" }}>주유소 자동 인식 실패 — 직접 선택:</span>
                    <select defaultValue="" onChange={e => e.target.value && assignManual(i, e.target.value)}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e5e7eb", fontSize: 12, background: "#fff" }}>
                      <option value="" disabled>주유소 선택</option>
                      {STATIONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                  </>
                )}
              </div>
            ))}
            <button onClick={() => setResults([])}
              style={{ alignSelf: "flex-start", marginTop: 2, padding: "4px 10px", fontSize: 11, color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              결과 지우기
            </button>
          </div>
        )}
      </div>

      {/* ── 테이블 미생성 안내 ── */}
      {tableError && (
        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 12, padding: "16px 20px", marginBottom: 20, fontSize: 13, color: "#92400e" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Supabase 테이블 설정 필요</div>
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
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
            <select
              value={selectedStation}
              onChange={e => setStation(e.target.value)}
              style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #e5e7eb", fontSize: 13, color: "#111827", background: "#fff", cursor: "pointer", minWidth: 150 }}
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

            {/* 날짜 구간 */}
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={dateInput} />
            <span style={{ fontSize: 12, color: "#9ca3af" }}>~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={dateInput} />

            {/* 평균 토글 */}
            <button onClick={() => setAvgMode(v => !v)} style={toggleBtn(avgMode)}>
              평균
            </button>
            {/* 등유 토글 */}
            <button onClick={() => setShowKero(v => !v)} style={toggleBtn(showKero)}>
              등유
            </button>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              {modeLabel} · 유류 DM(1DM=200L) · 세차매출 천원
            </span>
          </div>

          {/* 월 칩 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <button
              onClick={() => { if (allDates.length) { setDateFrom(allDates[0]); setDateTo(allDates[allDates.length - 1]); } }}
              style={chipStyle(isAllRange)}
            >전체</button>
            {months.map(m => {
              const active = dateFrom === `${m}-01` && dateTo === `${m}-${String(monthLastDay(m)).padStart(2, "0")}`;
              return (
                <button key={m} onClick={() => setMonthRange(m)} style={chipStyle(active)}>
                  {m.replace("-", "년 ")}월
                </button>
              );
            })}
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 20 }}>
            {[
              { label: `총 판매량 (${modeLabel})`, value: fmtDM(grandTotal),  unit: "DM", color: "#111827" },
              { label: "휘발유", value: fmtDM(grand.gas),    unit: "DM", color: C_GAS },
              { label: "경유",   value: fmtDM(grand.diesel), unit: "DM", color: C_DIESEL },
              ...(showKero ? [{ label: "등유", value: fmtDM(grand.kero), unit: "DM", color: C_KERO }] : []),
              { label: "세차매출", value: fmtKW(grand.washAmt), unit: "천원", color: C_WASH },
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

          {/* ── 전체: 주유소별 통합 현황판 ── */}
          {selectedStation === "전체" && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", fontSize: 14, fontWeight: 700, color: "#111827" }}>
                주유소별 판매 현황
                <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>
                  {dateFrom} ~ {dateTo} · 유류 {modeLabel}(DM) · 세차매출 천원 · 클릭하여 상세
                </span>
              </div>
              {aggs.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>해당 구간에 데이터가 없습니다</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: showKero ? 1100 : 920 }}>
                    <thead>
                      <tr>
                        <th rowSpan={2} style={gh("left", false)}>주유소</th>
                        <th rowSpan={2} style={gh("left", false)}>운영사</th>
                        <th rowSpan={2} style={gh("center", false)}>일수</th>
                        <th colSpan={showKero ? 4 : 3} style={gh("center", true, SEC_HEAD.sales)}>유류판매 ({modeLabel}·DM)</th>
                        <th colSpan={showKero ? 3 : 2} style={gh("center", true, SEC_HEAD.inv)}>현재고 (DM)</th>
                        <th colSpan={showKero ? 3 : 2} style={gh("center", true, SEC_HEAD.days)}>가용일수</th>
                        <th colSpan={3} style={gh("center", true, SEC_HEAD.wash)}>세차</th>
                      </tr>
                      <tr>
                        <th style={sh(C_GAS,    SEC_HEAD.sales, true)}>무연</th>
                        <th style={sh(C_DIESEL, SEC_HEAD.sales)}>경유</th>
                        {showKero && <th style={sh(C_KERO, SEC_HEAD.sales)}>등유</th>}
                        <th style={sh("#111827", SEC_HEAD.sales)}>판매계</th>
                        <th style={sh(C_GAS,    SEC_HEAD.inv, true)}>무연</th>
                        <th style={sh(C_DIESEL, SEC_HEAD.inv)}>경유</th>
                        {showKero && <th style={sh(C_KERO, SEC_HEAD.inv)}>등유</th>}
                        <th style={sh(C_GAS,    SEC_HEAD.days, true)}>무연</th>
                        <th style={sh(C_DIESEL, SEC_HEAD.days)}>경유</th>
                        {showKero && <th style={sh(C_KERO, SEC_HEAD.days)}>등유</th>}
                        <th style={sh("#6b7280", SEC_HEAD.wash, true)}>무료</th>
                        <th style={sh("#6b7280", SEC_HEAD.wash)}>유료</th>
                        <th style={sh(C_WASH,   SEC_HEAD.wash)}>매출(천원)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggs.map(a => {
                        const color = GROUP_COLORS[a.group] || "#6b7280";
                        const hv = hoverRow === a.name;
                        const S = hv ? SEC_HOVER : SEC_CELL;
                        const nameBg = hv ? "#eef4ff" : "#fff";
                        return (
                          <tr key={a.name}
                            onClick={() => setStation(a.name)}
                            onMouseEnter={() => setHoverRow(a.name)}
                            onMouseLeave={() => setHoverRow(null)}
                            style={{ cursor: "pointer" }}
                          >
                            <td style={{ ...td("left"), fontWeight: 600, background: nameBg }}>{a.name}</td>
                            <td style={{ ...td("left"), background: nameBg }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: `${color}18`, color, borderRadius: 6 }}>{a.group}</span>
                            </td>
                            <td style={{ ...td("center"), background: nameBg, color: "#6b7280", fontSize: 12 }}>{a.nDays}일</td>
                            <td style={secTd(S.sales, true,  a.gas    > 0 ? C_GAS : "#c9cdd3")}>{fmtDM(a.gas)}</td>
                            <td style={secTd(S.sales, false, a.diesel > 0 ? C_DIESEL : "#c9cdd3")}>{fmtDM(a.diesel)}</td>
                            {showKero && <td style={secTd(S.sales, false, a.kero > 0 ? C_KERO : "#c9cdd3")}>{fmtDM(a.kero)}</td>}
                            <td style={{ ...secTd(S.sales, false, "#111827"), fontWeight: 700 }}>{fmtDM(a.total)}</td>
                            <td style={secTd(S.inv, true,  "#374151")}>{fmtDM(a.gasInv)}</td>
                            <td style={secTd(S.inv, false, "#374151")}>{fmtDM(a.dieselInv)}</td>
                            {showKero && <td style={secTd(S.inv, false, "#374151")}>{fmtDM(a.keroInv)}</td>}
                            <td style={{ ...secTd(S.days, true,  daysColor(a.gasDays)),    fontWeight: 700 }}>{fmtDays(a.gasDays)}</td>
                            <td style={{ ...secTd(S.days, false, daysColor(a.dieselDays)), fontWeight: 700 }}>{fmtDays(a.dieselDays)}</td>
                            {showKero && <td style={{ ...secTd(S.days, false, daysColor(a.keroDays)), fontWeight: 700 }}>{fmtDays(a.keroDays)}</td>}
                            <td style={secTd(S.wash, true,  a.free > 0 ? "#374151" : "#c9cdd3")}>{fmtCnt(a.free)}</td>
                            <td style={secTd(S.wash, false, a.paid > 0 ? "#374151" : "#c9cdd3")}>{fmtCnt(a.paid)}</td>
                            <td style={secTd(S.wash, false, C_WASH)}>{fmtKW(a.washAmt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "2px solid #c7d7f5" }}>
                        <td style={{ ...td("left"), fontWeight: 700, background: "#eef2f7" }} colSpan={3}>합계</td>
                        <td style={{ ...secTd(SEC_HOVER.sales, true,  C_GAS),    fontWeight: 700 }}>{fmtDM(grand.gas)}</td>
                        <td style={{ ...secTd(SEC_HOVER.sales, false, C_DIESEL), fontWeight: 700 }}>{fmtDM(grand.diesel)}</td>
                        {showKero && <td style={{ ...secTd(SEC_HOVER.sales, false, C_KERO), fontWeight: 700 }}>{fmtDM(grand.kero)}</td>}
                        <td style={{ ...secTd(SEC_HOVER.sales, false, "#111827"), fontWeight: 700 }}>{fmtDM(grandTotal)}</td>
                        {/* 재고·가용일수 합계는 의미가 없어 생략 */}
                        <td style={secTd(SEC_HOVER.inv, true, "#374151")} colSpan={showKero ? 3 : 2} />
                        <td style={secTd(SEC_HOVER.days, true, "#374151")} colSpan={showKero ? 3 : 2} />
                        <td style={{ ...secTd(SEC_HOVER.wash, true,  "#374151"), fontWeight: 700 }}>{fmtCnt(visibleAggs.reduce((s, a) => s + a.free, 0))}</td>
                        <td style={{ ...secTd(SEC_HOVER.wash, false, "#374151"), fontWeight: 700 }}>{fmtCnt(visibleAggs.reduce((s, a) => s + a.paid, 0))}</td>
                        <td style={{ ...secTd(SEC_HOVER.wash, false, C_WASH), fontWeight: 700 }}>{fmtKW(grand.washAmt)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── 상세: 개별 주유소 ── */}
          {selectedStation !== "전체" && (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ padding: "14px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => setStation("전체")}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af", fontSize: 16, padding: "0 4px", lineHeight: 1 }}
                  >←</button>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{selectedStation}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", background: `${stColor}18`, color: stColor, borderRadius: 6 }}>{stInfo?.group}</span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>유류 DM · 세차매출 천원</div>
              </div>

              {/* 재고 현황 & 가용일수 */}
              {visibleAggs[0] && (
                <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", background: "#fbfcfe" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 10 }}>
                    재고 현황 · 가용일수
                    <span style={{ fontWeight: 400, color: "#9ca3af", marginLeft: 6 }}>
                      {visibleAggs[0].latestDate} 기준 · 구간 일평균 판매량({visibleAggs[0].nDays}일)
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                    {[
                      { label: "휘발유", color: C_GAS,    inv: visibleAggs[0].gasInv,    days: visibleAggs[0].gasDays },
                      { label: "경유",   color: C_DIESEL, inv: visibleAggs[0].dieselInv, days: visibleAggs[0].dieselDays },
                      ...(showKero || visibleAggs[0].keroInv > 0
                        ? [{ label: "등유", color: C_KERO, inv: visibleAggs[0].keroInv, days: visibleAggs[0].keroDays }] : []),
                    ].filter(f => f.inv > 0 || f.days != null).map(f => (
                      <div key={f.label} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: f.color }}>{f.label}</span>
                          <span style={{ fontSize: 20, fontWeight: 800, color: daysColor(f.days) }}>
                            {fmtDays(f.days)}<span style={{ fontSize: 11, fontWeight: 500, color: "#9ca3af", marginLeft: 2 }}>일</span>
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "#6b7280", display: "flex", justifyContent: "space-between" }}>
                          <span>현재고</span><span style={{ color: "#111827", fontWeight: 700 }}>{fmtDM(f.inv)} DM</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {dailyRows.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>해당 구간에 데이터가 없습니다</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f9fafb" }}>
                        <th style={th("left")}>날짜</th>
                        <th style={{ ...th("right"), color: C_GAS }}>무연</th>
                        <th style={{ ...th("right"), color: C_DIESEL }}>경유</th>
                        {showKero && <th style={{ ...th("right"), color: C_KERO }}>등유</th>}
                        <th style={{ ...th("right"), fontWeight: 700 }}>판매계</th>
                        <th style={{ ...th("right"), color: "#6b7280" }}>세차무료</th>
                        <th style={{ ...th("right"), color: "#6b7280" }}>세차유료</th>
                        <th style={{ ...th("right"), color: C_WASH }}>세차(천원)</th>
                        <th style={{ ...th("right"), color: "#9ca3af" }}>재고무연</th>
                        <th style={{ ...th("right"), color: "#9ca3af" }}>재고경유</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyRows.map(r => {
                        const rowTotal = (r.gasoline_qty || 0) + (r.diesel_qty || 0) + (r.kerosene_qty || 0);
                        return (
                          <tr key={r.date}>
                            <td style={{ ...td("left"), color: "#6b7280" }}>{r.date}</td>
                            <td style={{ ...td("right"), color: r.gasoline_qty > 0 ? C_GAS : "#d1d5db" }}>{fmtDM(r.gasoline_qty)}</td>
                            <td style={{ ...td("right"), color: r.diesel_qty   > 0 ? C_DIESEL : "#d1d5db" }}>{fmtDM(r.diesel_qty)}</td>
                            {showKero && <td style={{ ...td("right"), color: r.kerosene_qty > 0 ? C_KERO : "#d1d5db" }}>{fmtDM(r.kerosene_qty)}</td>}
                            <td style={{ ...td("right"), fontWeight: 600 }}>{fmtDM(rowTotal)}</td>
                            <td style={{ ...td("right"), color: (r.car_wash_free || 0) > 0 ? "#374151" : "#d1d5db" }}>{fmtCnt(r.car_wash_free)}</td>
                            <td style={{ ...td("right"), color: (r.car_wash_paid || 0) > 0 ? "#374151" : "#d1d5db" }}>{fmtCnt(r.car_wash_paid)}</td>
                            <td style={{ ...td("right"), color: C_WASH }}>{fmtKW(r.car_wash_amount)}</td>
                            <td style={{ ...td("right"), color: "#9ca3af", fontSize: 12 }}>{fmtDM(r.gasoline_inv)}</td>
                            <td style={{ ...td("right"), color: "#9ca3af", fontSize: 12 }}>{fmtDM(r.diesel_inv)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: "#f0f4ff", borderTop: "2px solid #c7d7f5" }}>
                        <td style={{ ...td("left"), fontWeight: 700 }}>{modeLabel}</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: C_GAS }}>{fmtDM(grand.gas)}</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: C_DIESEL }}>{fmtDM(grand.diesel)}</td>
                        {showKero && <td style={{ ...td("right"), fontWeight: 700, color: C_KERO }}>{fmtDM(grand.kero)}</td>}
                        <td style={{ ...td("right"), fontWeight: 700 }}>{fmtDM(grandTotal)}</td>
                        <td style={{ ...td("right"), fontWeight: 700 }}>{fmtCnt(visibleAggs[0]?.free || 0)}</td>
                        <td style={{ ...td("right"), fontWeight: 700 }}>{fmtCnt(visibleAggs[0]?.paid || 0)}</td>
                        <td style={{ ...td("right"), fontWeight: 700, color: C_WASH }}>{fmtKW(grand.washAmt)}</td>
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
  padding: "10px 14px", textAlign: align, fontWeight: 600, color: "#374151",
  fontSize: 12, borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
});
// 그룹 헤더 (상단)
const gh = (align, bordered, bg) => ({
  padding: "8px 12px", textAlign: align, fontWeight: 700, color: "#374151",
  fontSize: 12, background: bg || "#f9fafb",
  borderBottom: "1px solid #e5e7eb",
  borderLeft: bordered ? "1px solid #eef0f3" : undefined,
  whiteSpace: "nowrap", verticalAlign: "middle",
});
// 서브 헤더 (하단, 유종)
const sh = (color, bg, first) => ({
  padding: "7px 12px", textAlign: "right", fontWeight: 600, color,
  fontSize: 11, background: bg || "#f9fafb", borderBottom: "1px solid #e5e7eb",
  borderLeft: first ? "1px solid #dfe3e8" : undefined, whiteSpace: "nowrap",
});
const td = (align) => ({
  padding: "9px 12px", textAlign: align, borderBottom: "1px solid #f3f4f6",
  color: "#374151", whiteSpace: "nowrap",
});
// 구역별 색상 (헤더=진하게, 데이터=옅게, hover=중간)
const SEC_HEAD  = { sales: "#dbe6ff", inv: "#d3f5e0", days: "#ffe6cc", wash: "#ecdcff" };
const SEC_CELL  = { sales: "#f5f8ff", inv: "#f4fdf8", days: "#fffbf4", wash: "#fbf7ff" };
const SEC_HOVER = { sales: "#e9f0ff", inv: "#e6f8ee", days: "#fdf2e2", wash: "#f4ebff" };
// 구역 데이터 셀 (배경 + 구역 시작 경계선 + 글자색)
const secTd = (bg, first, color) => ({
  padding: "9px 12px", textAlign: "right", borderBottom: "1px solid #f3f4f6",
  background: bg, color, whiteSpace: "nowrap",
  borderLeft: first ? "1px solid #dfe3e8" : undefined,
});
const chipStyle = (active) => ({
  padding: "6px 12px", borderRadius: 8, border: "none", fontSize: 12, cursor: "pointer",
  fontWeight: 600, background: active ? "#2563eb" : "#f3f4f6", color: active ? "#fff" : "#6b7280",
  transition: "all 0.15s",
});
const toggleBtn = (active) => ({
  padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontWeight: 700,
  border: `1.5px solid ${active ? "#2563eb" : "#e5e7eb"}`,
  background: active ? "#2563eb" : "#fff", color: active ? "#fff" : "#6b7280",
  transition: "all 0.15s",
});
const dateInput = {
  fontSize: 12, padding: "7px 8px", border: "1.5px solid #e5e7eb",
  borderRadius: 8, background: "#fff", color: "#111827",
};
