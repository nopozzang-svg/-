import { useState, useMemo, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine
} from "recharts";
import "./App.css";

// API 호출은 /api/opinet 서버리스 프록시를 통해 CORS 우회
const API_PROXY = "/api/opinet";

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

/** 오늘 날짜 기준으로 가격 데이터를 localStorage에 저장 */
const savePricesToLocal = (date, groups) => {
  try {
    const history = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const snapshot = {};
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

/** 전일 데이터를 가져옴 — 어제 날짜를 우선 탐색, 없으면 가장 최근 과거 날짜 */
const loadPrevDayData = () => {
  try {
    const today = getKSTDateStr();
    const yesterday = getKSTYesterdayStr();
    const history = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    // 어제 데이터가 있으면 우선 사용
    if (history[yesterday]) return { date: yesterday, snapshot: history[yesterday] };
    // 없으면 오늘 이전 가장 최근 날짜 fallback
    const prevDates = Object.keys(history).filter(d => d < today).sort().reverse();
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
];

/* 정유사 브랜드 조회 헬퍼 */
const getSailBrand  = (groupName) =>
  STATION_GROUPS.find(g => g.name === groupName)?.sail.brand ?? "";
const getCompBrand  = (groupName, compName) =>
  STATION_GROUPS.find(g => g.name === groupName)
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
const PostedPriceTable = ({ data, prevDate }) => (
  <div className="ppt-wrap">
    <div className="ppt-head">
      <span className="ppt-title">게시가 현황</span>
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
          {data.groups.flatMap((group, gi) => {
            const sail = group.sail;
            const pgDiff = sail.prevGasoline != null ? sail.gasoline - sail.prevGasoline : null;
            const pdDiff = sail.prevDiesel != null ? sail.diesel - sail.prevDiesel : null;
            const rows = [];
            rows.push(
              <tr key={`s-${gi}`} className="ppt-row-sail">
                <td className="ppt-td ppt-name-sail">
                  <span className="ppt-sail-dot" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{group.name}</span>
                  <span style={{ fontSize: 9, color: "#9ca3af", fontWeight: 400, flexShrink: 0 }}>({getSailBrand(group.name)})</span>
                </td>
                <td className="ppt-td ppt-price-sail">{sail.gasoline.toLocaleString()}</td>
                <td className="ppt-td ppt-diff-cell"><span style={{ color: "#d1d5db" }}>—</span></td>
                <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={pgDiff} mode="prev" /></td>
                <td className="ppt-td ppt-price-sail">{sail.diesel.toLocaleString()}</td>
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
                    {comp.name}<span style={{ fontSize: 9, color: "#b0b8c1" }}> ({getCompBrand(group.name, comp.name)})</span>
                  </td>
                  <td className="ppt-td ppt-price-comp">{comp.gasoline.toLocaleString()}</td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={gd !== 0 ? gd : null} mode="vs_sail" /></td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={cpgd} mode="prev" /></td>
                  <td className="ppt-td ppt-price-comp">{comp.diesel.toLocaleString()}</td>
                  <td className="ppt-td ppt-diff-cell"><TablePriceDiff diff={dd !== 0 ? dd : null} mode="vs_sail" /></td>
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

/* ─── Main Dashboard ─── */
export default function SailDashboard() {
  const [data, setData] = useState(SAMPLE_DATA);
  const [fuelType, setFuelType] = useState("gasoline");
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState("sample");
  const [activeView, setActiveView] = useState("overview");
  const [prevDateLabel, setPrevDateLabel] = useState(null);
  const [lastFetchTime, setLastFetchTime] = useState(null); // 실시간 갱신 시각 (KST)

  // 앱 최초 로드 시:
  // 1) 어제 날짜로 SAMPLE_DATA baseline 시드 → 전일대비 어제 기준으로 즉시 동작
  // 2) 오늘 날짜로 현재 샘플 가격 저장
  // 3) localStorage에서 전일 가격 불러와 전일대비 적용
  // 4) 실시간 API 자동 호출
  useEffect(() => {
    const today = getKSTDateStr();
    const yesterday = getKSTYesterdayStr();

    // 어제 날짜로 baseline 1회 시드 — 데이터 없을 때도 전일(어제) 기준으로 전일대비 표시
    try {
      const history = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (!history[yesterday]) {
        savePricesToLocal(yesterday, SAMPLE_DATA.groups);
      }
    } catch (_) {}

    // 전일 데이터 불러와 즉시 적용 (로딩 중에도 전일대비 표시)
    const prevData = loadPrevDayData();
    if (prevData) {
      setPrevDateLabel(prevData.date);
      setData(prev => ({
        ...prev,
        groups: applyPrevDiffs(prev.groups, prevData),
      }));
    }

    // 실시간 API 자동 호출
    fetchLiveData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fuelLabel = fuelType === "gasoline" ? "휘발유" : "경유";

  const fetchLiveData = async () => {
    setLoading(true);
    setApiStatus("loading");
    try {
      const stationIds = STATION_GROUPS.flatMap(g => [g.sail.id, ...g.competitors.map(c => c.id)]);
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
      // 경쟁사 이름은 항상 STATION_GROUPS 기준 이름 사용 (localStorage 키 일관성 보장)
      const groups = STATION_GROUPS.map(g => ({
        name: g.name,
        sail: { name: g.sail.name, gasoline: results[g.sail.id]?.gasoline || 0, diesel: results[g.sail.id]?.diesel || 0, prevGasoline: null, prevDiesel: null },
        competitors: g.competitors.map(c => ({ name: c.name, gasoline: results[c.id]?.gasoline || 0, diesel: results[c.id]?.diesel || 0, prevGasoline: null, prevDiesel: null })),
      }));
      const today = getKSTDateStr();
      const validGroups = groups.some(g => g.sail.gasoline > 0) ? groups : null;

      if (validGroups) {
        // 오늘 실시간 가격 저장 (다음날 전일대비용)
        savePricesToLocal(today, validGroups);

        // 전일 데이터 불러와 전일대비 계산
        const prevData = loadPrevDayData();
        if (prevData) setPrevDateLabel(prevData.date);
        const groupsWithDiff = applyPrevDiffs(validGroups, prevData);

        setData(prev => ({ ...prev, date: today, nationalAvg, groups: groupsWithDiff }));
        setLastFetchTime(getKSTDateTimeStr());
        setApiStatus("live");
      } else {
        // API 호출은 성공했지만 가격 데이터가 없는 경우 — 샘플 상태 유지
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
    : apiStatus === "error"
      ? `오류 · ${data.date}`
      : `샘플 데이터 · ${data.date}`;

  const tooltipStyle = { background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, color: "#111827", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" };

  return (
    <div style={{ minHeight: "100vh", background: "#f0f4f8", color: "#111827", fontFamily: "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;600;700;900&display=swap" rel="stylesheet" />

      {/* ── Header ── */}
      <header className="dash-header">
        <SailLogo />
        <div className="dash-header-right">
          <div className="toggle-group">
            {[{ key: "gasoline", label: "휘발유" }, { key: "diesel", label: "경유" }].map(f => (
              <button key={f.key} onClick={() => setFuelType(f.key)} className="toggle-btn" style={{
                background: fuelType === f.key ? "rgba(37,99,235,0.1)" : "transparent",
                color: fuelType === f.key ? "#2563eb" : "#6b7280",
              }}>{f.label}</button>
            ))}
          </div>
          <div className="toggle-group">
            {[{ key: "overview", label: "종합" }, { key: "detail", label: "상세" }, { key: "trend", label: "추세" }].map(v => (
              <button key={v.key} onClick={() => setActiveView(v.key)} className="toggle-btn" style={{
                background: activeView === v.key ? "rgba(0,0,0,0.08)" : "transparent",
                color: activeView === v.key ? "#111827" : "#6b7280",
              }}>{v.label}</button>
            ))}
          </div>
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

        {/* Summary Cards */}
        <div className="summary-grid">
          <StatCard label={`세일 평균 ${fuelLabel}`} value={summary.sailAvg} sub="원/리터" accent="#2563eb" />
          <StatCard label={`경쟁사 평균 ${fuelLabel}`} value={summary.compAvg} sub="원/리터" accent="#374151" />
          <StatCard
            label="평균 가격차"
            value={`${summary.overallDiff > 0 ? "+" : ""}${summary.overallDiff}`}
            sub={summary.overallDiff > 0 ? "경쟁사보다 높음" : "경쟁사보다 낮음"}
            accent={summary.overallDiff > 0 ? "#ef4444" : "#16a34a"}
          />
          <StatCard
            label="전국 평균 이하"
            value={`${summary.belowAvgCount}/${summary.totalGroups}`}
            sub={`전국 평균 ${data.nationalAvg[fuelType].toLocaleString()}원`}
            accent="#f59e0b"
          />
        </div>

        {/* ── OVERVIEW ── */}
        {activeView === "overview" && (
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
        {activeView === "detail" && (
          <div className="detail-grid">
            {data.groups.map((g, i) => <GroupCard key={i} group={g} fuelType={fuelType} />)}
          </div>
        )}

        {/* ── TREND ── */}
        {activeView === "trend" && (
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
      </main>

      <footer className="dash-footer">
        <span>주식회사 세일 게시가 모니터링 대시보드 · 오피넷 API 기반</span>
        <span>업데이트: 1시 · 2시 · 9시 · 12시 · 16시 · 19시</span>
      </footer>
    </div>
  );
}
