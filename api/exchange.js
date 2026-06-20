// Vercel Edge Function — KMBCO 원/달러 환율 스크래퍼
// Edge Runtime: 한국 노드에서 실행 → kmbco.com 접근 가능
export const config = { runtime: "edge" };

const KMB_URL = "https://www.kmbco.com/kor/rate/exchange_rate.do";
const SMBS_XML_URL = "http://www.smbs.biz/ExRate/StdExRate_xml.jsp";

const COMMON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

const ymdToShort = (dateStr) => dateStr ? dateStr.slice(2).replaceAll("-", "/") : null;

const getKSTDate = () => new Date(Date.now() + 9 * 60 * 60 * 1000);

const formatYMD = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (d, days) => {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getQueryRange = () => {
  const end = getKSTDate();
  const start = addDays(end, -45);
  return { start: formatYMD(start), end: formatYMD(end) };
};

const parseKmb = (html) => {
  // categories: ['26/02/20', ...] 추출
  const catMatch  = html.match(/categories\s*:\s*\[([^\]]+)\]/);
  // '환율' 라인 시리즈 추출
  const rateMatch = html.match(/name\s*:\s*['"]환율['"]\s*,\s*data\s*:\s*\[([^\]]+)\]/);

  if (!rateMatch) throw new Error("Exchange rate parse failed");

  // 인덱스 정합성 유지: NaN 필터 전 원본 배열로 cats↔rates 매핑
  const rawRates = rateMatch[1].split(",").map(v => parseFloat(v.trim()));
  const rawCats = catMatch
    ? catMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
    : [];

  // 'YY/MM/DD' → 'YYYY-MM-DD' 변환
  const catToDate = (cat) => {
    const parts = cat.split("/");
    if (parts.length !== 3) return null;
    const year = parseInt(parts[0], 10) + 2000;
    return `${year}-${parts[1]}-${parts[2]}`;
  };

  const history = {};
  rawCats.forEach((cat, i) => {
    const dateStr = catToDate(cat);
    if (dateStr && i < rawRates.length && !isNaN(rawRates[i])) history[dateStr] = rawRates[i];
  });

  return history;
};

const fetchKmbHistory = async () => {
  const response = await fetch(KMB_URL, {
    headers: { ...COMMON_HEADERS, "Referer": "https://www.kmbco.com/" },
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) throw new Error(`KMBCO upstream error: ${response.status}`);
  return parseKmb(await response.text());
};

const fetchSmbsHistory = async (start, end) => {
  const url = `${SMBS_XML_URL}?arr_value=USD_${start}_${end}`;
  const response = await fetch(url, {
    headers: { ...COMMON_HEADERS, "Referer": "http://www.smbs.biz/ExRate/StdExRate.jsp" },
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) throw new Error(`SMBS upstream error: ${response.status}`);
  const xml = await response.text();
  const history = {};
  const re = /<set\b[^>]*label=['"](\d{2})\.(\d{2})\.(\d{2})['"][^>]*value=['"]([0-9.,]+)['"]/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    const [, yy, mm, dd, value] = match;
    const rate = parseFloat(value.replaceAll(",", ""));
    if (!isNaN(rate)) history[`20${yy}-${mm}-${dd}`] = rate;
  }
  return history;
};

const buildResponse = (kmbHistory, smbsHistory, warnings = []) => {
  const history = { ...kmbHistory };
  const historySources = {};

  Object.keys(kmbHistory).forEach(date => { historySources[date] = "KMB"; });
  Object.entries(smbsHistory).forEach(([date, rate]) => {
    if (history[date] == null) {
      history[date] = rate;
      historySources[date] = "SMBS";
    }
  });

  const dates = Object.keys(history).sort();
  if (dates.length < 2) throw new Error("Insufficient rate data");

  const currentDate = dates[dates.length - 1];
  const prevDate = dates[dates.length - 2];
  const current = history[currentDate];
  const prev = history[prevDate];
  const kmbLastDate = Object.keys(kmbHistory).sort().pop() ?? null;
  const source = historySources[currentDate] ?? "KMB";

  return {
    current,
    prev,
    change: +(current - prev).toFixed(1),
    date: ymdToShort(currentDate),
    dateYmd: currentDate,
    prevDate: ymdToShort(prevDate),
    prevDateYmd: prevDate,
    source,
    primarySource: "KMB",
    fallbackUsed: source !== "KMB",
    fallbackReason: source !== "KMB" ? `KMB ${ymdToShort(currentDate)} 미고시로 SMBS 보완` : null,
    kmbLastDate,
    smbsLastDate: Object.keys(smbsHistory).sort().pop() ?? null,
    history,
    historySources,
    warnings,
  };
};

export default async function handler() {
  const warnings = [];
  try {
    const { start, end } = getQueryRange();
    const [kmbResult, smbsResult] = await Promise.allSettled([
      fetchKmbHistory(),
      fetchSmbsHistory(start, end),
    ]);

    const kmbHistory = kmbResult.status === "fulfilled" ? kmbResult.value : {};
    const smbsHistory = smbsResult.status === "fulfilled" ? smbsResult.value : {};

    if (kmbResult.status === "rejected") warnings.push(kmbResult.reason?.message || "KMBCO fetch failed");
    if (smbsResult.status === "rejected") warnings.push(smbsResult.reason?.message || "SMBS fetch failed");

    const data = buildResponse(kmbHistory, smbsHistory, warnings);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, warnings }), { status: 500 });
  }
}
