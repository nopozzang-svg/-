// ============================================================
//  parse-history.js
//  사용법: node scripts/parse-history.js [수도권파일] [영남권파일]
//
//  기본 경로:
//    수도권: C:/Users/nopoz/Desktop/매출처원장/수도권 25년 26년.xls
//    영남권: C:/Users/nopoz/Desktop/매출처원장/영남권 25년 26년.xls
//
//  출력: public/sales_history.json (앱 시작 시 자동 로드)
// ============================================================

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

// ── 유종 매핑 ─────────────────────────────────────────────
const YUJONG_MAP = {
  고급휘발유: "PG",
  휘발유: "G",
  "휘발유(수입)": "G",
  등유: "K",
  "등유(수입)": "K",
  경유: "D",
  "경유(수입)": "D",
  화물차우대: "D",
  "공공조달(경유)": "D",
};

// ── 매입처 → 대구분 고정 매핑 ─────────────────────────────
const MAIP_DG_EXACT = {
  "한화토탈 주식회사": "06.한화토탈",
  "극동유화 (주) - 매입": "02.극동유화",
  "마블에너지(매입)": "13.마블에너지",
  "서울석유(주)": "07.서울석유",
  "(주) 지에스이앤알 - 매입": "11.지에스이앤알",
  "성림엔에스티 주식회사 -매입": "성림엔에스티",
  "모두화학 주식회사(매입)": "모두화학",
  "타이틀유화(주)-매입": "타이들유화",
  "주식회사 이에이치에너지-매입": "이에이치에너지",
  "이아이디에너지(매입)": "이아이디에너지",
  "서울이엔지(주)-매입": "서울이엔지",
  "오일마스터(매입)": "오일마스터",
  "주식회사 세일 서울지점 (매입)": "세일서울지점",
};

// ── 대구분 매핑 함수 ───────────────────────────────────────
function mapDG(maip, teuk, jiyeok, jeoyuso, jeojangso) {
  const m = (maip || "").trim();
  const t = (teuk || "").trim().toLowerCase();
  const yu = (jeoyuso || "").trim();
  const jo = (jeojangso || "").trim();

  if (MAIP_DG_EXACT[m]) return MAIP_DG_EXACT[m];

  if (m.includes("원일유통")) {
    if (yu.includes("평택한일") || yu.includes("한일평택") || jo.includes("평택한일") || jo.includes("한일평택")) return "원일유통_평택한일";
    if (jiyeok === "영남권") return "12.원일유통 영남권";
    if (t.includes("hd") || t.includes("현대")) return "04.원일유통_현대";
    return "03.원일유통_중부본부";
  }
  if (m.includes("S-OIL") || m.includes("s-oil")) {
    if (t.includes("세일 보관출하") || t.includes("한일")) return "09.인천한일탱크";
    return "01.대리점영업팀";
  }
  if (m.includes("극동유화")) return "02.극동유화";
  if (m.includes("한화토탈")) return "06.한화토탈";
  if (m.includes("서울석유")) return "07.서울석유";
  if (m.includes("마블에너지")) return "13.마블에너지";
  if (m.includes("지에스이앤알") || m.includes("GS이앤알")) return "11.지에스이앤알";
  if (m.includes("인천한일") || m.includes("한일탱크")) return "09.인천한일탱크";
  if (m.includes("성림엔에스티")) return "성림엔에스티";
  if (m.includes("모두화학")) return "모두화학";
  if (m.includes("타이틀유화") || m.includes("타이들유화")) return "타이들유화";
  if (m.includes("이에이치에너지")) return "이에이치에너지";
  if (m.includes("이아이디에너지")) return "이아이디에너지";

  // 알 수 없는 매입처 → 매입처명 그대로 사용 (기타 항목으로 표시)
  return m || null;
}

// ── 파일 파싱 ──────────────────────────────────────────────
function parseFile(filePath, jiyeok, minDate, maxDate) {
  if (!fs.existsSync(filePath)) {
    console.error(`파일 없음: ${filePath}`);
    return [];
  }

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws["!ref"]);

  const rows = [];
  let skipped = 0;

  for (let r = 6; r <= range.e.r; r++) {
    const get = (c) => {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      return cell ? cell.v : "";
    };

    const qty = parseFloat(String(get(16)).replace(/,/g, "")) || 0;
    if (qty <= 0) continue;

    const yjRaw = String(get(13) || "").trim();
    const yj = YUJONG_MAP[yjRaw];
    if (!yj) { skipped++; continue; } // 추가정산 등 제외

    const dv = get(0);
    const ds = String(dv).substring(0, 10);
    if (!ds.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    if (minDate && ds < minDate) continue;
    if (maxDate && ds > maxDate) continue;

    const maip = String(get(5) || "").trim();
    const teuk = String(get(44) || "").trim();
    const jeoyuso = String(get(31) || "").trim();
    const jeojangso = String(get(29) || "").trim();
    const dg = mapDG(maip, teuk, jiyeok, jeoyuso, jeojangso);
    if (!dg) continue;

    rows.push({ date: ds, dg, jiyeok, yj, qty, maip, teuk });
  }

  console.log(`  ${jiyeok}: ${rows.length}건 파싱 (${skipped}건 제외)`);
  return rows;
}

// ── 메인 ──────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const sudoFile = args[0] || "C:/Users/nopoz/Desktop/매출처원장/수도권 25년 26년.xls";
  const youngFile = args[1] || "C:/Users/nopoz/Desktop/매출처원장/영남권 25년 26년.xls";
  const minDate = args[2] || null; // 예: "2025-01-01"
  const maxDate = args[3] || null; // 예: "2026-02-28"

  console.log("파싱 시작...");
  console.log(`  수도권 파일: ${sudoFile}`);
  console.log(`  영남권 파일: ${youngFile}`);
  if (minDate || maxDate) console.log(`  기간 필터: ${minDate || "전체"} ~ ${maxDate || "전체"}`);

  const sudoRows = parseFile(sudoFile, "수도권", minDate, maxDate);
  const youngRows = parseFile(youngFile, "영남권", minDate, maxDate);
  const all = [...sudoRows, ...youngRows];

  // 날짜 범위 요약
  const dates = all.map((r) => r.date).sort();
  const totalKL = Math.round(all.reduce((s, r) => s + r.qty, 0) / 1000);
  console.log(`\n총 ${all.length}건 (${totalKL.toLocaleString()} kL)`);
  console.log(`기간: ${dates[0]} ~ ${dates[dates.length - 1]}`);

  // 저장
  const outPath = path.join(__dirname, "..", "public", "sales_history.json");
  fs.writeFileSync(outPath, JSON.stringify(all), "utf-8");
  console.log(`\n저장 완료: ${outPath}`);
}

main();
