// Vercel Edge Function — KMBCO 원/달러 환율 스크래퍼
// Edge Runtime: 한국 노드에서 실행 → kmbco.com 접근 가능
export const config = { runtime: "edge" };

export default async function handler(req) {
  try {
    const response = await fetch("https://www.kmbco.com/kor/rate/exchange_rate.do", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": "https://www.kmbco.com/",
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "KMBCO upstream error" }), { status: response.status });
    }

    const html = await response.text();

    // categories: ['26/02/20', ...] 추출
    const catMatch  = html.match(/categories\s*:\s*\[([^\]]+)\]/);
    // '환율' 라인 시리즈 추출
    const rateMatch = html.match(/name\s*:\s*['"]환율['"]\s*,\s*data\s*:\s*\[([^\]]+)\]/);

    if (!rateMatch) {
      return new Response(JSON.stringify({ error: "Exchange rate parse failed" }), { status: 500 });
    }

    // 인덱스 정합성 유지: NaN 필터 전 원본 배열로 cats↔rates 매핑
    const rawRates = rateMatch[1].split(",").map(v => parseFloat(v.trim()));
    const rawCats = catMatch
      ? catMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
      : [];

    const validRates = rawRates.filter(v => !isNaN(v));
    if (validRates.length < 2) {
      return new Response(JSON.stringify({ error: "Insufficient rate data" }), { status: 500 });
    }

    // 'YY/MM/DD' → 'YYYY-MM-DD' 변환
    const catToDate = (cat) => {
      const parts = cat.split("/");
      if (parts.length !== 3) return null;
      const year = parseInt(parts[0], 10) + 2000;
      return `${year}-${parts[1]}-${parts[2]}`;
    };

    // 날짜 → 환율 매핑 (history) — rawRates 인덱스와 rawCats 인덱스를 동일하게 사용
    const history = {};
    rawCats.forEach((cat, i) => {
      const dateStr = catToDate(cat);
      if (dateStr && i < rawRates.length && !isNaN(rawRates[i])) history[dateStr] = rawRates[i];
    });

    const current = validRates[validRates.length - 1];
    const prev    = validRates[validRates.length - 2];

    return new Response(JSON.stringify({
      current,
      prev,
      change: +(current - prev).toFixed(1),
      date:   rawCats[rawCats.length - 1] ?? null,
      history,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
