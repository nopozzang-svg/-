// Vercel Cron — KST 07:30~10:50, 10분 단위 국제지표 재파싱
// 원유/제품가/환율만 Supabase intl_snapshots에 upsert한다.

const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";

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

const getKstNow = () => new Date(Date.now() + 9 * 60 * 60 * 1000);
const getKstDateStr = () => getKstNow().toISOString().split("T")[0];
const getKstMinutes = () => {
  const kst = getKstNow();
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
};

const isIntlPollingWindow = () => {
  const minutes = getKstMinutes();
  return minutes >= 7 * 60 + 30 && minutes <= 10 * 60 + 50;
};

const hasAnyIntlValue = (row) =>
  Object.entries(row)
    .filter(([key]) => key !== "date")
    .some(([, value]) => value !== null);

// ─── Main Handler ───
export default async function handler(req, res) {
  const todayKST = getKstDateStr();

  // schedule은 UTC 22,23,0,1시에 10분마다 돌기 때문에 07:00~07:20 KST는 안전하게 skip한다.
  if (!isIntlPollingWindow()) {
    return res.status(200).json({ ok: true, skipped: true, reason: "outside KST 07:30-10:50", date: todayKST });
  }

  const todayDow = new Date(todayKST).getDay(); // 0=일, 6=토
  if (todayDow === 0 || todayDow === 6) {
    return res.status(200).json({ ok: true, skipped: true, reason: "weekend", date: todayKST });
  }

  const errors = [];
  const apiBase = `https://${process.env.VERCEL_URL}`;

  try {
    const [petroRes, exchRes] = await Promise.all([
      fetch(`${apiBase}/api/petronet`, { signal: AbortSignal.timeout(9000) }).catch(() => null),
      fetch(`${apiBase}/api/exchange`,  { signal: AbortSignal.timeout(9000) }).catch(() => null),
    ]);

    const petro = (petroRes?.ok) ? await petroRes.json().catch(() => null) : null;
    const exch  = (exchRes?.ok)  ? await exchRes.json().catch(() => null)  : null;

    // 페트로넷은 익일 오전에 전날 싱가포르 가격 게시
    // → current = 가장 최근 영업일 가격 (오늘 날짜로 저장해 데일리로 사용)
    const fromCurrent = (dataset) => dataset?.current ?? null;

    const intlRow = {
      date:        todayKST,
      wti:         fromCurrent(petro?.wti),
      dubai:       fromCurrent(petro?.dubai),
      brent:       fromCurrent(petro?.brent),
      mops_gas:    fromCurrent(petro?.mopsGasoline),
      mops_diesel: fromCurrent(petro?.mopsDiesel),
      mops_kero:   fromCurrent(petro?.mopsKerosene),
      exch:        fromCurrent(exch),
    };

    if (!hasAnyIntlValue(intlRow)) {
      return res.status(200).json({ ok: true, skipped: true, reason: "no intl values", date: todayKST });
    }

    const saveRes = await supaUpsert("intl_snapshots", intlRow);
    if (!saveRes.ok) errors.push(`intl_snapshots upsert: ${saveRes.status}`);

    return res.status(200).json({
      ok: errors.length === 0,
      date: todayKST,
      saved: errors.length === 0,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, date: todayKST, errors: [e.message] });
  }
}
