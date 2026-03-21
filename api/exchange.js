// Vercel Serverless Function — KMBCO 원/달러 환율 스크래퍼
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

    // var data1 = { ... } 에서 '환율' 라인 시리즈 추출
    const rateMatch = html.match(/name\s*:\s*['"]환율['"]\s*,\s*data\s*:\s*\[([^\]]+)\]/);
    const catMatch  = html.match(/categories\s*:\s*\[([^\]]+)\]/);

    if (!rateMatch) {
      return res.status(500).json({ error: "Exchange rate parse failed" });
    }

    const rates = rateMatch[1].split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    const categories = catMatch
      ? catMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
      : [];

    if (rates.length < 2) {
      return res.status(500).json({ error: "Insufficient rate data" });
    }

    const current = rates[rates.length - 1];
    const prev    = rates[rates.length - 2];

    // 1시간 캐시
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json({
      current,
      prev,
      change: +(current - prev).toFixed(1),
      date:   categories[categories.length - 1] ?? null,
    });
  } catch (err) {
    console.error("Exchange rate error:", err);
    return res.status(500).json({ error: err.message });
  }
}
