// Vercel Edge Function — Opinet API 프록시
// Edge Runtime: Cloudflare 기반, 사용자 근처(한국) 노드에서 실행 → opinet.co.kr 접근 가능
export const config = { runtime: "edge" };

export default async function handler(req) {
  const API_KEY = "F250430333";
  const OPINET_BASE = "https://www.opinet.co.kr/api";

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint");

  if (!endpoint) {
    return new Response(JSON.stringify({ error: "endpoint query param is required" }), { status: 400 });
  }

  // endpoint 파라미터 제외한 나머지 쿼리스트링 전달
  searchParams.delete("endpoint");
  searchParams.set("code", API_KEY);
  searchParams.set("out", "json");

  const url = `${OPINET_BASE}/${endpoint}?${searchParams}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Opinet upstream error", status: response.status }), { status: response.status });
    }
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "s-maxage=300, stale-while-revalidate",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, v: 4 }), { status: 500 });
  }
}
