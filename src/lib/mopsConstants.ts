/**
 * MOPS 상수 관리 — localStorage + Supabase 동기화
 */

import type { MonthConstants } from "../types/mops";

const STORAGE_KEY  = "sail_mops_constants";
const SUPABASE_URL = "https://ozxjyzhndrgyvtewlkac.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96eGp5emhuZHJneXZ0ZXdsa2FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5OTgyNjcsImV4cCI6MjA4NzU3NDI2N30.ESPSK3MZeXMf5gK6ajT0eeNedqxiuniS3zRFbuyzPu4";
const SUPA_HEADERS = {
  apikey:        SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

/** 사용자 제공 기본값 (매월 초 폼 초기값으로 사용) */
const DEFAULT_PRODUCTS: MonthConstants["products"] = {
  gasoline: { importCharge: 16, tariff: 1.98,  tax: 693.72, premium: 2.5 },
  kerosene: { importCharge: 16, tariff: 2.12,  tax: 72.5,   premium: 5.5 },
  diesel:   { importCharge: 16, tariff: 2.16,  tax: 475.9,  premium: 3.0 },
};

/** 저장된 전체 월별 상수 맵 반환 */
export function getAllConstants(): Record<string, MonthConstants> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

/** 특정 월 상수 반환 (없으면 null) */
export function getCurrentMonthConstants(monthKey: string): MonthConstants | null {
  return getAllConstants()[monthKey] ?? null;
}

/** 월별 상수 localStorage 저장 (upsert) */
export function saveMonthConstants(data: Omit<MonthConstants, "updatedAt">): void {
  const all = getAllConstants();
  all[data.month] = { ...data, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Supabase → localStorage 동기화 (앱 시작 시 호출) */
export async function syncConstantsFromSupabase(): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/mops_constants?select=*`, {
      headers: SUPA_HEADERS,
    });
    if (!res.ok) return;
    const rows: Array<{ month: string; products: MonthConstants["products"]; updated_at: string }> = await res.json();
    if (!rows.length) return;
    const all = getAllConstants();
    rows.forEach(row => {
      const local = all[row.month];
      // Supabase가 더 최신이거나 로컬에 없으면 덮어쓰기
      if (!local || new Date(row.updated_at) > new Date(local.updatedAt)) {
        all[row.month] = { month: row.month, products: row.products, updatedAt: row.updated_at };
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* 오프라인 등 실패 시 localStorage만 사용 */ }
}

/** localStorage 저장 + Supabase upsert (관리자 저장 시 호출) */
export async function saveAndSyncConstants(data: Omit<MonthConstants, "updatedAt">): Promise<void> {
  saveMonthConstants(data);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/mops_constants`, {
      method:  "POST",
      headers: { ...SUPA_HEADERS, Prefer: "resolution=merge-duplicates" },
      body:    JSON.stringify({ month: data.month, products: data.products }),
    });
  } catch { /* 저장은 됐으니 무시 */ }
}

/** KST 기준 현재 월 키 "YYYY-MM" */
export function getCurrentMonthKey(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().substring(0, 7);
}

/** KST 기준 전월 키 "YYYY-MM" */
export function getPrevMonthKey(): string {
  const kst   = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year  = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  if (month === 0) return `${year - 1}-12`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 기본 상수 딥카피 반환 */
export function getDefaultProducts(): MonthConstants["products"] {
  return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
}
