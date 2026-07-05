// retailParser.js — 소매 주유소 마감일보 순수 파싱 로직 (브라우저·Node 공용)
//
// 이 파일은 화면(React)·저장(Supabase)에 의존하지 않는다.
//   · 브라우저: RetailSalesReport.jsx 가 import → 드롭 업로드 파싱
//   · Node(Hermes): NAS에서 받은 엑셀을 같은 로직으로 파싱 → 결과 불일치 방지
// 엑셀(workbook) 을 넣으면 구조화된 데이터가 나온다. 그 이상은 하지 않는다.

import * as XLSX from "xlsx";

// aliases: 파일 자동 분류용 키워드 (파일 내 주유소명 + 파일명에서 탐색). 서로 겹치지 않게 유지
export const STATIONS = [
  { name: "통일로일품주유소", group: "세영TMS",  aliases: ["일품"] },
  { name: "남부순환로주유소", group: "세영TMS",  aliases: ["남부순환"] },
  { name: "용인1주유소",      group: "엘앤케이", aliases: ["용인"] },
  { name: "김포2주유소",      group: "엘앤케이", aliases: ["김포"] },
  { name: "박달주유소",       group: "세일직영", aliases: ["박달"] },
  { name: "안양주유소",       group: "세일직영", aliases: ["안양"] },
  { name: "광교주유소",       group: "세일직영", aliases: ["광교"] },
];

// ── 파싱 유틸 ────────────────────────────────────────────────────
export function parseNum(val) {
  if (val === undefined || val === null) return 0;
  if (typeof val === "number") return val;
  const s = String(val).replace(/,/g, "").trim();
  if (!s || s === "-") return 0;
  return parseFloat(s) || 0;
}

// 워크북 + 파일명으로 주유소 자동 판별. 정확히 1곳만 매칭될 때만 반환(모호하면 null → 수동 지정)
export function detectStation(workbook, filename) {
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
export function parseMagamReport(workbook) {
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
// 한 파일 → 2개소 × 그 달 일수 만큼의 일별 행을 만들어 반환.
const LNK_DAILY_RE = /^\d{2}\.\d{2}\((.+)\)$/; // "26.06(용인제1)" → 캡처: "용인제1"

// 엘앤케이 통합 파일 여부 (일자별 시트 패턴 존재). 세일·세영 마감일보엔 이런 시트명이 없어 오탐 불가
export function isLnkWorkbook(wb) {
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
export function parseLnkWorkbook(wb) {
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

// ── 고수준 진입점 ────────────────────────────────────────────────
// 워크북 하나 + 파일명 → 저장에 필요한 구조화 결과. 저장(Supabase)은 하지 않는다.
//   { type: "lnk",    items: [{stationName, group, parsed}, …] }   // 엘앤케이 월간 통합
//   { type: "magam",  station: {name, group}, parsed }             // 일반 마감일보 (주유소 자동인식됨)
//   { type: "manual", parsed }                                     // 마감일보지만 주유소 인식 실패 → 수동 지정 필요
// 파싱 불가 시 throw (호출측에서 error 처리)
export function parseWorkbook(workbook, filename) {
  if (isLnkWorkbook(workbook)) {
    const items = parseLnkWorkbook(workbook);
    if (!items.length) throw new Error("엘앤케이 일자별 데이터를 찾지 못했습니다");
    return { type: "lnk", items };
  }
  const parsed = parseMagamReport(workbook);
  const st = detectStation(workbook, filename);
  return st ? { type: "magam", station: st, parsed } : { type: "manual", parsed };
}

// ── 날짜 유틸 ────────────────────────────────────────────────────
export const monthLastDay = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
