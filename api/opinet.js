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
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Opinet upstream error", v: 3 });
    }
    const data = await response.json();
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).json(data);
  } catch (err) {
    console.error("Opinet proxy error:", err.message, err.cause);
    return res.status(500).json({ error: err.message, cause: String(err.cause), v: 3 });
  }
}
