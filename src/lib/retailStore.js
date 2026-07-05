// retailStore.js — 소매 마감일보 Supabase 읽기/쓰기 (브라우저·Node 공용)
//
// 파싱 결과(retailParser)를 daily_station_report 테이블에 upsert 한다.
//   · 브라우저: RetailSalesReport.jsx 가 import
//   · Node(Hermes): NAS에서 받아 파싱한 결과를 같은 함수로 저장 → 웹앱 업로드와 동일 동작
// fetch 는 브라우저·Node18+ 모두 전역 제공. 자격증명은 Node에서 env 로 덮어쓸 수 있게 함(기본값은 프론트와 동일한 anon 키).

import { monthLastDay } from "./retailParser.js";

// Node(Hermes)에선 env 로 자격증명 덮어쓰기 허용. 브라우저엔 globalThis.process 가 없어 자동으로 기본값 사용.
const ENV = globalThis.process?.env ?? {};

const SUPABASE_URL = ENV.SUPABASE_URL || "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_ANON_KEY = ENV.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";

const supaHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

// 테이블 스키마 (daily_station_report):
// id, date, station_name, station_group,
// gasoline_qty, gasoline_amount, diesel_qty, diesel_amount,
// kerosene_qty, total_qty, total_amount,
// car_wash_small, car_wash_large, car_wash_total, car_wash_amount,
// car_wash_free, car_wash_paid,
// gasoline_inv, diesel_inv, kerosene_inv,
// created_at, updated_at

export async function supaGetAll() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/daily_station_report?select=*&order=date.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (res.ok) return { error: null, data: await res.json() };
    const body = await res.json().catch(() => ({}));
    const isTableMissing = (body.code === "42P01") ||
      String(body.message || "").includes("does not exist");
    return { error: isTableMissing ? "table_missing" : "fetch_error", data: [] };
  } catch { return { error: "network_error", data: [] }; }
}

// 특정 주유소의 날짜 구간 행 일괄 삭제 (엘앤케이 월간 파일 재업로드 시 이전 잔재·빈 행 정리용)
export async function supaDeleteRange(stationName, startDate, endDate) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/daily_station_report?station_name=eq.${encodeURIComponent(stationName)}&date=gte.${startDate}&date=lte.${endDate}`,
    { method: "DELETE", headers: supaHeaders }
  );
}

export async function supaUpsert(stationName, stationGroup, parsed) {
  // 같은 주유소+날짜 기존 행 삭제 후 재삽입 (upsert 대용)
  await fetch(
    `${SUPABASE_URL}/rest/v1/daily_station_report?station_name=eq.${encodeURIComponent(stationName)}&date=eq.${parsed.dateStr}`,
    { method: "DELETE", headers: supaHeaders }
  );

  const total_qty    = parsed.gas_qty + parsed.diesel_qty + parsed.kero_qty;
  const total_amount = parsed.gas_amt + parsed.diesel_amt + parsed.kero_amt;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/daily_station_report`, {
    method: "POST",
    headers: supaHeaders,
    body: JSON.stringify({
      date:            parsed.dateStr,
      station_name:    stationName,
      station_group:   stationGroup,
      gasoline_qty:    parsed.gas_qty,
      gasoline_amount: parsed.gas_amt,
      diesel_qty:      parsed.diesel_qty,
      diesel_amount:   parsed.diesel_amt,
      kerosene_qty:    parsed.kero_qty,
      total_qty,
      total_amount,
      car_wash_free:   parsed.carwash_free,
      car_wash_paid:   parsed.carwash_paid,
      car_wash_total:  parsed.carwash_free + parsed.carwash_paid,
      car_wash_amount: parsed.carwash_amt,
      gasoline_inv:    parsed.gas_inv,
      diesel_inv:      parsed.diesel_inv,
      kerosene_inv:    parsed.kero_inv,
      updated_at:      new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
}

// parseWorkbook(retailParser) 결과를 그대로 저장.
//   · lnk:   (주유소×월)별 기존 행 정리 후 일괄 upsert
//   · magam: 단건 upsert
//   · manual: 주유소 미지정이라 저장하지 않음 (호출측이 별도 처리)
// 저장한 날짜 배열(정렬됨)을 반환 — 호출측에서 "마지막 날짜" 등에 활용.
export async function saveWorkbookResult(result) {
  if (result.type === "lnk") {
    const monthKeys = [...new Set(result.items.map(i => `${i.stationName}|${i.parsed.dateStr.substring(0, 7)}`))];
    for (const key of monthKeys) {
      const [sn, ym] = key.split("|");
      await supaDeleteRange(sn, `${ym}-01`, `${ym}-${String(monthLastDay(ym)).padStart(2, "0")}`);
    }
    for (const it of result.items) await supaUpsert(it.stationName, it.group, it.parsed);
    return result.items.map(i => i.parsed.dateStr).sort();
  }
  if (result.type === "magam") {
    await supaUpsert(result.station.name, result.station.group, result.parsed);
    return [result.parsed.dateStr];
  }
  return []; // manual — 저장 안 함
}
