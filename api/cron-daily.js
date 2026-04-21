// Vercel Cron — 매일 KST 08:10 (UTC 23:10) 자동 실행
// 주유소 게시가 + 국제지표(원유/제품가/환율) → Supabase 저장

const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";

const OPINET_KEY = "F250430333";
const OPINET_BASE = "https://www.opinet.co.kr/api";

// ─── 지점 정의 (App.jsx와 동일 구조) ───
const ALL_GROUPS = [
  // STATION_GROUPS
  {
    name: "광교신도시",
    sail: { id: "A0032871" },
    competitors: [{ name: "기흥서일", id: "A0008889" }, { name: "언남에너지", id: "A0008895" }],
  },
  {
    name: "안양",
    sail: { id: "A0000180" },
    competitors: [{ name: "청기와", id: "A0001856" }, { name: "안양알찬", id: "A0001905" }],
  },
  {
    name: "박달",
    sail: { id: "A0000263" },
    competitors: [{ name: "세광 푸른", id: "A0001980" }, { name: "안양원예농협", id: "A0001938" }, { name: "무지내", id: "A0009185" }, { name: "경동고속철", id: "A0000253" }],
  },
  {
    name: "일품",
    sail: { id: "A0005430" },
    competitors: [{ name: "원흥고양", id: "A0005555" }, { name: "우주", id: "A0005565" }, { name: "너명골", id: "A0005163" }],
  },
  {
    name: "남부순환로",
    sail: { id: "A0031528" },
    competitors: [{ name: "울선", id: "A0028919" }, { name: "올리셀프", id: "A0028937" }, { name: "무지개대공원", id: "A0028856" }],
  },
  {
    name: "온산",
    sail: { id: "A0029052" },
    competitors: [{ name: "당월", id: "A0029042" }, { name: "온산공단", id: "A0029175" }],
  },
  {
    name: "용인제1",
    sail: { id: "A0008842" },
    competitors: [{ name: "청정에너지", id: "A0008792" }, { name: "기흥서일", id: "A0008889" }],
  },
  {
    name: "김포제2",
    sail: { id: "A0019433" },
    competitors: [{ name: "초원셀프", id: "A0007874" }, { name: "대성1", id: "A0007738" }, { name: "인에너지", id: "A0008977" }, { name: "SK에덴", id: "A0007957" }],
  },
  // CHAIN_GROUPS
  {
    name: "토진",
    sail: { id: "A0033642" },
    competitors: [{ name: "삼성", id: "A0003404" }, { name: "이케이평택", id: "A0002949" }, { name: "현곡", id: "A0003023" }],
  },
  {
    name: "문장",
    sail: { id: "A0031202" },
    competitors: [{ name: "시민석화", id: "A0003579" }, { name: "이포", id: "A0003943" }],
  },
];

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


// ─── Main Handler ───
export default async function handler(req, res) {
  // KST 기준 오늘 날짜
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split("T")[0];

  const errors = [];

  // 주유소 게시가 + 국제지표 완전 병렬 실행 (10초 제한 대응)
  const stationIds = [...new Set(
    ALL_GROUPS.flatMap(g => [g.sail.id, ...g.competitors.map(c => c.id)])
  )];

  // 국제지표: Edge Runtime API 경유 (한국 IP 필요 — 크론은 US 노드라 직접 호출 불가)
  const apiBase = `https://${process.env.VERCEL_URL}`;

  // 모든 외부 요청 동시 시작
  const [stationFetched, petroRes, exchRes] = await Promise.all([
    // Opinet 전체 병렬
    Promise.all(
      stationIds.map(id =>
        fetch(`${OPINET_BASE}/detailById.do?code=${OPINET_KEY}&out=json&id=${id}`)
          .then(r => r.json())
          .catch(() => null)
      )
    ),
    // 페트로넷 → Edge Runtime 경유 (한국 노드에서 호출)
    fetch(`${apiBase}/api/petronet`, { signal: AbortSignal.timeout(9000) }).catch(() => null),
    // KMBCO 환율 → Edge Runtime 경유 (한국 노드에서 호출)
    fetch(`${apiBase}/api/exchange`,  { signal: AbortSignal.timeout(9000) }).catch(() => null),
  ]);

  // ─── 1. 주유소 스냅샷 저장 ───
  try {
    const results = {};
    stationIds.forEach((id, idx) => {
      const json = stationFetched[idx];
      if (!json?.RESULT?.OIL) return;
      const oil = Array.isArray(json.RESULT.OIL) ? json.RESULT.OIL[0] : json.RESULT.OIL;
      const prices = {};
      const oilPrices = oil.OIL_PRICE
        ? (Array.isArray(oil.OIL_PRICE) ? oil.OIL_PRICE : [oil.OIL_PRICE])
        : [];
      oilPrices.forEach(p => {
        if (p.PRODCD === "B027") prices.gasoline = parseFloat(p.PRICE);
        if (p.PRODCD === "D047") prices.diesel    = parseFloat(p.PRICE);
      });
      results[id] = prices;
    });

    const snapshot = { _live: true };
    for (const group of ALL_GROUPS) {
      const sp = results[group.sail.id] || {};
      const comp = {};
      group.competitors.forEach(c => {
        const cp = results[c.id] || {};
        comp[c.name] = { g: cp.gasoline || 0, d: cp.diesel || 0 };
      });
      snapshot[group.name] = { sg: sp.gasoline || 0, sd: sp.diesel || 0, comp };
    }

    const hasAnyPrice = Object.entries(snapshot)
      .filter(([k]) => k !== "_live")
      .some(([, v]) => v.sg > 0 || v.sd > 0);
    if (!hasAnyPrice) { errors.push("station_snapshots: all prices 0, skip"); }
    else {
      const saveRes = await supaUpsert("station_snapshots", { date: todayKST, snapshot });
      if (!saveRes.ok) errors.push(`station_snapshots upsert: ${saveRes.status}`);
    }
  } catch (e) {
    errors.push(`station fetch: ${e.message}`);
  }

  // ─── 2. 국제지표 저장 ───
  // [정책] carry-forward 방지 핵심 원칙:
  //   - 제품가(MOPS): 싱가포르 영업일 기준 → 페트로넷 history에 오늘 날짜 키가 있을 때만 저장
  //   - 환율: 한국 영업일 기준 → KMBCO history에 오늘 날짜 키가 있을 때만 저장
  //   - 각국 공휴일이 달라 제품가는 있고 환율은 null이거나 반대일 수 있음 → 필드별 독립 처리
  //   - 주말은 양쪽 모두 없으므로 저장 자체를 건너뜀
  const todayDow = new Date(todayKST).getDay(); // 0=일, 6=토
  if (todayDow !== 0 && todayDow !== 6) {
    try {
      const petro = (petroRes?.ok) ? await petroRes.json().catch(() => null) : null;
      const exch  = (exchRes?.ok)  ? await exchRes.json().catch(() => null)  : null;

      // 페트로넷은 익일 오전에 전날 싱가포르 가격 게시
      // → current = 가장 최근 영업일 가격 (오늘 날짜로 저장해 데일리로 사용)
      const fromHistory = (dataset) => dataset?.current ?? null;

      const intlRow = {
        date:        todayKST,
        wti:         fromHistory(petro?.wti),
        dubai:       fromHistory(petro?.dubai),
        brent:       fromHistory(petro?.brent),
        mops_gas:    fromHistory(petro?.mopsGasoline),
        mops_diesel: fromHistory(petro?.mopsDiesel),
        mops_kero:   fromHistory(petro?.mopsKerosene),
        exch:        fromHistory(exch),
      };

      // 모든 필드가 null이면 저장 불필요 (국경일 등으로 당일 데이터 미게시)
      const hasAnyValue = Object.entries(intlRow)
        .filter(([k]) => k !== "date")
        .some(([, v]) => v !== null);

      if (hasAnyValue) {
        const saveRes = await supaUpsert("intl_snapshots", intlRow);
        if (!saveRes.ok) errors.push(`intl_snapshots upsert: ${saveRes.status}`);
      }
    } catch (e) {
      errors.push(`intl fetch: ${e.message}`);
    }
  }

  return res.status(200).json({
    ok: errors.length === 0,
    date: todayKST,
    errors: errors.length ? errors : undefined,
  });
}
