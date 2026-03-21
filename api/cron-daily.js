// Vercel Cron — 매일 KST 08:10 (UTC 23:10) 자동 실행
// 주유소 게시가 + 국제지표(원유/제품가/환율) → Supabase 저장

const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";

const OPINET_KEY = "F250430333";
const OPINET_BASE = "https://www.opinet.co.kr/api";

// ─── 지점 정의 (App.jsx와 동일 구조) ───
const ALL_GROUPS = [
  // STATION_GROUPS
  {
    name: "광교신도시",
    sail: { id: "A0032871" },
    competitors: [{ name: "기흥서일", id: "A0008889" }, { name: "언남에너지", id: "A0008895" }],
  },
  {
    name: "안양",
    sail: { id: "A0000180" },
    competitors: [{ name: "청기와", id: "A0001856" }, { name: "안양알찬", id: "A0001905" }],
  },
  {
    name: "박달",
    sail: { id: "A0000263" },
    competitors: [{ name: "세광 푸른", id: "A0001980" }, { name: "안양원예농협", id: "A0001938" }, { name: "무지내", id: "A0009185" }],
  },
  {
    name: "일품",
    sail: { id: "A0005430" },
    competitors: [{ name: "원흥고양", id: "A0005555" }, { name: "우주", id: "A0005565" }, { name: "너명골", id: "A0005163" }],
  },
  {
    name: "남부순환로",
    sail: { id: "A0031528" },
    competitors: [{ name: "울선", id: "A0028919" }, { name: "올리셀프", id: "A0028937" }, { name: "무지개대공원", id: "A0028856" }],
  },
  {
    name: "온산",
    sail: { id: "A0029052" },
    competitors: [{ name: "당월", id: "A0029042" }, { name: "온산공단", id: "A0029175" }],
  },
  {
    name: "용인제1",
    sail: { id: "A0008842" },
    competitors: [{ name: "청정에너지", id: "A0008792" }, { name: "기흥서일", id: "A0008889" }],
  },
  // CHAIN_GROUPS
  {
    name: "토진",
    sail: { id: "A0033642" },
    competitors: [{ name: "삼성", id: "A0003404" }, { name: "이케이평택", id: "A0002949" }, { name: "현곡", id: "A0003023" }],
  },
  {
    name: "문장",
    sail: { id: "A0031202" },
    competitors: [{ name: "시민석화", id: "A0003579" }, { name: "이포", id: "A0003943" }],
  },
];

// ─── Supabase upsert ───
const supaUpsert = (table, data) =>
  fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(data),
  });

// ─── Petronet 파싱 (api/petronet.js 동일 로직) ───
const parsePetronet = (html) => {
  const getChartSection = (name) => {
    const start = html.indexOf(`const ${name}`);
    if (start === -1) return "";
    const nextConst = html.indexOf("const ", start + name.length + 6);
    return nextConst === -1 ? html.slice(start) : html.slice(start, nextConst);
  };

  const labelToDate = (label) => {
    const parts = label.split(".");
    if (parts.length !== 2) return null;
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(d)) return null;
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const year = m > curMonth + 6 ? now.getFullYear() - 1 : now.getFullYear();
    return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };

  const getDataset = (section, label) => {
    const labelMatch = section.match(/labels\s*:\s*\[([^\]]+)\]/);
    const labels = labelMatch
      ? labelMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
      : [];
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`label\\s*:\\s*["']${escaped}["'][\\s\\S]*?data\\s*:\\s*\\[([^\\]]+)\\]`);
    const m = section.match(re);
    if (!m) return null;
    const arr = m[1].split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    if (arr.length < 2) return null;
    const history = {};
    labels.forEach((lbl, i) => {
      const dateStr = labelToDate(lbl);
      if (dateStr && arr[i] != null) history[dateStr] = arr[i];
    });
    return { current: arr[arr.length - 1], prev: arr[arr.length - 2], history };
  };

  const oilSection  = getChartSection("interOilPriceChartOpt");
  const prodSection = getChartSection("interProdPriceChartOpt");

  return {
    wti:          getDataset(oilSection,  "WTI (NYMEX)"),
    dubai:        getDataset(oilSection,  "Dubai"),
    brent:        getDataset(oilSection,  "Brent (ICE)"),
    mopsGasoline: getDataset(prodSection, "휘발유"),
    mopsDiesel:   getDataset(prodSection, "경유"),
    mopsKerosene: getDataset(prodSection, "등유"),
  };
};

// ─── KMBCO 환율 파싱 (api/exchange.js 동일 로직) ───
const parseExchange = (html) => {
  const catMatch  = html.match(/categories\s*:\s*\[([^\]]+)\]/);
  const rateMatch = html.match(/name\s*:\s*['"]환율['"]\s*,\s*data\s*:\s*\[([^\]]+)\]/);
  if (!rateMatch) return null;

  const rates = rateMatch[1].split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
  const rawCats = catMatch
    ? catMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
    : [];

  if (rates.length < 2) return null;

  const catToDate = (cat) => {
    const parts = cat.split("/");
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10) + 2000;
    return `${year}-${parts[1]}-${parts[2]}`;
  };

  const history = {};
  rawCats.forEach((cat, i) => {
    const dateStr = catToDate(cat);
    if (dateStr && rates[i] != null) history[dateStr] = rates[i];
  });

  return {
    current: rates[rates.length - 1],
    prev:    rates[rates.length - 2],
    history,
  };
};

// ─── Main Handler ───
export default async function handler(req, res) {
  // KST 기준 오늘 날짜
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];

  const errors = [];

  // 주유소 게시가 + 국제지표 완전 병렬 실행 (10초 제한 대응)
  const intlHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  };

  const stationIds = [...new Set(
    ALL_GROUPS.flatMap(g => [g.sail.id, ...g.competitors.map(c => c.id)])
  )];

  // 모든 외부 요청 동시 시작
  const [stationFetched, petroRes, exchRes] = await Promise.all([
    // Opinet 전체 병렬
    Promise.all(
      stationIds.map(id =>
        fetch(`${OPINET_BASE}/detailById.do?code=${OPINET_KEY}&out=json&id=${id}`)
          .then(r => r.json())
          .catch(() => null)
      )
    ),
    // 페트로넷
    fetch("https://www.petronet.co.kr/v4/main.jsp", { headers: { ...intlHeaders, Referer: "https://www.petronet.co.kr/" } })
      .catch(() => null),
    // KMBCO 환율
    fetch("https://www.kmbco.com/kor/rate/exchange_rate.do", { headers: { ...intlHeaders, Referer: "https://www.kmbco.com/" } })
      .catch(() => null),
  ]);

  // ─── 1. 주유소 스냅샷 저장 ───
  try {
    const results = {};
    stationIds.forEach((id, idx) => {
      const json = stationFetched[idx];
      if (!json?.RESULT?.OIL) return;
      const oil = Array.isArray(json.RESULT.OIL) ? json.RESULT.OIL[0] : json.RESULT.OIL;
      const prices = {};
      const oilPrices = oil.OIL_PRICE
        ? (Array.isArray(oil.OIL_PRICE) ? oil.OIL_PRICE : [oil.OIL_PRICE])
        : [];
      oilPrices.forEach(p => {
        if (p.PRODCD === "B027") prices.gasoline = parseFloat(p.PRICE);
        if (p.PRODCD === "D047") prices.diesel    = parseFloat(p.PRICE);
      });
      results[id] = prices;
    });

    const snapshot = { _live: true };
    for (const group of ALL_GROUPS) {
      const sp = results[group.sail.id] || {};
      const comp = {};
      group.competitors.forEach(c => {
        const cp = results[c.id] || {};
        comp[c.name] = { g: cp.gasoline || 0, d: cp.diesel || 0 };
      });
      snapshot[group.name] = { sg: sp.gasoline || 0, sd: sp.diesel || 0, comp };
    }

    const saveRes = await supaUpsert("station_snapshots", { date: todayKST, snapshot });
    if (!saveRes.ok) errors.push(`station_snapshots upsert: ${saveRes.status}`);
  } catch (e) {
    errors.push(`station fetch: ${e.message}`);
  }

  // ─── 2. 국제지표 저장 ───
  try {
    const petroHtml = petroRes ? await petroRes.text() : "";
    const exchHtml  = exchRes  ? await exchRes.text()  : "";

    const petro = petroHtml ? parsePetronet(petroHtml) : null;
    const exch  = exchHtml  ? parseExchange(exchHtml)  : null;

    const intlRow = {
      date:        todayKST,
      wti:         petro?.wti?.current         ?? null,
      dubai:       petro?.dubai?.current        ?? null,
      brent:       petro?.brent?.current        ?? null,
      mops_gas:    petro?.mopsGasoline?.current ?? null,
      mops_diesel: petro?.mopsDiesel?.current   ?? null,
      mops_kero:   petro?.mopsKerosene?.current ?? null,
      exch:        exch?.current                ?? null,
    };

    const saveRes = await supaUpsert("intl_snapshots", intlRow);
    if (!saveRes.ok) errors.push(`intl_snapshots upsert: ${saveRes.status}`);
  } catch (e) {
    errors.push(`intl fetch: ${e.message}`);
  }

  return res.status(200).json({
    ok: errors.length === 0,
    date: todayKST,
    errors: errors.length ? errors : undefined,
  });
}
