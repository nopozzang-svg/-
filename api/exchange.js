// Vercel Serverless Function — KMBCO 원/달러 환율 스크래퍼
// history 포함 (당월 평균 계산용)
export default async function handler(req, res) {
  try {
    const response = await fetch("https://www.kmbco.com/kor/rate/exchange_rate.do", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": "https://www.kmbco.com/",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "KMBCO upstream error" });
    }

    const html = await response.text();

    // categories: ['26/02/20', ...] 추출
    const catMatch  = html.match(/categories\s*:\s*\[([^\]]+)\]/);
    // '환율' 라인 시리즈 추출
    const rateMatch = html.match(/name\s*:\s*['"]환율['"]\s*,\s*data\s*:\s*\[([^\]]+)\]/);

    if (!rateMatch) {
      return res.status(500).json({ error: "Exchange rate parse failed" });
    }

    // 인덱스 정합성 유지: NaN 필터 전 원본 배열로 cats↔rates 매핑
    const rawRates = rateMatch[1].split(",").map(v => parseFloat(v.trim()));
    const rawCats = catMatch
      ? catMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
      : [];

    const validRates = rawRates.filter(v => !isNaN(v));
    if (validRates.length < 2) {
      return res.status(500).json({ error: "Insufficient rate data" });
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

    // CDN 캐시 비활성화 — 프론트엔드 localStorage에서 캐싱 처리
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      current,
      prev,
      change: +(current - prev).toFixed(1),
      date:   rawCats[rawCats.length - 1] ?? null,
      history,
    });
  } catch (err) {
    console.error("Exchange rate error:", err);
    return res.status(500).json({ error: err.message });
  }
}
