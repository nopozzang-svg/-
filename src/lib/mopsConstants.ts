/**
 * MOPS 상수 관리 — localStorage CRUD
 * 추후 API/DB 연동 시 이 파일만 교체하면 됨
 */

import type { MonthConstants } from "../types/mops";

const STORAGE_KEY = "sail_mops_constants";

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

/** 월별 상수 저장 (upsert) */
export function saveMonthConstants(data: Omit<MonthConstants, "updatedAt">): void {
  const all = getAllConstants();
  all[data.month] = { ...data, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
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
  const month = kst.getUTCMonth(); // 0-indexed
  if (month === 0) return `${year - 1}-12`;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 기본 상수 딥카피 반환 */
export function getDefaultProducts(): MonthConstants["products"] {
  return JSON.parse(JSON.stringify(DEFAULT_PRODUCTS));
}
