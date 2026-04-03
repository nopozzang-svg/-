import { useState, useMemo, useEffect } from "react";
import MopsSection from "./components/MopsSection";
import SalesReport from "./components/SalesReport";
import ConstantsModal from "./components/ConstantsModal";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine
} from "recharts";
import "./App.css";

// API 호출은 /api/opinet 서버리스 프록시를 통해 CORS 우회
const API_PROXY = "/api/opinet";

// ─── Supabase 설정 ───
const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";

/* ══════════════════════════════════════
   국제 지표 히스토리 localStorage 관리
   - 키: "sail_intl_history"
   - 구조: { "YYYY-MM-DD": { wti, dubai, exch, mopsGas, mopsDiesel, mopsKero } }
══════════════════════════════════════ */
const INTL_HISTORY_KEY = "sail_intl_history";


/* Supabase 데이터 없을 때 사용할 전월 평균 폴백 */
const INTL_PREV_MONTH_FALLBACK = {
  "2026-03": { wti: 91, dubai: 128.52, mopsGas: 128.82, mopsKero: 195.38, mopsDiesel: 192.84, exch: 1486.64 },
};

/** 페트로넷/KMBCO history 를 localStorage 에 병합 저장 */
const mergeIntlHistory = (petroData, exchData) => {
  try {
    const stored = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}");

    // 페트로넷 history 병합
    const fields = [
      ["wti",          petroData?.wti?.history],
      ["dubai",        petroData?.dubai?.history],
      ["mopsGas",      petroData?.mopsGasoline?.history],
      ["mopsDiesel",   petroData?.mopsDiesel?.history],
      ["mopsKero",     petroData?.mopsKerosene?.history],
    ];
    fields.forEach(([key, hist]) => {
      if (!hist) return;
      Object.entries(hist).forEach(([date, val]) => {
        if (!stored[date]) stored[date] = {};
        stored[date][key] = val;
      });
    });

    // 환율 history 병합
    if (exchData?.history) {
      Object.entries(exchData.history).forEach(([date, val]) => {
        if (!stored[date]) stored[date] = {};
        stored[date].exch = val;
      });
    }

    localStorage.setItem(INTL_HISTORY_KEY, JSON.stringify(stored));
  } catch (_) {}
};

/** 당월 평균(실적+예상) 계산
 *  - 실적: history 중 당월 데이터
 *  - 예상: 오늘 값이 남은 평일(월~금)까지 유지된다고 가정
 */
const calcMonthStats = (field) => {
  try {
    const stored = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}");
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const year   = nowKST.getUTCFullYear();
    const month  = nowKST.getUTCMonth(); // 0-indexed
    const today  = nowKST.getUTCDate();

    // 당월 실적 데이터 (주말 제외 — carry-forward 방지)
    const monthEntries = Object.entries(stored)
      .filter(([date]) => {
        const d = new Date(date);
        const dow = d.getDay(); // 0=일, 6=토
        return d.getFullYear() === year && d.getMonth() === month && dow !== 0 && dow !== 6;
      })
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v[field])
      .filter(v => v != null && !isNaN(v));

    if (!monthEntries.length) return null;

    const actualSum   = monthEntries.reduce((s, v) => s + v, 0);
    const actualCount = monthEntries.length;
    const todayVal    = monthEntries[monthEntries.length - 1];

    // 말일 이후 남은 평일(월~금) 계산
    const lastDay = new Date(year, month + 1, 0).getDate();
    let remaining = 0;
    for (let d = today + 1; d <= lastDay; d++) {
      const dow = new Date(year, month, d).getDay();
      if (dow !== 0 && dow !== 6) remaining++;
    }

    const projected = (actualSum + todayVal * remaining) / (actualCount + remaining);
    return { actual: actualSum / actualCount, projected, todayVal };
  } catch (_) { return null; }
};

/** 전월 평균 반환 — Supabase에서 로드된 localStorage history 기반 계산 */
const getPrevMonthAvg = (field) => {
  try {
    const stored = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}");
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const year  = nowKST.getUTCMonth() === 0 ? nowKST.getUTCFullYear() - 1 : nowKST.getUTCFullYear();
    const month = nowKST.getUTCMonth() === 0 ? 11 : nowKST.getUTCMonth() - 1; // 0-indexed 전월
    const fallbackKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const values = Object.entries(stored)
      .filter(([date]) => {
        const d = new Date(date);
        const dow = d.getDay();
        return d.getFullYear() === year && d.getMonth() === month && dow !== 0 && dow !== 6;
      })
      .map(([, v]) => v[field])
      .filter(v => v != null && !isNaN(v));
    if (!values.length) return INTL_PREV_MONTH_FALLBACK[fallbackKey]?.[field] ?? null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  } catch (_) { return null; }
};

/** Supabase에서 전일 주유소 스냅샷 + 당월 국제지표를 가져와 localStorage에 병합
 *  → 어느 기기에서 접속해도 전일대비·당월평균이 동일하게 표시됨 */
const loadFromSupabase = async () => {
  try {
    const yesterday   = getKSTYesterdayStr();
    const nowKST      = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const monthStart  = `${nowKST.getUTCFullYear()}-${String(nowKST.getUTCMonth() + 1).padStart(2, "0")}-01`;
    // 전월 첫날 계산 (전월 평균 표시용)
    const prevY = nowKST.getUTCMonth() === 0 ? nowKST.getUTCFullYear() - 1 : nowKST.getUTCFullYear();
    const prevM = nowKST.getUTCMonth() === 0 ? 12 : nowKST.getUTCMonth();
    const prevMonthStart = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
    const supaHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

    const [snapRes, intlRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/station_snapshots?date=eq.${yesterday}&select=snapshot`, { headers: supaHeaders }),
      fetch(`${SUPABASE_URL}/rest/v1/intl_snapshots?date=gte.${prevMonthStart}&select=date,wti,dubai,mops_gas,mops_diesel,mops_kero,exch`, { headers: supaHeaders }),
    ]);

    // 전일 주유소 스냅샷 → localStorage
    if (snapRes.ok) {
      const rows = await snapRes.json();
      if (rows.length > 0 && rows[0].snapshot) {
        const history = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
        // 로컬에 어제 데이터가 없거나 비실시간(_live 없음)인 경우만 덮어쓰기
        if (!history[yesterday]?._live) {
          history[yesterday] = rows[0].snapshot;
          localStorage.setItem(STORE_KEY, JSON.stringify(history));
        }
      }
    }

    // 당월 국제지표 → localStorage
    if (intlRes.ok) {
      const rows = await intlRes.json();
      if (rows.length > 0) {
        const stored = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}");
        rows.forEach(row => {
          if (!stored[row.date]) stored[row.date] = {};
          if (row.wti        != null) stored[row.date].wti        = row.wti;
          if (row.dubai      != null) stored[row.date].dubai      = row.dubai;
          if (row.mops_gas   != null) stored[row.date].mopsGas    = row.mops_gas;
          if (row.mops_diesel != null) stored[row.date].mopsDiesel = row.mops_diesel;
          if (row.mops_kero  != null) stored[row.date].mopsKero   = row.mops_kero;
          if (row.exch       != null) stored[row.date].exch       = row.exch;
        });
        localStorage.setItem(INTL_HISTORY_KEY, JSON.stringify(stored));
      }
    }
  } catch (e) {
    console.warn("Supabase sync failed:", e);
  }
};

/* ══════════════════════════════════════
   전일 가격 localStorage 관리
   - 키: "sail_price_history"
   - 구조: { "2026-02-25": { 지점명: { sg, sd, comp: { 경쟁사명: { g, d } } } } }
   - 최대 7일치 보관, 자동 삭제
══════════════════════════════════════ */
const STORE_KEY = "sail_price_history";

// KST(UTC+9) 기준 날짜 문자열 반환 — UTC 사용 시 한국 자정 전후 날짜 오류 방지
const getKSTDateStr = () => {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
};

// KST 기준 어제 날짜 문자열 반환
const getKSTYesterdayStr = () => {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
};

// KST 기준 "YYYY-MM-DD HH:mm" 문자열 반환
const getKSTDateTimeStr = () => {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("T", " ").substring(0, 16);
};

/** 실제 API 데이터를 localStorage에 저장 — _live:true 마커로 가짜 데이터와 구분 */
const savePricesToLocal = (date, groups) => {
  try {
    // 유효한 가격이 하나도 없으면 저장하지 않음 (API 오류 방어)
    const hasValidPrice = groups.some(g => g.sail.gasoline > 0 || g.sail.diesel > 0);
    if (!hasValidPrice) return;

    const history = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const snapshot = { _live: true }; // 실제 API 데이터임을 표시
    groups.forEach(g => {
      snapshot[g.name] = {
        sg: g.sail.gasoline,   // sail gasoline
        sd: g.sail.diesel,     // sail diesel
        comp: Object.fromEntries(
          g.competitors.map(c => [c.name, { g: c.gasoline, d: c.diesel }])
        ),
      };
    });
    history[date] = snapshot;
    // 7일치만 유지
    const keys = Object.keys(history).sort();
    while (keys.length > 7) delete history[keys.shift()];
    localStorage.setItem(STORE_KEY, JSON.stringify(history));
  } catch (_) { /* localStorage 사용 불가 환경 대응 */ }
};

/** 기존 localStorage에서 _live 마커 없는 오염된 데이터 제거 */
const cleanCorruptedHistory = () => {
  try {
    const history = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    let changed = false;
    Object.keys(history).forEach(date => {
      if (!history[date]?._live) {
        delete history[date];
        changed = true;
      }
    });
    if (changed) localStorage.setItem(STORE_KEY, JSON.stringify(history));
  } catch (_) {}
};

/** 전일 데이터를 가져옴 — _live:true 인 항목만 사용, 어제 우선 탐색 후 최근 날짜 fallback */
const loadPrevDayData = () => {
  try {
    const today = getKSTDateStr();
    const yesterday = getKSTYesterdayStr();
    const history = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    // _live 마커가 있는 어제 데이터 우선 사용
    if (history[yesterday]?._live) return { date: yesterday, snapshot: history[yesterday] };
    // 없으면 오늘 이전 _live 데이터 중 가장 최근 날짜 fallback
    const prevDates = Object.keys(history)
      .filter(d => d < today && history[d]?._live)
      .sort().reverse();
    if (!prevDates.length) return null;
    return { date: prevDates[0], snapshot: history[prevDates[0]] };
  } catch (_) { return null; }
};

/** groups 배열에 이전 날짜 가격을 prevGasoline/prevDiesel로 주입 */
const applyPrevDiffs = (groups, prevData) => {
  if (!prevData) return groups;
  const { snapshot } = prevData;
  return groups.map(g => {
    const ps = snapshot[g.name];
    return {
      ...g,
      sail: {
        ...g.sail,
        prevGasoline: ps?.sg ?? null,
        prevDiesel:   ps?.sd ?? null,
      },
      competitors: g.competitors.map(c => ({
        ...c,
        prevGasoline: ps?.comp?.[c.name]?.g ?? null,
        prevDiesel:   ps?.comp?.[c.name]?.d ?? null,
      })),
    };
  });
};

const STATION_GROUPS = [
  {
    name: "광교신도시", region: "경기 수원", regionCode: "02",
    sail: { id: "A0032871", name: "광교신도시주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0008889", name: "기흥서일",   brand: "GS칼텍스" },
      { id: "A0008895", name: "언남에너지", brand: "S-OIL" },
    ],
  },
  {
    name: "안양", region: "경기 안양", regionCode: "02",
    sail: { id: "A0000180", name: "안양주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0001856", name: "청기와",   brand: "HD현대오일" },
      { id: "A0001905", name: "안양알찬", brand: "S-OIL" },
    ],
  },
  {
    name: "박달", region: "경기 안양", regionCode: "02",
    sail: { id: "A0000263", name: "박달주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0001980", name: "세광 푸른",    brand: "HD현대오일" },
      { id: "A0001938", name: "안양원예농협", brand: "NH-OIL" },
      { id: "A0009185", name: "무지내",       brand: "알뜰" },
      { id: "A0000253", name: "경동고속철",   brand: "HD현대오일" },
    ],
  },
  {
    name: "일품", region: "경기 고양", regionCode: "02",
    sail: { id: "A0005430", name: "일품주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0005555", name: "원흥고양", brand: "HD현대오일" },
      { id: "A0005565", name: "우주",     brand: "S-OIL" },
      { id: "A0005163", name: "너명골",   brand: "S-OIL" },
    ],
  },
  {
    name: "남부순환로", region: "울산 울주", regionCode: "14",
    sail: { id: "A0031528", name: "남부순환로주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0028919", name: "울선",         brand: "GS칼텍스" },
      { id: "A0028937", name: "올리셀프",     brand: "S-OIL" },
      { id: "A0028856", name: "무지개대공원", brand: "SK에너지" },
    ],
  },
  {
    name: "온산", region: "울산 울주", regionCode: "14",
    sail: { id: "A0029052", name: "세일 온산주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0029042", name: "당월",     brand: "S-OIL" },
      { id: "A0029175", name: "온산공단", brand: "S-OIL" },
    ],
  },
  {
    name: "용인제1", region: "경기 용인", regionCode: "02",
    sail: { id: "A0008842", name: "용인제1주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0008792", name: "청정에너지", brand: "S-OIL" },
      { id: "A0008889", name: "기흥서일",   brand: "GS칼텍스" },
    ],
  },
  {
    name: "김포제2", region: "경기 김포", regionCode: "02",
    sail: { id: "A0019433", name: "김포제2주유소", brand: "알뜰" },
    competitors: [
      { id: "A0007874", name: "초원셀프", brand: "S-OIL" },
      { id: "A0007738", name: "대성1",    brand: "GS칼텍스" },
      { id: "A0008977", name: "인에너지", brand: "S-OIL" },
      { id: "A0007957", name: "SK에덴",   brand: "SK에너지" },
    ],
  },
];

const CHAIN_GROUPS = [
  {
    name: "토진", region: "경기 평택시", regionCode: "02",
    sail: { id: "A0033642", name: "토진주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0003404", name: "삼성",      brand: "SK에너지" },
      { id: "A0002949", name: "이케이평택", brand: "HD현대오일뱅크" },
      { id: "A0003023", name: "현곡",      brand: "SK에너지" },
    ],
  },
  {
    name: "문장", region: "경기 여주시", regionCode: "02",
    sail: { id: "A0031202", name: "문장주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0003579", name: "시민석화", brand: "GS칼텍스" },
      { id: "A0003943", name: "이포",    brand: "S-OIL" },
    ],
  },
];

const ALL_GROUPS = [...STATION_GROUPS, ...CHAIN_GROUPS];

/* 등유 대상 지점 (안양, 일품) */
const KEROSENE_GROUPS = [
  {
    name: "안양", region: "경기도 안양시",
    sail: { id: "A0000180", name: "안양주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0001856", name: "청기와",   brand: "HD현대오일" },
      { id: "A0001905", name: "안양알찬", brand: "S-OIL" },
    ],
  },
  {
    name: "일품", region: "경기도 고양시",
    sail: { id: "A0005430", name: "통일로일품주유소", brand: "S-OIL" },
    competitors: [
      { id: "A0005565", name: "우주",       brand: "S-OIL" },
      { id: "A0005163", name: "너명골",     brand: "S-OIL" },
      { id: "A0005162", name: "한솔",       brand: "GS칼텍스" },
      { id: "A0000730", name: "원흥제2",    brand: "HD현대오일뱅크" },
      { id: "A0005121", name: "내유동",     brand: "S-OIL" },
      { id: "A0000154", name: "하늘",       brand: "S-OIL" },
    ],
  },
];

/* 정유사 브랜드 조회 헬퍼 — 직영 + 계열 통합 탐색 */
const getSailBrand = (groupName) =>
  ALL_GROUPS.find(g => g.name === groupName)?.sail.brand ?? "";
const getCompBrand = (groupName, compName) =>
  ALL_GROUPS.find(g => g.name === groupName)
    ?.competitors.find(c => c.name === compName)?.brand ?? "";

const SAMPLE_DATA = {
  date: "2026-02-26",
  nationalAvg: { gasoline: 1691.61, diesel: 1594.93 },
  groups: [
    {
      name: "광교신도시",
      sail:        { gasoline: 1665, diesel: 1595, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "기흥서일",   gasoline: 1665, diesel: 1595, prevGasoline: null, prevDiesel: null },
        { name: "언남에너지", gasoline: 1625, diesel: 1545, prevGasoline: null, prevDiesel: null },
      ],
    },
    {
      name: "안양",
      sail:        { gasoline: 1689, diesel: 1599, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "청기와",   gasoline: 1668, diesel: 1568, prevGasoline: null, prevDiesel: null },
        { name: "안양알찬", gasoline: 1755, diesel: 1695, prevGasoline: null, prevDiesel: null },
      ],
    },
    {
      name: "박달",
      sail:        { gasoline: 1659, diesel: 1579, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "세광 푸른",    gasoline: 1658, diesel: 1538, prevGasoline: null, prevDiesel: null },
        { name: "안양원예농협", gasoline: 1658, diesel: 1538, prevGasoline: null, prevDiesel: null },
        { name: "무지내",       gasoline: 1625, diesel: 1534, prevGasoline: null, prevDiesel: null },
      ],
    },
    {
      name: "일품",
      sail:        { gasoline: 1642, diesel: 1539, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "원흥고양", gasoline: 1614, diesel: 1514, prevGasoline: null, prevDiesel: null },
        { name: "우주",     gasoline: 1624, diesel: 1524, prevGasoline: null, prevDiesel: null },
        { name: "너명골",   gasoline: 1614, diesel: 1514, prevGasoline: null, prevDiesel: null },
      ],
    },
    {
      name: "남부순환로",
      sail:        { gasoline: 1645, diesel: 1545, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "울선",         gasoline: 1615, diesel: 1515, prevGasoline: null, prevDiesel: null },
        { name: "올리셀프",     gasoline: 1615, diesel: 1515, prevGasoline: null, prevDiesel: null },
        { name: "무지개대공원", gasoline: 1625, diesel: 1535, prevGasoline: null, prevDiesel: null },
      ],
    },
    {
      name: "온산",
      sail:        { gasoline: 1678, diesel: 1578, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "당월",     gasoline: 1695, diesel: 1535, prevGasoline: null, prevDiesel: null },
        { name: "온산공단", gasoline: 1685, diesel: 1585, prevGasoline: null, prevDiesel: null },
      ],
    },
    {
      name: "용인제1",
      sail:        { gasoline: 1665, diesel: 1595, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "청정에너지", gasoline: 1655, diesel: 1545, prevGasoline: null, prevDiesel: null },
        { name: "기흥서일",   gasoline: 1665, diesel: 1595, prevGasoline: null, prevDiesel: null },
      ],
    },
    {
      name: "김포제2",
      sail:        { gasoline: 1650, diesel: 1560, prevGasoline: null, prevDiesel: null },
      competitors: [
        { name: "초원셀프", gasoline: 1660, diesel: 1570, prevGasoline: null, prevDiesel: null },
        { name: "대성1",    gasoline: 1655, diesel: 1565, prevGasoline: null, prevDiesel: null },
        { name: "인에너지", gasoline: 1658, diesel: 1568, prevGasoline: null, prevDiesel: null },
        { name: "SK에덴",   gasoline: 1662, diesel: 1572, prevGasoline: null, prevDiesel: null },
      ],
    },
  ],
  trend: [
    { date: "02/20", sail: 1650, competitor: 1637, national: 1690 },
    { date: "02/21", sail: 1652, competitor: 1638, national: 1690 },
    { date: "02/22", sail: 1655, competitor: 1640, national: 1691 },
    { date: "02/23", sail: 1657, competitor: 1641, national: 1691 },
    { date: "02/24", sail: 1658, competitor: 1642, national: 1691 },
    { date: "02/25", sail: 1659, competitor: 1643, national: 1692 },
    { date: "02/26", sail: 1663, competitor: 1644, national: 1692 },
  ],
};

/* 초기 로딩 상태 — 가격 0으로 세팅 (실시간 데이터 오기 전까지 "—" 표시) */
const makeEmptyGroupRows = (groupDefs) => groupDefs.map(g => ({
  name: g.name,
  sail: { name: g.sail.name, gasoline: 0, diesel: 0, prevGasoline: null, prevDiesel: null },
  competitors: g.competitors.map(c => ({ name: c.name, gasoline: 0, diesel: 0, prevGasoline: null, prevDiesel: null })),
}));

const makeEmptyData = () => ({
  date: getKSTDateStr(),
  nationalAvg: { gasoline: 0, diesel: 0 },
  groups: makeEmptyGroupRows(STATION_GROUPS),
  chainGroups: makeEmptyGroupRows(CHAIN_GROUPS),
  trend: SAMPLE_DATA.trend,
});

/* ─── DiffBadge (카드/포지션바용) ─── */
const DiffBadge = ({ value, inverted = false }) => {
  if (value === 0) return <span style={{ color: "#9ca3af", fontSize: 12 }}>0</span>;
  const isPositive = value > 0;
  const color = inverted
    ? (isPositive ? "#ef4444" : "#16a34a")
    : (isPositive ? "#16a34a" : "#ef4444");
  return (
    <span style={{ color, fontSize: 12, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
      {isPositive ? "▲" : "▼"}{Math.abs(value)}
    </span>
  );
};

/* ─── TablePriceDiff (게시가 테이블용) ─── */
const TablePriceDiff = ({ diff, mode }) => {
  if (diff === null || diff === undefined || diff === 0)
    return <span style={{ color: "#d1d5db" }}>—</span>;
  const isUp = diff > 0;
  const color = mode === "vs_sail"
    ? (isUp ? "#16a34a" : "#ef4444")
    : (isUp ? "#f59e0b" : "#3b82f6");
  return (
    <span style={{ color, fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
      {isUp ? "▲" : "▼"}{Math.abs(diff)}
    </span>
  );
};

/* ─── 게시가 현황 테이블 ─── */
const PostedPriceTable = ({ data, groups: groupsProp, prevDate, title }) => {
  const groups = groupsProp || data.groups;
  return (
  <div className="ppt-wrap">
    <div className="ppt-head">
      <span className="ppt-title">{title || "게시가 현황"}</span>
      <div style={{ textAlign: "right" }}>
        <div className="ppt-date">{data.date}</div>
        {prevDate
          ? <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>전일기준: {prevDate}</div>
          : <div style={{ fontSize: 10, color: "#d1d5db", marginTop: 2 }}>전일 데이터 없음 (내일부터 표시)</div>
        }
      </div>
    </div>
    <div className="ppt-scroll">
      <table className="ppt-table">
        <colgroup>
          <col style={{ width: "22%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "13%" }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan="2" className="ppt-th ppt-th-cat">구분</th>
            <th colSpan="3" className="ppt-th ppt-th-gas">무연</th>
            <th colSpan="3" className="ppt-th ppt-th-die">경유</th>
          </tr>
          <tr>
            <th className="ppt-th ppt-th-sub">게시가</th>
            <th className="ppt-th ppt-th-sub">당사대비</th>
            <th className="ppt-th ppt-th-sub">전일대비</th>
            <th className="ppt-th ppt-th-sub">게시가</th>
            <th className="ppt-th ppt-th-sub">당사대비</th>
            <th className="ppt-th ppt-th-sub">전일대비</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((group, gi) => {
            const sail = group.sail;
            const pgDiff = sail.prevGasoline != null ? sail.gasoline - sail.prevGasoline : null;
            const pdDiff = sail.prevDiesel != null ? sail.diesel - sail.prevDiesel : null;
            const rows = [];
            rows.push(
              <tr key={`s-${gi}`} className="ppt-row-sail">
                <td className="ppt-td ppt-name-sail">
                  <div className="ppt-name-sail-row">
                    <span className="ppt-sail-dot" />
                    <span className="ppt-name-sail-text">{group.name}</span>
                  </div>
                  <span className="ppt-brand-label" style={{ paddingLeft: 11 }}>{getSailBrand(group.name)}</span>
                </td>
                <td className="ppt-td ppt-price-sail">{sail.gasoline > 0 ? sail.gasoline.toLocaleString() : <span style={{color:"#d1d5db"}}>—</span>}</td>
                <td className="ppt-td ppt-diff-cell"><span style={{ color: "#d1d5db" }}>—</span></td>
                <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={pgDiff} mode="prev" /></td>
                <td className="ppt-td ppt-price-sail">{sail.diesel > 0 ? sail.diesel.toLocaleString() : <span style={{color:"#d1d5db"}}>—</span>}</td>
                <td className="ppt-td ppt-diff-cell"><span style={{ color: "#d1d5db" }}>—</span></td>
                <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={pdDiff} mode="prev" /></td>
              </tr>
            );
            group.competitors.forEach((comp, ci) => {
              const gd = comp.gasoline - sail.gasoline;
              const dd = comp.diesel - sail.diesel;
              const cpgd = comp.prevGasoline != null ? comp.gasoline - comp.prevGasoline : null;
              const cpdd = comp.prevDiesel != null ? comp.diesel - comp.prevDiesel : null;
              const isLast = ci === group.competitors.length - 1;
              rows.push(
                <tr key={`c-${gi}-${ci}`} className={`ppt-row-comp${isLast ? " ppt-row-last" : ""}`}>
                  <td className="ppt-td ppt-name-comp">
                    <div className="ppt-name-comp-text">{comp.name}</div>
                    <div className="ppt-brand-label">{getCompBrand(group.name, comp.name)}</div>
                  </td>
                  <td className="ppt-td ppt-price-comp">{comp.gasoline > 0 ? comp.gasoline.toLocaleString() : <span style={{color:"#d1d5db"}}>—</span>}</td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={comp.gasoline > 0 && sail.gasoline > 0 ? (gd !== 0 ? gd : null) : null} mode="vs_sail" /></td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={cpgd} mode="prev" /></td>
                  <td className="ppt-td ppt-price-comp">{comp.diesel > 0 ? comp.diesel.toLocaleString() : <span style={{color:"#d1d5db"}}>—</span>}</td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={comp.diesel > 0 && sail.diesel > 0 ? (dd !== 0 ? dd : null) : null} mode="vs_sail" /></td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={cpdd} mode="prev" /></td>
                </tr>
              );
            });
            return rows;
          })}
        </tbody>
      </table>
    </div>
    <div className="ppt-legend">
      <span className="ppt-legend-item"><span style={{ color: "#16a34a", fontWeight: 700 }}>▲</span> 경쟁사 높음 (당사 유리)</span>
      <span className="ppt-legend-item"><span style={{ color: "#ef4444", fontWeight: 700 }}>▼</span> 경쟁사 낮음 (당사 불리)</span>
      <span className="ppt-legend-item"><span style={{ color: "#f59e0b", fontWeight: 700 }}>▲</span> 전일 대비 상승</span>
      <span className="ppt-legend-item"><span style={{ color: "#3b82f6", fontWeight: 700 }}>▼</span> 전일 대비 하락</span>
    </div>
  </div>
  );
};

/* ─── 등유 게시가 현황 테이블 ─── */
const KerosenePriceTable = ({ groups, date, prevDate }) => (
  <div className="ppt-wrap">
    <div className="ppt-head">
      <span className="ppt-title">등유 게시가 현황</span>
      <div style={{ textAlign: "right" }}>
        <div className="ppt-date">{date}</div>
        {prevDate
          ? <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>전일기준: {prevDate}</div>
          : <div style={{ fontSize: 10, color: "#d1d5db", marginTop: 2 }}>전일 데이터 없음</div>
        }
      </div>
    </div>
    <div className="ppt-scroll">
      <table className="ppt-table">
        <colgroup>
          <col style={{ width: "34%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "22%" }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan="2" className="ppt-th ppt-th-cat">구분</th>
            <th colSpan="3" className="ppt-th ppt-th-die">등유</th>
          </tr>
          <tr>
            <th className="ppt-th ppt-th-sub">게시가</th>
            <th className="ppt-th ppt-th-sub">당사대비</th>
            <th className="ppt-th ppt-th-sub">전일대비</th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((group, gi) => {
            const sail = group.sail;
            const rows = [];
            rows.push(
              <tr key={`s-${gi}`} className="ppt-row-sail">
                <td className="ppt-td ppt-name-sail">
                  <div className="ppt-name-sail-row">
                    <span className="ppt-sail-dot" />
                    <span className="ppt-name-sail-text">{sail.name}</span>
                  </div>
                  <span className="ppt-brand-label" style={{ paddingLeft: 11 }}>{sail.brand}</span>
                </td>
                <td className="ppt-td ppt-price-sail">{sail.kerosene > 0 ? sail.kerosene.toLocaleString() : <span style={{color:"#d1d5db"}}>—</span>}</td>
                <td className="ppt-td ppt-diff-cell"><span style={{ color: "#d1d5db" }}>—</span></td>
                <td className="ppt-td ppt-diff-cell"><span style={{ color: "#d1d5db" }}>—</span></td>
              </tr>
            );
            group.competitors.forEach((comp, ci) => {
              const kd = comp.kerosene - sail.kerosene;
              const isLast = ci === group.competitors.length - 1;
              rows.push(
                <tr key={`c-${gi}-${ci}`} className={`ppt-row-comp${isLast ? " ppt-row-last" : ""}`}>
                  <td className="ppt-td ppt-name-comp">
                    <div className="ppt-name-comp-text">{comp.name}</div>
                    <div className="ppt-brand-label">{comp.brand}</div>
                  </td>
                  <td className="ppt-td ppt-price-comp">{comp.kerosene > 0 ? comp.kerosene.toLocaleString() : <span style={{color:"#d1d5db"}}>—</span>}</td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={comp.kerosene > 0 && sail.kerosene > 0 ? (kd !== 0 ? kd : null) : null} mode="vs_sail" /></td>
                  <td className="ppt-td ppt-diff-cell"><span style={{ color: "#d1d5db" }}>—</span></td>
                </tr>
              );
            });
            if (group.regionAvg > 0) {
              rows.push(
                <tr key={`r-${gi}`} style={{ background: "#f8fafc" }}>
                  <td className="ppt-td" style={{ borderTop: "1px dashed #e5e7eb", paddingTop: 8, paddingBottom: 8 }}>
                    <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, letterSpacing: "0.02em" }}>
                      📍 {group.region} 등유 평균
                    </div>
                    <div style={{ fontSize: 9, color: "#c4c9d0", marginTop: 1 }}>경기도 기준</div>
                  </td>
                  <td className="ppt-td ppt-price-comp" style={{ borderTop: "1px dashed #e5e7eb", fontSize: 13, color: "#6b7280", fontWeight: 600 }}>
                    {group.regionAvg.toLocaleString()}
                  </td>
                  <td className="ppt-td ppt-diff-cell" style={{ borderTop: "1px dashed #e5e7eb" }}>
                    <TablePriceDiff diff={sail.kerosene > 0 ? sail.kerosene - group.regionAvg : null} mode="vs_sail" />
                  </td>
                  <td className="ppt-td ppt-diff-cell" style={{ borderTop: "1px dashed #e5e7eb" }}>
                    <span style={{ color: "#d1d5db" }}>—</span>
                  </td>
                </tr>
              );
            }
            return rows;
          })}
        </tbody>
      </table>
    </div>
    <div className="ppt-legend">
      <span className="ppt-legend-item"><span style={{ color: "#16a34a", fontWeight: 700 }}>▲</span> 경쟁사 높음 (당사 유리)</span>
      <span className="ppt-legend-item"><span style={{ color: "#ef4444", fontWeight: 700 }}>▼</span> 경쟁사 낮음 (당사 불리)</span>
    </div>
  </div>
);

/* ─── StatCard ─── */
const StatCard = ({ label, value, sub, accent }) => (
  <div className="stat-card">
    <div className="stat-card-label">{label}</div>
    <div className="stat-card-value" style={{ color: accent || "#111827" }}>
      {typeof value === "number" ? value.toLocaleString() : value}
    </div>
    {sub && <div className="stat-card-sub">{sub}</div>}
  </div>
);

/* ─── GroupCard ─── */
const GroupCard = ({ group, fuelType }) => {
  const sailPrice = group.sail[fuelType];
  const compAvg = group.competitors.reduce((s, c) => s + c[fuelType], 0) / group.competitors.length;
  const diff = Math.round(sailPrice - compAvg);
  return (
    <div style={{
      background: "#ffffff",
      border: "1px solid #e5e7eb",
      borderRadius: 14,
      overflow: "hidden",
      transition: "box-shadow 0.2s",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)"}
      onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)"}
    >
      <div style={{
        padding: "14px 16px",
        background: diff > 0
          ? "linear-gradient(135deg, rgba(239,68,68,0.07), rgba(239,68,68,0.02))"
          : diff < 0
            ? "linear-gradient(135deg, rgba(22,163,74,0.07), rgba(22,163,74,0.02))"
            : "linear-gradient(135deg, rgba(0,0,0,0.02), rgba(0,0,0,0.01))",
        borderBottom: "1px solid #f3f4f6",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{group.name}</div>
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
            {STATION_GROUPS.find(g => g.name === group.name)?.region}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>경쟁 평균 대비</div>
          <DiffBadge value={diff} inverted />
        </div>
      </div>

      <div style={{
        padding: "12px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(37,99,235,0.04)",
        borderBottom: "1px solid #f3f4f6",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#2563eb", boxShadow: "0 0 5px rgba(37,99,235,0.5)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1e40af" }}>{group.sail.name || "세일"}</span>
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(37,99,235,0.12)", color: "#2563eb", fontWeight: 700 }}>당사</span>
        </div>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#111827", fontFamily: "'JetBrains Mono', monospace" }}>
          {sailPrice.toLocaleString()}
        </span>
      </div>

      {group.competitors.map((comp, i) => {
        const priceDiff = comp[fuelType] - sailPrice;
        return (
          <div key={i} style={{
            padding: "10px 16px",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            borderBottom: i < group.competitors.length - 1 ? "1px solid #f9fafb" : "none",
            background: "#ffffff",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#d1d5db" }} />
              <span style={{ fontSize: 13, color: "#6b7280" }}>{comp.name}</span>
              <span style={{ fontSize: 10, color: "#b0b8c1" }}>({getCompBrand(group.name, comp.name)})</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <DiffBadge value={priceDiff} />
              <span style={{ fontSize: 15, fontWeight: 600, color: "#374151", fontFamily: "'JetBrains Mono', monospace", minWidth: 52, textAlign: "right" }}>
                {comp[fuelType].toLocaleString()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ─── PositionBar ─── */
const PositionBar = ({ group, fuelType, nationalAvg }) => {
  const sailPrice = group.sail[fuelType];
  const allPrices = [sailPrice, ...group.competitors.map(c => c[fuelType]), nationalAvg];
  const min = Math.min(...allPrices) - 20;
  const max = Math.max(...allPrices) + 20;
  const range = max - min;
  const sailPos = ((sailPrice - min) / range) * 100;
  const avgPos = ((nationalAvg - min) / range) * 100;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{group.name}</span>
        <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'JetBrains Mono', monospace" }}>
          {sailPrice.toLocaleString()}원
        </span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: "#e5e7eb", overflow: "visible" }}>
        <div style={{ position: "absolute", left: `${avgPos}%`, top: -3, width: 2, height: 14, background: "#f59e0b", borderRadius: 1, zIndex: 2 }} />
        <div style={{
          position: "absolute", left: `${sailPos}%`, top: -4, width: 16, height: 16, borderRadius: "50%",
          background: sailPrice <= nationalAvg ? "#16a34a" : "#ef4444",
          border: "2px solid #ffffff",
          transform: "translateX(-50%)", zIndex: 3,
          boxShadow: `0 0 8px ${sailPrice <= nationalAvg ? "rgba(22,163,74,0.4)" : "rgba(239,68,68,0.4)"}`,
        }} />
        {group.competitors.map((c, i) => {
          const pos = ((c[fuelType] - min) / range) * 100;
          return <div key={i} style={{ position: "absolute", left: `${pos}%`, top: 0, width: 8, height: 8, borderRadius: "50%", background: "#9ca3af", transform: "translateX(-50%)", zIndex: 1 }} />;
        })}
      </div>
    </div>
  );
};

/* ─── SAIL Logo ─── */
const SailLogo = () => (
  <div className="sail-logo-wrap">
    <div className="sail-logo-badge">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2Z" fill="white" opacity="0.95" />
        <path d="M12 6C12 6 8 12 8 15a4 4 0 0 0 8 0C16 12 12 6 12 6Z" fill="rgba(28,110,245,0.6)" />
      </svg>
    </div>
    <div className="dash-title-block">
      <h1>주식회사 세일 게시가 모니터링</h1>
      <div className="dash-sub">세일 주유소 가격 경쟁력 대시보드</div>
    </div>
  </div>
);

/* ─── Password Gate ─── */
const PW_HASH = "b8aad43aa70f296fa14de9dd9992b1064bf456c13212f459d55b3bfea13281e2";

async function hashPw(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function PasswordGate({ children }) {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem("sail_auth") === "1");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  if (authed) return children;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const hash = await hashPw(input);
    if (hash === PW_HASH) {
      sessionStorage.setItem("sail_auth", "1");
      setAuthed(true);
    } else {
      setError(true);
      setInput("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  };

  return (
    <div className="pg-overlay">
      <form className={`pg-card${shake ? " pg-shake" : ""}`} onSubmit={handleSubmit}>
        <div className="pg-logo">S</div>
        <h2 className="pg-title">SAIL Dashboard</h2>
        <p className="pg-sub">비밀번호를 입력하세요</p>
        <input
          className={`pg-input${error ? " pg-input-err" : ""}`}
          type="password"
          value={input}
          onChange={e => { setInput(e.target.value); setError(false); }}
          placeholder="Password"
          autoFocus
        />
        {error && <p className="pg-error">비밀번호가 올바르지 않습니다</p>}
        <button className="pg-btn" type="submit">확인</button>
      </form>
    </div>
  );
}

/* ─── Main Dashboard ─── */
export default function SailDashboard() {
  const [data, setData] = useState(makeEmptyData);  // 초기에는 빈 상태 (가격 0)
  const [fuelType, setFuelType] = useState("gasoline");
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState("loading");  // 첫 로드는 loading 상태
  const [activeView, setActiveView] = useState("overview");
  const [prevDateLabel, setPrevDateLabel] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [keroGroups, setKeroGroups] = useState(() =>
    KEROSENE_GROUPS.map(g => ({
      name: g.name,
      region: g.region,
      sail: { name: g.sail.name, brand: g.sail.brand, kerosene: 0 },
      competitors: g.competitors.map(c => ({ name: c.name, brand: c.brand, kerosene: 0 })),
      regionAvg: 0,
    }))
  );
  const [intlData, setIntlData] = useState(null);
  const [intlLoading, setIntlLoading] = useState(false);
  const [showConstantsModal, setShowConstantsModal] = useState(false);
  const [mopsKey, setMopsKey] = useState(0); // 상수 저장 시 MopsSection 재계산 트리거
  const [showPwPrompt, setShowPwPrompt] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  const handleOpenSettings = () => {
    setPwInput("");
    setPwError(false);
    setShowPwPrompt(true);
  };
  const handlePwSubmit = () => {
    if (pwInput === "rlawldms11") {
      setShowPwPrompt(false);
      setShowConstantsModal(true);
    } else {
      setPwError(true);
    }
  };

  // 앱 최초 로드 시:
  // 1) 기존 오염된(가짜) localStorage 데이터 정리
  // 2) Supabase에서 전일 스냅샷 + 당월 국제지표 동기화 (크로스 디바이스 전일비)
  // 3) 실시간 API 자동 호출 (전일 실데이터 없으면 전일대비 "—" 표시)
  useEffect(() => {
    cleanCorruptedHistory();
    // Supabase 동기화 완료 후 라이브 데이터 fetch (전일비 정확성 보장)
    loadFromSupabase().finally(() => fetchLiveData());
    fetchIntlData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchIntlData = async () => {
    const INTL_KEY = "sail_intl_prices";

    // KST 기준 오늘 날짜 문자열 + 현재 시각(분 단위)
    const nowKST   = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = nowKST.toISOString().split("T")[0];
    const hhmm     = nowKST.getUTCHours() * 60 + nowKST.getUTCMinutes(); // KST 시분(분 환산)
    const after8am = hhmm >= 8 * 60; // KST 08:00 이후 여부

    // 캐시 확인: 오늘 08:00 이후에 저장된 데이터이고 history가 포함된 경우만 재사용
    // (history 없는 구버전 캐시, 2시간 이상 된 캐시는 무시하고 재fetch)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    try {
      const cached = JSON.parse(localStorage.getItem(INTL_KEY) || "null");
      if (
        cached &&
        cached.date === todayStr &&
        cached.fetchedAfter8 &&
        cached.data?.petro?.wti?.history &&
        cached.fetchedAt > twoHoursAgo
      ) {
        setIntlData(cached.data);
        mergeIntlHistory(cached.data.petro, cached.data.exch);
        return;
      }
    } catch (_) {}

    // 08:00 이전이면 외부 요청 하지 않고 전날 캐시 표시
    if (!after8am) {
      try {
        const cached = JSON.parse(localStorage.getItem(INTL_KEY) || "null");
        if (cached?.data) setIntlData(cached.data);
      } catch (_) {}
      return;
    }

    // 08:00 이후 + 유효 캐시 없음 → 실제 fetch
    setIntlLoading(true);
    try {
      const [petroRes, exchRes] = await Promise.all([
        fetch("/api/petronet"),
        fetch("/api/exchange"),
      ]);
      if (!petroRes.ok || !exchRes.ok) throw new Error("API error");
      const petro = await petroRes.json();
      const exch  = await exchRes.json();
      const data  = { petro, exch };
      setIntlData(data);
      localStorage.setItem(INTL_KEY, JSON.stringify({ date: todayStr, fetchedAfter8: true, fetchedAt: Date.now(), data }));
      mergeIntlHistory(petro, exch);
    } catch (e) {
      console.warn("International data fetch failed:", e);
      // fetch 실패 시 이전 캐시라도 표시
      try {
        const cached = JSON.parse(localStorage.getItem(INTL_KEY) || "null");
        if (cached?.data) setIntlData(cached.data);
      } catch (_) {}
    }
    setIntlLoading(false);
  };

  const fuelLabel = fuelType === "gasoline" ? "휘발유" : fuelType === "diesel" ? "경유" : "등유";

  const fetchLiveData = async () => {
    setLoading(true);
    setApiStatus("loading");
    try {
      const stationIds = [
        ...ALL_GROUPS.flatMap(g => [g.sail.id, ...g.competitors.map(c => c.id)]),
        ...KEROSENE_GROUPS.flatMap(g => [g.sail.id, ...g.competitors.map(c => c.id)]),
      ];
      const uniqueIds = [...new Set(stationIds)];
      const results = {};
      for (const id of uniqueIds) {
        try {
          const res = await fetch(`${API_PROXY}?endpoint=detailById.do&id=${id}`);
          const json = await res.json();
          if (json.RESULT?.OIL) {
            const oil = Array.isArray(json.RESULT.OIL) ? json.RESULT.OIL[0] : json.RESULT.OIL;
            const prices = {};
            const oilPrices = oil.OIL_PRICE ? (Array.isArray(oil.OIL_PRICE) ? oil.OIL_PRICE : [oil.OIL_PRICE]) : [];
            oilPrices.forEach(p => {
              if (p.PRODCD === "B027") prices.gasoline = parseFloat(p.PRICE);
              if (p.PRODCD === "D047") prices.diesel = parseFloat(p.PRICE);
              if (p.PRODCD === "C004") prices.kerosene = parseFloat(p.PRICE);
            });
            results[id] = { name: oil.OS_NM, ...prices };
          }
        } catch (e) { console.warn(`Failed ${id}:`, e); }
      }
      let nationalAvg = { gasoline: 0, diesel: 0 };
      try {
        const avgRes = await fetch(`${API_PROXY}?endpoint=avgAllPrice.do`);
        const avgJson = await avgRes.json();
        if (avgJson.RESULT?.OIL) {
          avgJson.RESULT.OIL.forEach(o => {
            if (o.PRODCD === "B027") nationalAvg.gasoline = parseFloat(o.PRICE);
            if (o.PRODCD === "D047") nationalAvg.diesel = parseFloat(o.PRICE);
          });
        }
      } catch (e) { console.warn("Failed national avg:", e); }
      // 경쟁사 이름은 항상 STATION_GROUPS/CHAIN_GROUPS 기준 이름 사용 (localStorage 키 일관성 보장)
      const buildGroupRows = (groupDefs) => groupDefs.map(g => ({
        name: g.name,
        sail: { name: g.sail.name, gasoline: results[g.sail.id]?.gasoline || 0, diesel: results[g.sail.id]?.diesel || 0, prevGasoline: null, prevDiesel: null },
        competitors: g.competitors.map(c => ({ name: c.name, gasoline: results[c.id]?.gasoline || 0, diesel: results[c.id]?.diesel || 0, prevGasoline: null, prevDiesel: null })),
      }));
      const groups = buildGroupRows(STATION_GROUPS);
      const chainGroups = buildGroupRows(CHAIN_GROUPS);
      const today = getKSTDateStr();
      const validGroups = groups.some(g => g.sail.gasoline > 0) ? groups : null;
      const validChainGroups = chainGroups.some(g => g.sail.gasoline > 0) ? chainGroups : null;

      if (validGroups || validChainGroups) {
        // 오늘 실시간 가격 저장 (다음날 전일대비용) — 직영 + 계열 통합 저장
        const allToSave = [...(validGroups || groups), ...(validChainGroups || chainGroups)];
        savePricesToLocal(today, allToSave);

        // 전일 데이터 불러와 전일대비 계산
        const prevData = loadPrevDayData();
        if (prevData) setPrevDateLabel(prevData.date);
        const groupsWithDiff = applyPrevDiffs(validGroups || groups, prevData);
        const chainGroupsWithDiff = applyPrevDiffs(validChainGroups || chainGroups, prevData);

        setData(prev => ({ ...prev, date: today, nationalAvg, groups: groupsWithDiff, chainGroups: chainGroupsWithDiff }));
        setLastFetchTime(getKSTDateTimeStr());
        setApiStatus("live");

        // 경기도 등유 지역 평균 조회 (sido=02)
        let gyeonggiKeroAvg = 0;
        try {
          const keroAvgRes = await fetch(`${API_PROXY}?endpoint=avgSidoPrice.do&sido=02`);
          const keroAvgJson = await keroAvgRes.json();
          if (keroAvgJson.RESULT?.OIL) {
            const oils = Array.isArray(keroAvgJson.RESULT.OIL) ? keroAvgJson.RESULT.OIL : [keroAvgJson.RESULT.OIL];
            oils.forEach(o => { if (o.PRODCD === "C004") gyeonggiKeroAvg = Math.round(parseFloat(o.PRICE)); });
          }
        } catch (e) { console.warn("Failed gyeonggi kero avg:", e); }

        setKeroGroups(KEROSENE_GROUPS.map(g => ({
          name: g.name,
          region: g.region,
          sail: { name: g.sail.name, brand: g.sail.brand, kerosene: Math.round(results[g.sail.id]?.kerosene || 0) },
          competitors: g.competitors.map(c => ({ name: c.name, brand: c.brand, kerosene: Math.round(results[c.id]?.kerosene || 0) })),
          regionAvg: gyeonggiKeroAvg,
        })));
      } else {
        // API 호출은 성공했지만 가격 데이터가 없는 경우
        setData(prev => ({ ...prev, date: today, nationalAvg }));
        setApiStatus("error");
      }
    } catch (e) {
      console.error("API fetch failed:", e);
      setApiStatus("error");
    }
    setLoading(false);
  };

  const summary = useMemo(() => {
    const groups = data.groups;
    let totalSail = 0, totalComp = 0, compCount = 0;
    let highestDiff = -Infinity, highestDiffGroup = "";
    let lowestDiff = Infinity, lowestDiffGroup = "";
    let belowAvgCount = 0;
    groups.forEach(g => {
      const sp = g.sail[fuelType]; totalSail += sp;
      g.competitors.forEach(c => { totalComp += c[fuelType]; compCount++; });
      const compAvg = g.competitors.reduce((s, c) => s + c[fuelType], 0) / g.competitors.length;
      const diff = sp - compAvg;
      if (diff > highestDiff) { highestDiff = diff; highestDiffGroup = g.name; }
      if (diff < lowestDiff) { lowestDiff = diff; lowestDiffGroup = g.name; }
      if (sp < data.nationalAvg[fuelType]) belowAvgCount++;
    });
    return {
      sailAvg: Math.round(totalSail / groups.length),
      compAvg: Math.round(totalComp / compCount),
      overallDiff: Math.round(totalSail / groups.length - totalComp / compCount),
      belowAvgCount, totalGroups: groups.length,
    };
  }, [data, fuelType]);

  const compChartData = useMemo(() =>
    data.groups.map(g => {
      const compAvg = Math.round(g.competitors.reduce((s, c) => s + c[fuelType], 0) / g.competitors.length);
      return { name: g.name, 세일: g.sail[fuelType], 경쟁평균: compAvg, diff: g.sail[fuelType] - compAvg };
    }), [data, fuelType]);

  const statusColor = apiStatus === "live" ? "#16a34a" : apiStatus === "error" ? "#ef4444" : "#f59e0b";

  // 헤더 상태 텍스트: 실시간이면 갱신 날짜+시간, 샘플이면 데이터 날짜
  const statusText = apiStatus === "live" && lastFetchTime
    ? `실시간 현황 · ${lastFetchTime}`
    : apiStatus === "loading"
      ? "데이터 불러오는 중..."
      : apiStatus === "error"
        ? `오류 · ${data.date}`
        : `샘플 데이터 · ${data.date}`;

  const tooltipStyle = { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, color: "#111827", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" };

  return (
    <PasswordGate>
    <div style={{ minHeight: "100vh", background: "#f0f4f8", color: "#111827", fontFamily: "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;600;700;900&display=swap" rel="stylesheet" />

      {/* ── Header ── */}
      <header className="dash-header">
        <SailLogo />
        <div className="dash-header-right">
          <div className="toggle-group">
            {[{ key: "gasoline", label: "휘발유" }, { key: "diesel", label: "경유" }, { key: "kerosene", label: "등유" }, { key: "intl", label: "국제지표" }, { key: "sales", label: "판매 리포트" }].map(f => (
              <button key={f.key} onClick={() => setFuelType(f.key)} className="toggle-btn" style={{
                background: fuelType === f.key ? (f.key === "kerosene" ? "rgba(234,88,12,0.1)" : f.key === "intl" ? "rgba(124,58,237,0.1)" : f.key === "sales" ? "rgba(5,150,105,0.1)" : "rgba(37,99,235,0.1)") : "transparent",
                color: fuelType === f.key ? (f.key === "kerosene" ? "#ea580c" : f.key === "intl" ? "#7c3aed" : f.key === "sales" ? "#059669" : "#2563eb") : "#6b7280",
              }}>{f.label}</button>
            ))}
          </div>
          {fuelType !== "kerosene" && fuelType !== "intl" && fuelType !== "sales" && (
            <div className="toggle-group">
              {[{ key: "overview", label: "종합" }, { key: "detail", label: "상세" }, { key: "trend", label: "추세" }, { key: "chain", label: "계열" }].map(v => (
                <button key={v.key} onClick={() => setActiveView(v.key)} className="toggle-btn" style={{
                  background: activeView === v.key ? "rgba(0,0,0,0.08)" : "transparent",
                  color: activeView === v.key ? "#111827" : "#6b7280",
                }}>{v.label}</button>
              ))}
            </div>
          )}
          <div className="status-bar">
            <div className="status-dot" style={{ background: statusColor, boxShadow: `0 0 5px ${statusColor}88` }} />
            <span className="status-label">{statusText}</span>
            <button onClick={fetchLiveData} disabled={loading} className="refresh-btn">
              {loading ? "⟳ 로딩..." : "⟳ 갱신"}
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="dash-main">

        {/* ── 국제 원유 · 환율 · MOPS ── */}
        <div className="intl-section" style={fuelType === "sales" ? { display: "none" } : {}}>
          <div className="intl-crude-row">
            {[
              { label: "WTI",       data: intlData?.petro?.wti,   unit: "$/bbl" },
              { label: "두바이유",   data: intlData?.petro?.dubai, unit: "$/bbl" },
              { label: "원/달러",    data: intlData?.exch,         unit: "원" },
            ].map(({ label, data, unit }) => {
              const cur  = data?.current ?? null;
              const chg  = data?.change  ?? null;
              const up   = chg !== null && chg > 0;
              const dn   = chg !== null && chg < 0;
              const disp = cur === null ? "—" : cur.toFixed(1);
              const hist = data?.history;
              const lastDate = hist ? Object.keys(hist).sort().pop() : null;
              const dateLabel = lastDate
                ? `(${parseInt(lastDate.slice(5, 7), 10)}/${parseInt(lastDate.slice(8, 10), 10)})`
                : null;
              return (
                <div key={label} className="intl-crude-card">
                  <span className="intl-card-label">
                    {label}
                    {dateLabel && <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400, marginLeft: 6 }}>{dateLabel}</span>}
                  </span>
                  <span className="intl-card-value">{disp}</span>
                  <span className="intl-card-unit">{unit}</span>
                  {chg !== null && (
                    <span className="intl-card-change" style={{ color: up ? "#ef4444" : dn ? "#2563eb" : "#6b7280" }}>
                      {up ? "▲" : dn ? "▼" : "—"}{Math.abs(chg).toFixed(1)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="intl-mops-box">
            <div className="intl-mops-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              싱가포르 MOPS 국제제품가
              {(() => {
                const hist = intlData?.petro?.mopsGasoline?.history;
                if (!hist) return null;
                const lastDate = Object.keys(hist).sort().pop();
                if (!lastDate) return null;
                const m = parseInt(lastDate.slice(5, 7), 10);
                const d = parseInt(lastDate.slice(8, 10), 10);
                return <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 400 }}>({m}/{d})</span>;
              })()}
            </div>
            <table className="intl-mops-table">
              <tbody>
                {[
                  { label: "무연(92RON)", data: intlData?.petro?.mopsGasoline },
                  { label: "경유(0.001%)", data: intlData?.petro?.mopsDiesel },
                  { label: "등유",         data: intlData?.petro?.mopsKerosene },
                ].map(({ label, data }) => {
                  const cur = data?.current ?? null;
                  const chg = data?.change  ?? null;
                  const up  = chg !== null && chg > 0;
                  const dn  = chg !== null && chg < 0;
                  return (
                    <tr key={label} className="intl-mops-row">
                      <td className="intl-mops-name">{label}</td>
                      <td className="intl-mops-val">{cur !== null ? cur.toFixed(2) : "—"}</td>
                      <td className="intl-mops-chg" style={{ color: up ? "#ef4444" : dn ? "#2563eb" : "#6b7280" }}>
                        {chg !== null ? `${up ? "▲" : dn ? "▼" : "—"} ${Math.abs(chg).toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 국제지표 탭 ── */}
        {fuelType === "intl" && (() => {
          const nowKST  = new Date(Date.now() + 9 * 60 * 60 * 1000);
          const year    = nowKST.getUTCFullYear();
          const month   = nowKST.getUTCMonth();
          const prevM   = month === 0 ? 12 : month;
          const prevY   = month === 0 ? year - 1 : year;
          const prevLabel = `${prevY}년 ${prevM}월`;
          const curLabel  = `${year}년 ${month + 1}월`;

          const rows = [
            { label: "WTI",          unit: "$/bbl", field: "wti",         today: intlData?.petro?.wti?.current },
            { label: "두바이유",      unit: "$/bbl", field: "dubai",       today: intlData?.petro?.dubai?.current },
            { label: "원/달러",       unit: "원",    field: "exch",        today: intlData?.exch?.current },
            { label: "무연(92RON)",   unit: "$/bbl", field: "mopsGas",     today: intlData?.petro?.mopsGasoline?.current },
            { label: "경유(0.001%)", unit: "$/bbl", field: "mopsDiesel",  today: intlData?.petro?.mopsDiesel?.current },
            { label: "등유",          unit: "$/bbl", field: "mopsKero",    today: intlData?.petro?.mopsKerosene?.current },
          ];

          const fmt = (v, unit) => {
            if (v == null) return "—";
            if (unit === "원") return v.toFixed(1);
            return v.toFixed(2);
          };

          return (
            <div className="intl-monthly-wrap">
              <div className="intl-monthly-header">
                국제 지표 월간 분석
                <span className="intl-monthly-note">· 당월 예상은 오늘 값이 남은 평일 유지 가정</span>
              </div>
              <table className="intl-monthly-table">
                <thead>
                  <tr>
                    <th className="imt-th imt-name"></th>
                    <th className="imt-th">전월 평균<br/><span className="imt-sub">{prevLabel}</span></th>
                    <th className="imt-th imt-accent">당월 평균(예상)<br/><span className="imt-sub">{curLabel}</span></th>
                    <th className="imt-th">금일<br/><span className="imt-sub">오늘</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ label, unit, field, today }) => {
                    const stats   = calcMonthStats(field);
                    const prevAvg = getPrevMonthAvg(field);
                    return (
                      <tr key={field} className="imt-row">
                        <td className="imt-td imt-name">{label}<span className="imt-unit"> {unit}</span></td>
                        <td className="imt-td imt-val">{fmt(prevAvg, unit)}</td>
                        <td className="imt-td imt-val imt-projected">{fmt(stats?.projected, unit)}</td>
                        <td className="imt-td imt-val imt-today">{fmt(today, unit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* ── 국내 환산 MOPS — 국제지표 탭에서만 표시 ── */}
        {fuelType === "intl" && (
          <MopsSection
            key={mopsKey}
            intlData={intlData}
            onOpenSettings={handleOpenSettings}
          />
        )}

        {/* Summary Cards — 등유·국제지표 탭에서는 숨김 */}
        {fuelType !== "kerosene" && fuelType !== "intl" && fuelType !== "sales" && (
          <div className="summary-grid">
            <StatCard label={`세일 평균 ${fuelLabel}`} value={apiStatus === "loading" ? "—" : summary.sailAvg} sub="원/리터" accent="#2563eb" />
            <StatCard label={`경쟁사 평균 ${fuelLabel}`} value={apiStatus === "loading" ? "—" : summary.compAvg} sub="원/리터" accent="#374151" />
            <StatCard
              label="평균 가격차"
              value={apiStatus === "loading" ? "—" : `${summary.overallDiff > 0 ? "+" : ""}${summary.overallDiff}`}
              sub={apiStatus === "loading" ? "" : (summary.overallDiff > 0 ? "경쟁사보다 높음" : "경쟁사보다 낮음")}
              accent={summary.overallDiff > 0 ? "#ef4444" : "#16a34a"}
            />
            <StatCard
              label="전국 평균 이하"
              value={apiStatus === "loading" ? "—" : `${summary.belowAvgCount}/${summary.totalGroups}`}
              sub={apiStatus === "loading" ? "" : `전국 평균 ${data.nationalAvg[fuelType].toLocaleString()}원`}
              accent="#f59e0b"
            />
          </div>
        )}

        {/* ── KEROSENE (등유) ── */}
        {fuelType === "kerosene" && (
          <>
            {/* 2x2 카드: 각 지점 게시가 + 지역 평균가 */}
            <div className="summary-grid">
              {keroGroups.map((g, i) => {
                const diff = g.sail.kerosene > 0 && g.regionAvg > 0 ? g.sail.kerosene - g.regionAvg : null;
                const regionLabel = i === 0 ? "안양 지역 등유 평균" : "고양시 등유 평균";
                return [
                  /* 게시가 카드 */
                  <StatCard
                    key={`price-${i}`}
                    label={`${g.sail.name} 게시가`}
                    value={g.sail.kerosene > 0 ? g.sail.kerosene : "—"}
                    sub={diff !== null ? `지역평균 대비 ${diff <= 0 ? "▼" : "▲"}${Math.abs(diff)}원` : "원/리터"}
                    accent="#ea580c"
                  />,
                  /* 지역 평균가 카드 */
                  <StatCard
                    key={`avg-${i}`}
                    label={regionLabel}
                    value={g.regionAvg > 0 ? g.regionAvg : "—"}
                    sub="경기도 기준 · 오피넷"
                    accent="#374151"
                  />,
                ];
              })}
            </div>
            <KerosenePriceTable groups={keroGroups} date={data.date} prevDate={prevDateLabel} />
          </>
        )}

        {/* ── OVERVIEW ── */}
        {fuelType !== "kerosene" && fuelType !== "intl" && fuelType !== "sales" && activeView === "overview" && (
          <>
            <PostedPriceTable data={data} prevDate={prevDateLabel} />

            {/* 지점별 가격 비교 차트 */}
            <div className="dash-panel">
              <div className="panel-header">
                <h2 className="panel-title">지점별 가격 비교 · {fuelLabel}</h2>
                <div className="legend-group">
                  <span className="legend-item"><span style={{ width: 10, height: 10, borderRadius: 2, background: "#2563eb", display: "inline-block", opacity: 0.7 }} /> 세일</span>
                  <span className="legend-item"><span style={{ width: 10, height: 10, borderRadius: 2, background: "#9ca3af", display: "inline-block" }} /> 경쟁 평균</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={compChartData} barGap={4} margin={{ top: 5, right: 10, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="name" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={["dataMin - 40", "dataMax + 20"]} tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v.toLocaleString()}원`]} />
                  <ReferenceLine y={data.nationalAvg[fuelType]} stroke="#f59e0b" strokeDasharray="5 5" strokeWidth={1.5} label={{ value: `전국 ${data.nationalAvg[fuelType].toLocaleString()}`, position: "right", fill: "#f59e0b", fontSize: 10 }} />
                  <Bar dataKey="세일" radius={[4, 4, 0, 0]} maxBarSize={34}>
                    {compChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.diff > 0 ? "rgba(239,68,68,0.7)" : "rgba(37,99,235,0.7)"} />
                    ))}
                  </Bar>
                  <Bar dataKey="경쟁평균" fill="#9ca3af" radius={[4, 4, 0, 0]} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 포지션 맵 */}
            <div className="dash-panel">
              <div className="panel-header">
                <h2 className="panel-title">전국 평균 대비 포지션 · {fuelLabel}</h2>
                <div className="legend-group">
                  <span className="legend-item"><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} /> 평균 이하</span>
                  <span className="legend-item"><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} /> 평균 이상</span>
                  <span className="legend-item"><span style={{ width: 2, height: 10, background: "#f59e0b", display: "inline-block" }} /> 전국 평균</span>
                  <span className="legend-item"><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#9ca3af", display: "inline-block" }} /> 경쟁사</span>
                </div>
              </div>
              {data.groups.map((g, i) => (
                <PositionBar key={i} group={g} fuelType={fuelType} nationalAvg={data.nationalAvg[fuelType]} />
              ))}
            </div>

            {/* 알림 */}
            <div className="dash-panel">
              <h2 className="panel-title" style={{ marginBottom: 14 }}>주요 알림</h2>
              {data.groups.map((g, i) => {
                const compMin = Math.min(...g.competitors.map(c => c[fuelType]));
                const diff = g.sail[fuelType] - compMin;
                if (diff > 20) return (
                  <div key={i} className="alert-item" style={{ background: "rgba(239,68,68,0.06)", borderLeft: "3px solid #ef4444", color: "#7f1d1d" }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>⚠</span>
                    <span><strong style={{ color: "#ef4444" }}>{g.name}</strong> — 최저가 경쟁사 대비 <strong style={{ color: "#ef4444" }}>+{diff}원</strong> 높음</span>
                  </div>
                );
                if (diff < -10) return (
                  <div key={i} className="alert-item" style={{ background: "rgba(22,163,74,0.06)", borderLeft: "3px solid #16a34a", color: "#14532d" }}>
                    <span style={{ fontSize: 15, flexShrink: 0 }}>✓</span>
                    <span><strong style={{ color: "#16a34a" }}>{g.name}</strong> — 최저가 경쟁사 대비 <strong style={{ color: "#16a34a" }}>{diff}원</strong> 낮음 (경쟁력 우위)</span>
                  </div>
                );
                return null;
              })}
            </div>
          </>
        )}

        {/* ── DETAIL ── */}
        {fuelType !== "kerosene" && fuelType !== "intl" && fuelType !== "sales" && activeView === "detail" && (
          <div className="detail-grid">
            {data.groups.map((g, i) => <GroupCard key={i} group={g} fuelType={fuelType} />)}
          </div>
        )}

        {/* ── TREND ── */}
        {fuelType !== "kerosene" && fuelType !== "intl" && fuelType !== "sales" && activeView === "trend" && (
          <div className="dash-panel">
            <h2 className="panel-title" style={{ marginBottom: 20 }}>최근 7일 가격 추세 · {fuelLabel}</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.trend} margin={{ top: 5, right: 20, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis domain={["dataMin - 10", "dataMax + 10"]} tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v.toLocaleString()}원`]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "#6b7280" }} />
                <Line type="monotone" dataKey="sail" name="세일 평균" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="competitor" name="경쟁사 평균" stroke="#9ca3af" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="national" name="전국 평균" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="2 2" />
              </LineChart>
            </ResponsiveContainer>
            <div className="trend-summary">
              <div>
                <span style={{ color: "#9ca3af" }}>세일 평균 추이: </span>
                <span style={{ color: "#2563eb", fontWeight: 600 }}>{data.trend[0]?.sail} → {data.trend[data.trend.length - 1]?.sail}</span>
                <span style={{ marginLeft: 4, color: "#6b7280" }}>({data.trend[data.trend.length - 1]?.sail - data.trend[0]?.sail > 0 ? "+" : ""}{data.trend[data.trend.length - 1]?.sail - data.trend[0]?.sail}원)</span>
              </div>
              <div>
                <span style={{ color: "#9ca3af" }}>경쟁 평균 추이: </span>
                <span style={{ color: "#374151", fontWeight: 600 }}>{data.trend[0]?.competitor} → {data.trend[data.trend.length - 1]?.competitor}</span>
                <span style={{ marginLeft: 4, color: "#6b7280" }}>({data.trend[data.trend.length - 1]?.competitor - data.trend[0]?.competitor > 0 ? "+" : ""}{data.trend[data.trend.length - 1]?.competitor - data.trend[0]?.competitor}원)</span>
              </div>
            </div>
          </div>
        )}

        {/* ── 판매 리포트 ── */}
        {fuelType === "sales" && <SalesReport />}

        {/* ── CHAIN (계열) ── */}
        {fuelType !== "kerosene" && fuelType !== "intl" && fuelType !== "sales" && activeView === "chain" && (
          <PostedPriceTable
            data={data}
            groups={data.chainGroups}
            prevDate={prevDateLabel}
            title="계열 게시가 현황"
          />
        )}
      </main>

      {/* ── 비밀번호 확인 모달 ── */}
      {showPwPrompt && (
        <div className="pw-overlay" onClick={e => { if (e.target === e.currentTarget) setShowPwPrompt(false); }}>
          <div className="pw-modal">
            <div className="pw-title">관리자 인증</div>
            <div className="pw-desc">상수 설정은 관리자만 변경할 수 있습니다.</div>
            <input
              className="pw-input"
              type="password"
              placeholder="비밀번호 입력"
              value={pwInput}
              onChange={e => { setPwInput(e.target.value); setPwError(false); }}
              onKeyDown={e => e.key === "Enter" && handlePwSubmit()}
              autoFocus
            />
            {pwError && <div className="pw-error">비밀번호가 올바르지 않습니다.</div>}
            <div className="pw-actions">
              <button className="pw-cancel" onClick={() => setShowPwPrompt(false)}>취소</button>
              <button className="pw-confirm" onClick={handlePwSubmit}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* ── MOPS 상수 설정 모달 ── */}
      <ConstantsModal
        isOpen={showConstantsModal}
        onClose={() => setShowConstantsModal(false)}
        onSaved={() => setMopsKey(k => k + 1)}
      />

      <footer className="dash-footer">
        <span>주식회사 세일 게시가 모니터링 대시보드 · 오피넷 API 기반</span>
        <span>업데이트: 1시 · 2시 · 9시 · 12시 · 16시 · 19시</span>
      </footer>
    </div>
    </PasswordGate>
  );
}
