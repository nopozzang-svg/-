// Vercel Serverless Function — Opinet API 프록시
// 브라우저 CORS 우회: 클라이언트 → /api/opinet → (서버) → opinet.co.kr
export default async function handler(req, res) {
  const API_KEY = "F250430333";
  const OPINET_BASE = "https://www.opinet.co.kr/api";

  const { endpoint, ...rest } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: "endpoint query param is required" });
  }

  const params = new URLSearchParams({ code: API_KEY, out: "json", ...rest });
  const url = `${OPINET_BASE}/${endpoint}?${params}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        "Referer": "https://www.opinet.co.kr/",
      },
    });
    if (!response.ok) {
      return res.status(response.status).json({ error: "Opinet upstream error" });
    }
    const data = await response.json();
    // 5분 캐시 (동일 요청 중복 방지)
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).json(data);
  } catch (err) {
    console.error("Opinet proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
