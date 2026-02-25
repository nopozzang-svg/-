import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend, Cell, ReferenceLine } from "recharts";

const API_KEY = "F250430333";
const API_BASE = "https://www.opinet.co.kr/api";

// Station configuration
const STATION_GROUPS = [
  {
    name: "광교신도시",
    region: "경기 수원",
    regionCode: "02",
    sail: { id: "A0032871", name: "광교신도시주유소" },
    competitors: [
      { id: "A0008889", name: "기흥서일" },
      { id: "A0008895", name: "언남에너지" },
    ],
  },
  {
    name: "안양",
    region: "경기 안양",
    regionCode: "02",
    sail: { id: "A0000180", name: "안양주유소" },
    competitors: [
      { id: "A0001856", name: "청기와" },
      { id: "A0001905", name: "안양알찬" },
    ],
  },
  {
    name: "박달",
    region: "경기 안양",
    regionCode: "02",
    sail: { id: "A0000263", name: "박달주유소" },
    competitors: [
      { id: "A0001980", name: "세광 푸른" },
      { id: "A0001938", name: "안양원예농협" },
      { id: "A0009185", name: "무지내" },
    ],
  },
  {
    name: "일품",
    region: "경기 고양",
    regionCode: "02",
    sail: { id: "A0005430", name: "일품주유소" },
    competitors: [
      { id: "A0005555", name: "원흥고양" },
      { id: "A0005565", name: "우주" },
      { id: "A0005163", name: "너명골" },
    ],
  },
  {
    name: "남부순환로",
    region: "울산 울주",
    regionCode: "14",
    sail: { id: "A0031528", name: "남부순환로주유소" },
    competitors: [
      { id: "A0028919", name: "울선" },
      { id: "A0028937", name: "올리셀프" },
      { id: "A0028856", name: "무지개대공원" },
    ],
  },
  {
    name: "온산",
    region: "울산 울주",
    regionCode: "14",
    sail: { id: "A0029052", name: "세일 온산주유소" },
    competitors: [
      { id: "A0029042", name: "당월" },
      { id: "A0029175", name: "온산공단" },
    ],
  },
  {
    name: "용인제1",
    region: "경기 용인",
    regionCode: "02",
    sail: { id: "A0008889", name: "기흥서일" },
    competitors: [
      { id: "A0008895", name: "청정에너지" },
    ],
  },
];

// Sample data based on 2026-02-25 screenshot
const SAMPLE_DATA = {
  date: "2026-02-25",
  nationalAvg: { gasoline: 1691.61, diesel: 1594.93 },
  groups: [
    {
      name: "광교신도시",
      sail: { gasoline: 1655, diesel: 1575 },
      competitors: [
        { name: "기흥서일", gasoline: 1665, diesel: 1595 },
        { name: "언남에너지", gasoline: 1625, diesel: 1545 },
      ],
    },
    {
      name: "안양",
      sail: { gasoline: 1679, diesel: 1579 },
      competitors: [
        { name: "청기와", gasoline: 1668, diesel: 1568 },
        { name: "안양알찬", gasoline: 1755, diesel: 1695 },
      ],
    },
    {
      name: "박달",
      sail: { gasoline: 1649, diesel: 1559 },
      competitors: [
        { name: "세광 푸른", gasoline: 1658, diesel: 1538 },
        { name: "안양원예농협", gasoline: 1658, diesel: 1538 },
        { name: "무지내", gasoline: 1625, diesel: 1534 },
      ],
    },
    {
      name: "일품",
      sail: { gasoline: 1642, diesel: 1539 },
      competitors: [
        { name: "원흥고양", gasoline: 1614, diesel: 1514 },
        { name: "우주", gasoline: 1624, diesel: 1524 },
        { name: "너명골", gasoline: 1614, diesel: 1514 },
      ],
    },
    {
      name: "남부순환로",
      sail: { gasoline: 1645, diesel: 1545 },
      competitors: [
        { name: "울선", gasoline: 1615, diesel: 1505 },
        { name: "올리셀프", gasoline: 1615, diesel: 1505 },
        { name: "무지개대공원", gasoline: 1615, diesel: 1535 },
      ],
    },
    {
      name: "온산",
      sail: { gasoline: 1678, diesel: 1578 },
      competitors: [
        { name: "당월", gasoline: 1695, diesel: 1535 },
        { name: "온산공단", gasoline: 1685, diesel: 1585 },
      ],
    },
    {
      name: "용인제1",
      sail: { gasoline: 1665, diesel: 1575 },
      competitors: [
        { name: "청정에너지", gasoline: 1625, diesel: 1545 },
      ],
    },
  ],
  trend: [
    { date: "02/19", sail: 1648, competitor: 1635, national: 1689 },
    { date: "02/20", sail: 1650, competitor: 1637, national: 1690 },
    { date: "02/21", sail: 1652, competitor: 1638, national: 1690 },
    { date: "02/22", sail: 1655, competitor: 1640, national: 1691 },
    { date: "02/23", sail: 1657, competitor: 1641, national: 1691 },
    { date: "02/24", sail: 1658, competitor: 1642, national: 1691 },
    { date: "02/25", sail: 1659, competitor: 1643, national: 1692 },
  ],
};

const DiffBadge = ({ value, inverted = false }) => {
  if (value === 0) return <span style={{ color: "#7a8599", fontSize: 12 }}>0</span>;
  const isPositive = value > 0;
  const color = inverted
    ? isPositive ? "#e85d5d" : "#3db88c"
    : isPositive ? "#3db88c" : "#e85d5d";
  return (
    <span style={{ color, fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
      {isPositive ? "▲" : "▼"}{Math.abs(value)}
    </span>
  );
};

const StatCard = ({ label, value, sub, accent }) => (
  <div style={{
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: "18px 20px",
    flex: 1,
    minWidth: 160,
  }}>
    <div style={{ fontSize: 11, color: "#7a8599", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 700, color: accent || "#f0f2f5", fontFamily: "'JetBrains Mono', monospace" }}>
      {typeof value === "number" ? value.toLocaleString() : value}
    </div>
    {sub && <div style={{ fontSize: 12, color: "#7a8599", marginTop: 4 }}>{sub}</div>}
  </div>
);

const GroupCard = ({ group, fuelType }) => {
  const sailPrice = group.sail[fuelType];
  const compAvg = group.competitors.reduce((s, c) => s + c[fuelType], 0) / group.competitors.length;
  const diff = Math.round(sailPrice - compAvg);
  const minComp = Math.min(...group.competitors.map(c => c[fuelType]));
  const maxComp = Math.max(...group.competitors.map(c => c[fuelType]));

  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 14,
      padding: 0,
      overflow: "hidden",
      transition: "border-color 0.2s",
    }}
    onMouseEnter={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"}
    onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"}
    >
      {/* Header */}
      <div style={{
        padding: "16px 20px",
        background: diff > 0
          ? "linear-gradient(135deg, rgba(232,93,93,0.08), rgba(232,93,93,0.02))"
          : diff < 0
            ? "linear-gradient(135deg, rgba(61,184,140,0.08), rgba(61,184,140,0.02))"
            : "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#f0f2f5" }}>{group.name}</div>
          <div style={{ fontSize: 11, color: "#7a8599", marginTop: 2 }}>{STATION_GROUPS.find(g => g.name === group.name)?.region}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#7a8599" }}>경쟁 평균 대비</div>
          <DiffBadge value={diff} inverted />
        </div>
      </div>

      {/* SAIL Station */}
      <div style={{
        padding: "12px 20px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "rgba(77, 148, 255, 0.06)",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#4d94ff",
            boxShadow: "0 0 6px rgba(77,148,255,0.5)",
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#c8d1e0" }}>
            {group.sail.name || "세일"}
          </span>
          <span style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 4,
            background: "rgba(77,148,255,0.15)", color: "#4d94ff",
            fontWeight: 600, letterSpacing: 0.5,
          }}>당사</span>
        </div>
        <span style={{
          fontSize: 18, fontWeight: 700, color: "#f0f2f5",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {sailPrice.toLocaleString()}
        </span>
      </div>

      {/* Competitors */}
      {group.competitors.map((comp, i) => {
        const priceDiff = comp[fuelType] - sailPrice;
        return (
          <div key={i} style={{
            padding: "10px 20px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: i < group.competitors.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "#555d6e",
              }} />
              <span style={{ fontSize: 13, color: "#9aa3b4" }}>{comp.name}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <DiffBadge value={priceDiff} />
              <span style={{
                fontSize: 15, fontWeight: 600, color: "#c8d1e0",
                fontFamily: "'JetBrains Mono', monospace",
                minWidth: 52, textAlign: "right",
              }}>
                {comp[fuelType].toLocaleString()}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

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
        <span style={{ fontSize: 12, fontWeight: 600, color: "#c8d1e0" }}>{group.name}</span>
        <span style={{ fontSize: 12, color: "#7a8599", fontFamily: "'JetBrains Mono', monospace" }}>
          {sailPrice.toLocaleString()}원
        </span>
      </div>
      <div style={{
        position: "relative", height: 8, borderRadius: 4,
        background: "rgba(255,255,255,0.06)",
        overflow: "visible",
      }}>
        {/* National avg marker */}
        <div style={{
          position: "absolute",
          left: `${avgPos}%`,
          top: -3, width: 2, height: 14,
          background: "#ff9f43",
          borderRadius: 1,
          zIndex: 2,
        }} />
        {/* Sail position */}
        <div style={{
          position: "absolute",
          left: `${sailPos}%`,
          top: -4, width: 16, height: 16,
          borderRadius: "50%",
          background: sailPrice <= nationalAvg ? "#3db88c" : "#e85d5d",
          border: "2px solid #1a1e2a",
          transform: "translateX(-50%)",
          zIndex: 3,
          boxShadow: `0 0 8px ${sailPrice <= nationalAvg ? "rgba(61,184,140,0.4)" : "rgba(232,93,93,0.4)"}`,
        }} />
        {/* Competitor dots */}
        {group.competitors.map((c, i) => {
          const pos = ((c[fuelType] - min) / range) * 100;
          return (
            <div key={i} style={{
              position: "absolute",
              left: `${pos}%`,
              top: 0, width: 8, height: 8,
              borderRadius: "50%",
              background: "#555d6e",
              transform: "translateX(-50%)",
              zIndex: 1,
            }} />
          );
        })}
      </div>
    </div>
  );
};

export default function SailDashboard() {
  const [data, setData] = useState(SAMPLE_DATA);
  const [fuelType, setFuelType] = useState("gasoline");
  const [loading, setLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState("sample");
  const [activeView, setActiveView] = useState("overview");

  const fuelLabel = fuelType === "gasoline" ? "휘발유" : "경유";

  // Attempt API fetch
  const fetchLiveData = async () => {
    setLoading(true);
    setApiStatus("loading");
    try {
      // Fetch all station details
      const stationIds = STATION_GROUPS.flatMap(g => [g.sail.id, ...g.competitors.map(c => c.id)]);
      const uniqueIds = [...new Set(stationIds)];

      const results = {};
      for (const id of uniqueIds) {
        try {
          const res = await fetch(`${API_BASE}/detailById.do?code=${API_KEY}&id=${id}&out=json`);
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
        } catch (e) {
          console.warn(`Failed to fetch ${id}:`, e);
        }
      }

      // Fetch national average
      let nationalAvg = { gasoline: 0, diesel: 0 };
      try {
        const avgRes = await fetch(`${API_BASE}/avgAllPrice.do?code=${API_KEY}&out=json`);
        const avgJson = await avgRes.json();
        if (avgJson.RESULT?.OIL) {
          avgJson.RESULT.OIL.forEach(o => {
            if (o.PRODCD === "B027") nationalAvg.gasoline = parseFloat(o.PRICE);
            if (o.PRODCD === "D047") nationalAvg.diesel = parseFloat(o.PRICE);
          });
        }
      } catch (e) { console.warn("Failed national avg:", e); }

      // Build groups data
      const groups = STATION_GROUPS.map(g => ({
        name: g.name,
        sail: {
          name: results[g.sail.id]?.name || g.sail.name,
          gasoline: results[g.sail.id]?.gasoline || 0,
          diesel: results[g.sail.id]?.diesel || 0,
        },
        competitors: g.competitors.map(c => ({
          name: results[c.id]?.name || c.name,
          gasoline: results[c.id]?.gasoline || 0,
          diesel: results[c.id]?.diesel || 0,
        })),
      }));

      setData(prev => ({
        ...prev,
        date: new Date().toISOString().split("T")[0],
        nationalAvg,
        groups: groups.some(g => g.sail.gasoline > 0) ? groups : prev.groups,
      }));
      setApiStatus("live");
    } catch (e) {
      console.error("API fetch failed:", e);
      setApiStatus("error");
    }
    setLoading(false);
  };

  // Summary calculations
  const summary = useMemo(() => {
    const groups = data.groups;
    let totalSail = 0, totalComp = 0, compCount = 0;
    let highestDiff = -Infinity, highestDiffGroup = "";
    let lowestDiff = Infinity, lowestDiffGroup = "";
    let belowAvgCount = 0;

    groups.forEach(g => {
      const sp = g.sail[fuelType];
      totalSail += sp;
      g.competitors.forEach(c => {
        totalComp += c[fuelType];
        compCount++;
      });
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
      highestDiff: Math.round(highestDiff),
      highestDiffGroup,
      lowestDiff: Math.round(lowestDiff),
      lowestDiffGroup,
      belowAvgCount,
      totalGroups: groups.length,
    };
  }, [data, fuelType]);

  // Comparison chart data
  const compChartData = useMemo(() =>
    data.groups.map(g => {
      const compAvg = Math.round(g.competitors.reduce((s, c) => s + c[fuelType], 0) / g.competitors.length);
      return {
        name: g.name,
        세일: g.sail[fuelType],
        경쟁평균: compAvg,
        diff: g.sail[fuelType] - compAvg,
      };
    }), [data, fuelType]);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0d1017",
      color: "#f0f2f5",
      fontFamily: "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+KR:wght@300;400;500;600;700;900&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{
        padding: "20px 28px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "rgba(255,255,255,0.01)",
        flexWrap: "wrap",
        gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #4d94ff, #2563eb)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 900, color: "#fff",
            boxShadow: "0 4px 12px rgba(77,148,255,0.3)",
          }}>S</div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>
              SAIL 유가 모니터링
            </h1>
            <div style={{ fontSize: 11, color: "#7a8599", marginTop: 2 }}>
              세일 주유소 가격 경쟁력 대시보드
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Fuel type toggle */}
          <div style={{
            display: "flex", background: "rgba(255,255,255,0.04)",
            borderRadius: 8, padding: 3, border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {[
              { key: "gasoline", label: "휘발유" },
              { key: "diesel", label: "경유" },
            ].map(f => (
              <button key={f.key} onClick={() => setFuelType(f.key)} style={{
                padding: "6px 14px", borderRadius: 6, border: "none",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: fuelType === f.key ? "rgba(77,148,255,0.2)" : "transparent",
                color: fuelType === f.key ? "#4d94ff" : "#7a8599",
                transition: "all 0.2s",
              }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div style={{
            display: "flex", background: "rgba(255,255,255,0.04)",
            borderRadius: 8, padding: 3, border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {[
              { key: "overview", label: "종합" },
              { key: "detail", label: "상세" },
              { key: "trend", label: "추세" },
            ].map(v => (
              <button key={v.key} onClick={() => setActiveView(v.key)} style={{
                padding: "6px 14px", borderRadius: 6, border: "none",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: activeView === v.key ? "rgba(255,255,255,0.08)" : "transparent",
                color: activeView === v.key ? "#f0f2f5" : "#7a8599",
                transition: "all 0.2s",
              }}>
                {v.label}
              </button>
            ))}
          </div>

          {/* Status & Refresh */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: apiStatus === "live" ? "#3db88c" : apiStatus === "error" ? "#e85d5d" : "#ff9f43",
              boxShadow: `0 0 6px ${apiStatus === "live" ? "rgba(61,184,140,0.5)" : apiStatus === "error" ? "rgba(232,93,93,0.5)" : "rgba(255,159,67,0.5)"}`,
            }} />
            <span style={{ fontSize: 11, color: "#7a8599" }}>
              {apiStatus === "live" ? "실시간" : apiStatus === "error" ? "오류" : "샘플"} · {data.date}
            </span>
            <button onClick={fetchLiveData} disabled={loading} style={{
              padding: "5px 10px", borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: "#9aa3b4", cursor: loading ? "wait" : "pointer",
              fontSize: 11, fontWeight: 500,
              transition: "all 0.2s",
            }}>
              {loading ? "⟳ 로딩..." : "⟳ 갱신"}
            </button>
          </div>
        </div>
      </header>

      <main style={{ padding: "20px 28px", maxWidth: 1280, margin: "0 auto" }}>
        {/* Summary Cards */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <StatCard
            label={`세일 평균 ${fuelLabel}`}
            value={summary.sailAvg}
            sub="원/리터"
            accent="#4d94ff"
          />
          <StatCard
            label={`경쟁사 평균 ${fuelLabel}`}
            value={summary.compAvg}
            sub="원/리터"
          />
          <StatCard
            label="평균 가격차"
            value={`${summary.overallDiff > 0 ? "+" : ""}${summary.overallDiff}`}
            sub={summary.overallDiff > 0 ? "경쟁사보다 높음" : "경쟁사보다 낮음"}
            accent={summary.overallDiff > 0 ? "#e85d5d" : "#3db88c"}
          />
          <StatCard
            label="전국 평균 이하"
            value={`${summary.belowAvgCount}/${summary.totalGroups}`}
            sub={`전국 평균 ${data.nationalAvg[fuelType].toLocaleString()}원`}
            accent="#ff9f43"
          />
        </div>

        {/* OVERVIEW VIEW */}
        {activeView === "overview" && (
          <>
            {/* Comparison Chart */}
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 14, padding: 20, marginBottom: 24,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>지점별 가격 비교 · {fuelLabel}</h2>
                <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: "#4d94ff" }} /> 세일
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: "#555d6e" }} /> 경쟁 평균
                  </span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={compChartData} barGap={4} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="name" tick={{ fill: "#7a8599", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis
                    domain={["dataMin - 40", "dataMax + 20"]}
                    tick={{ fill: "#7a8599", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1a1e2a", border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8, fontSize: 12, color: "#f0f2f5",
                    }}
                    formatter={(v) => [`${v.toLocaleString()}원`]}
                  />
                  <ReferenceLine y={data.nationalAvg[fuelType]} stroke="#ff9f43" strokeDasharray="5 5" strokeWidth={1} label={{
                    value: `전국 ${data.nationalAvg[fuelType].toLocaleString()}`,
                    position: "right", fill: "#ff9f43", fontSize: 10,
                  }} />
                  <Bar dataKey="세일" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    {compChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.diff > 0 ? "rgba(232,93,93,0.7)" : "rgba(77,148,255,0.7)"} />
                    ))}
                  </Bar>
                  <Bar dataKey="경쟁평균" fill="#555d6e" radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Position Map */}
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 14, padding: 20, marginBottom: 24,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>전국 평균 대비 포지션 · {fuelLabel}</h2>
                <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#3db88c" }} /> 평균 이하
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#e85d5d" }} /> 평균 이상
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 2, height: 12, background: "#ff9f43" }} /> 전국 평균
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#555d6e" }} /> 경쟁사
                  </span>
                </div>
              </div>
              {data.groups.map((g, i) => (
                <PositionBar key={i} group={g} fuelType={fuelType} nationalAvg={data.nationalAvg[fuelType]} />
              ))}
            </div>
          </>
        )}

        {/* DETAIL VIEW */}
        {activeView === "detail" && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}>
            {data.groups.map((g, i) => (
              <GroupCard key={i} group={g} fuelType={fuelType} />
            ))}
          </div>
        )}

        {/* TREND VIEW */}
        {activeView === "trend" && (
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14, padding: 20,
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 20px" }}>최근 7일 가격 추세 · {fuelLabel}</h2>
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={data.trend} margin={{ top: 5, right: 30, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="date" tick={{ fill: "#7a8599", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis
                  domain={["dataMin - 10", "dataMax + 10"]}
                  tick={{ fill: "#7a8599", fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}
                  axisLine={false} tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1a1e2a", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8, fontSize: 12, color: "#f0f2f5",
                  }}
                  formatter={(v) => [`${v.toLocaleString()}원`]}
                />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12, color: "#7a8599" }}
                />
                <Line type="monotone" dataKey="sail" name="세일 평균" stroke="#4d94ff" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="competitor" name="경쟁사 평균" stroke="#555d6e" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="national" name="전국 평균" stroke="#ff9f43" strokeWidth={1.5} dot={{ r: 3 }} strokeDasharray="2 2" />
              </LineChart>
            </ResponsiveContainer>

            <div style={{
              marginTop: 20, padding: 16,
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              display: "flex", gap: 24, flexWrap: "wrap",
              fontSize: 12, color: "#9aa3b4",
            }}>
              <div>
                <span style={{ color: "#7a8599" }}>세일 평균 추이: </span>
                <span style={{ color: "#4d94ff", fontWeight: 600 }}>
                  {data.trend[0]?.sail} → {data.trend[data.trend.length - 1]?.sail}
                </span>
                <span style={{ marginLeft: 4 }}>
                  ({data.trend[data.trend.length - 1]?.sail - data.trend[0]?.sail > 0 ? "+" : ""}
                  {data.trend[data.trend.length - 1]?.sail - data.trend[0]?.sail}원)
                </span>
              </div>
              <div>
                <span style={{ color: "#7a8599" }}>경쟁 평균 추이: </span>
                <span style={{ color: "#9aa3b4", fontWeight: 600 }}>
                  {data.trend[0]?.competitor} → {data.trend[data.trend.length - 1]?.competitor}
                </span>
                <span style={{ marginLeft: 4 }}>
                  ({data.trend[data.trend.length - 1]?.competitor - data.trend[0]?.competitor > 0 ? "+" : ""}
                  {data.trend[data.trend.length - 1]?.competitor - data.trend[0]?.competitor}원)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Alert Section */}
        {activeView === "overview" && (
          <div style={{
            marginTop: 24,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 14, padding: 20,
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px" }}>주요 알림</h2>
            {data.groups.map((g, i) => {
              const compMin = Math.min(...g.competitors.map(c => c[fuelType]));
              const diff = g.sail[fuelType] - compMin;
              if (diff > 20) {
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", marginBottom: 8,
                    background: "rgba(232,93,93,0.06)",
                    borderRadius: 8, borderLeft: "3px solid #e85d5d",
                    fontSize: 13, color: "#d4a0a0",
                  }}>
                    <span style={{ fontSize: 16 }}>⚠</span>
                    <span>
                      <strong style={{ color: "#e85d5d" }}>{g.name}</strong> — 최저가 경쟁사 대비&nbsp;
                      <strong style={{ color: "#e85d5d" }}>+{diff}원</strong> 높음
                    </span>
                  </div>
                );
              }
              if (diff < -10) {
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", marginBottom: 8,
                    background: "rgba(61,184,140,0.06)",
                    borderRadius: 8, borderLeft: "3px solid #3db88c",
                    fontSize: 13, color: "#a0d4bc",
                  }}>
                    <span style={{ fontSize: 16 }}>✓</span>
                    <span>
                      <strong style={{ color: "#3db88c" }}>{g.name}</strong> — 최저가 경쟁사 대비&nbsp;
                      <strong style={{ color: "#3db88c" }}>{diff}원</strong> 낮음 (경쟁력 우위)
                    </span>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        padding: "16px 28px",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        fontSize: 11, color: "#555d6e",
        display: "flex", justifyContent: "space-between",
        marginTop: 40,
      }}>
        <span>SAIL 유가 모니터링 대시보드 · 오피넷 API 기반</span>
        <span>업데이트 시각: 1시, 2시, 9시, 12시, 16시, 19시</span>
      </footer>
    </div>
  );
}
