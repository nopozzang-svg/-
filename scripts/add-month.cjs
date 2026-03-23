// ============================================================
//  add-month.cjs  –  확정 월 데이터를 history JSON에 추가
//
//  사용법:
//    node scripts/add-month.cjs [수도권파일] [영남권파일] [연-월]
//
//  예시 (26년 3월 확정 후):
//    node scripts/add-month.cjs \
//      "C:/경로/수도권 26년 3월.xls" \
//      "C:/경로/영남권 26년 3월.xls" \
//      2026-03
//
//  ※ 연-월을 지정하면 해당 월의 기존 데이터를 덮어씁니다.
//  ※ 연-월 생략 시 파일 내 날짜 범위 전체를 추가합니다.
// ============================================================

const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");

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
  return m || null;
}

function parseFile(filePath, jiyeok, minDate, maxDate) {
  if (!fs.existsSync(filePath)) {
    console.error(`파일 없음: ${filePath}`);
    return [];
  }
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const rows = [];
  for (let r = 6; r <= range.e.r; r++) {
    const get = (c) => { const cell = ws[XLSX.utils.encode_cell({ r, c })]; return cell ? cell.v : ""; };
    const qty = parseFloat(String(get(16)).replace(/,/g, "")) || 0;
    if (qty <= 0) continue;
    const yj = YUJONG_MAP[String(get(13) || "").trim()];
    if (!yj) continue;
    const ds = String(get(0)).substring(0, 10);
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
  console.log(`  ${jiyeok}: ${rows.length}건`);
  return rows;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("사용법: node scripts/add-month.cjs [수도권파일] [영남권파일] [연-월(선택)]");
    console.log("예시:   node scripts/add-month.cjs \"C:/경로/수도권.xls\" \"C:/경로/영남권.xls\" 2026-03");
    process.exit(1);
  }

  const sudoFile = args[0];
  const youngFile = args[1];
  const targetMonth = args[2] || null; // 예: "2026-03"

  let minDate = null, maxDate = null;
  if (targetMonth) {
    const [y, m] = targetMonth.split("-");
    const last = new Date(+y, +m, 0).getDate();
    minDate = `${targetMonth}-01`;
    maxDate = `${targetMonth}-${String(last).padStart(2, "0")}`;
  }

  console.log(`\n추가할 기간: ${minDate || "파일 전체"} ~ ${maxDate || ""}`);

  const newRows = [
    ...parseFile(sudoFile, "수도권", minDate, maxDate),
    ...parseFile(youngFile, "영남권", minDate, maxDate),
  ];

  if (newRows.length === 0) {
    console.log("추가할 데이터 없음.");
    return;
  }

  // 기존 history 로드
  const histPath = path.join(__dirname, "..", "public", "sales_history.json");
  let existing = [];
  if (fs.existsSync(histPath)) {
    existing = JSON.parse(fs.readFileSync(histPath, "utf-8"));
    console.log(`기존 history: ${existing.length}건`);
  }

  // 해당 월+지역 기존 데이터 제거 후 새 데이터 추가
  const filtered = minDate
    ? existing.filter((r) => r.date < minDate || r.date > maxDate)
    : existing;

  const merged = [...filtered, ...newRows].sort((a, b) => a.date.localeCompare(b.date));

  fs.writeFileSync(histPath, JSON.stringify(merged), "utf-8");

  const dates = merged.map((r) => r.date).sort();
  const totalKL = Math.round(merged.reduce((s, r) => s + r.qty, 0) / 1000);
  console.log(`\n업데이트 완료: ${merged.length}건 (${totalKL.toLocaleString()} kL)`);
  console.log(`기간: ${dates[0]} ~ ${dates[dates.length - 1]}`);
  console.log(`저장: ${histPath}`);
}

main();
