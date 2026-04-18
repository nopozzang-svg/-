// Vercel Serverless Function — Opinet API 프록시
// 브라우저 CORS 우회: 클라이언트 → /api/opinet → (서버) → opinet.co.kr
import https from "https";

export default async function handler(req, res) {
  const API_KEY = "F250430333";
  const OPINET_BASE = "https://www.opinet.co.kr/api";

  const { endpoint, ...rest } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: "endpoint query param is required" });
  }

  const params = new URLSearchParams({ code: API_KEY, out: "json", ...rest });
  const urlStr = `${OPINET_BASE}/${endpoint}?${params}`;
  const url = new URL(urlStr);

  try {
    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "GET",
        rejectUnauthorized: false, // opinet.co.kr SSL 호환성 우회
        timeout: 8000,
      };
      const request = https.request(options, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error(`JSON parse failed: ${body.slice(0, 200)}`)); }
        });
      });
      request.on("error", reject);
      request.on("timeout", () => { request.destroy(); reject(new Error("timeout")); });
      request.end();
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
    return res.status(200).json(data);
  } catch (err) {
    console.error("Opinet proxy error:", err.message);
    return res.status(500).json({ error: err.message, v: 2 });
  }
}
