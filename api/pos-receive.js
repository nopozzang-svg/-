/* global process, Buffer */
// POS 판매데이터 수신 엔드포인트 (우주포스 → 세일)
//
// [현재 단계 = 관대한 수신함(capture)]
//   인증키(X-Api-Key)만 맞으면, 형식이 무엇이든 받은 payload를 그대로 pos_raw_inbox 에 저장한다.
//   목적: 우주포스가 실제로 보내는 JSON 포맷·필드명을 확인하기 위함.
//   → 실제 포맷 확인 후, daily_station_report(정본, hermes 공용) 매핑을 별도로 붙인다.
//     (지금은 정본 테이블을 건드리지 않으므로 hermes 자동수집과 충돌하지 않음)
//
// 인증: 헤더 X-Api-Key: <키>  또는  Authorization: Bearer <키>
//   키 값은 Vercel 환경변수 POS_API_KEY 로 설정. 코드에는 담지 않는다.

const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
// anon 키(프론트·크론과 동일). 수신 자체는 POS_API_KEY 로 별도 게이트하므로 anon 사용 무방.
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";

// 저장할 헤더만 화이트리스트 — 인증키(x-api-key/authorization)는 절대 저장하지 않는다.
function safeHeaders(h) {
  const keep = ["host", "user-agent", "content-type", "content-length", "x-forwarded-for", "x-real-ip"];
  const out = {};
  for (const k of keep) if (h[k] != null) out[k] = h[k];
  return out;
}

// req.body 가 이미 파싱돼 있지 않을 때(비-JSON content-type 등) 원문 스트림을 직접 읽는다.
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  // 연결 확인용 GET — 인증 불필요, 데이터 처리 없음 (우주포스가 URL 도달 여부만 확인 가능)
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "pos-receive",
      configured: !!process.env.POS_API_KEY,
      hint: "POST JSON with header X-Api-Key",
    });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  // 인증키 미설정이면 열린 엔드포인트가 되지 않도록 차단
  const expected = process.env.POS_API_KEY;
  if (!expected) {
    return res.status(503).json({ ok: false, error: "not_configured" });
  }

  // 인증 검증
  const headerKey = req.headers["x-api-key"];
  const authz = req.headers["authorization"] || "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7) : null;
  const provided = headerKey || bearer;
  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // 본문 파싱 — 형식이 무엇이든 최대한 보관
  let payload = req.body;
  let rawText = null;
  if (payload === undefined || payload === null || payload === "") {
    rawText = await readRawBody(req).catch(() => null);
    if (rawText) { try { payload = JSON.parse(rawText); } catch { payload = null; } }
  } else if (typeof payload === "string") {
    rawText = payload;
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }

  const isObj = payload && typeof payload === "object";
  const row = {
    received_at:  new Date().toISOString(),
    source_ip:    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || null,
    content_type: req.headers["content-type"] || null,
    headers:      safeHeaders(req.headers),
    payload:      isObj ? payload : null,
    raw_text:     isObj ? null : (rawText ?? null),
  };

  try {
    const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/pos_raw_inbox`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
    });
    if (!saveRes.ok) {
      const b = await saveRes.json().catch(() => ({}));
      // 저장 실패는 502로 알려 우주포스가 재전송하도록 유도
      return res.status(502).json({ ok: false, error: "store_failed", detail: b.message || `HTTP ${saveRes.status}` });
    }
    const saved = await saveRes.json().catch(() => []);
    return res.status(200).json({ ok: true, received: true, id: Array.isArray(saved) ? saved[0]?.id ?? null : null });
  } catch (e) {
    return res.status(502).json({ ok: false, error: "store_exception", detail: e.message });
  }
}
