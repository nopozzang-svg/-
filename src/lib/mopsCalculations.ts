/**
 * MOPS 국내 환산 가격 계산 유틸
 *
 * [계산식]
 * 국내 환산 MOPS (원/L, 부가세 포함)
 *   = { [(제품가 + 수입부과금 + 관세) ÷ 158.984] × 환율 + 세금 + 프리미엄 } × 1.1
 *
 * [단위]
 *   제품가, 수입부과금, 관세: $/bbl
 *   환율: 원/달러
 *   세금, 프리미엄: 원/L
 *   결과: 원/L (부가세 10% 포함)
 *
 * [계산 방식]
 *   - 데일리:          오늘 제품가 + 오늘 환율
 *   - 당월 평균:       1일~오늘 평균 제품가 + 평균 환율
 *   - 당월 예측 평균:  1일~오늘 실적 + 남은 캘린더 일수는 오늘 값 유지 가정한 평균 제품가 + 평균 환율
 *   ※ "일별 MOPS 먼저 계산 후 평균" 방식이 아님 — 평균값을 공식에 넣는 방식임
 *
 * [공휴일/주말 처리]
 *   carry-forward 정책: 해당 일 데이터 없으면 직전 영업일 값 사용
 *   월 첫 영업일 이전 날짜는 포함하지 않음 (첫 데이터 도착 전까지 skip)
 */

import type {
  MopsPriceInput,
  ProjectedAverageInput,
  ProductConstants,
  MopsResult,
} from "../types/mops";

/** 1배럴 = 158.984 리터 (고정) */
const BARRELS_TO_LITERS = 158.984;
/** 부가세 10% */
const VAT_RATE = 1.1;

/**
 * 국내 환산 MOPS 가격 계산 (순수 함수)
 * = { [(제품가 + 수입부과금 + 관세) ÷ 158.984] × 환율 + 세금 + 프리미엄 } × 1.1
 */
export function calculateMopsPrice({
  productPrice,
  exchangeRate,
  importCharge,
  tariff,
  tax,
  premium,
}: MopsPriceInput): number {
  const perLiter =
    ((productPrice + importCharge + tariff) / BARRELS_TO_LITERS) * exchangeRate;
  return (perLiter + tax + premium) * VAT_RATE;
}

/**
 * 산술 평균 계산 (순수 함수)
 * 빈 배열이면 null 반환
 */
export function getPeriodAverage(values: number[]): number | null {
  if (!values || values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * 당월 예측 평균 계산 (순수 함수)
 *
 * 예측 평균 = (실제 누적합 + 오늘 값 × 남은 일수) / 이번 달 총 일수
 *
 * @param actualValues   1일~오늘까지 carry-forward 채운 값 배열
 * @param todayValue     오늘 값 (남은 일수에 반복 적용)
 * @param daysInMonth    이번 달 총 캘린더 일수
 * @param actualDayCount 실제 데이터 구간 일수 (= actualValues.length)
 */
export function getProjectedMonthAverage({
  actualValues,
  todayValue,
  daysInMonth,
  actualDayCount,
}: ProjectedAverageInput): number | null {
  if (!actualValues || actualValues.length === 0) return null;
  if (actualDayCount <= 0 || daysInMonth <= 0) return null;

  const remaining = Math.max(0, daysInMonth - actualDayCount);
  const totalSum  = actualValues.reduce((sum, v) => sum + v, 0) + todayValue * remaining;
  return totalSum / daysInMonth;
}

/**
 * localStorage의 sail_intl_history에서 당월 특정 필드를 carry-forward 적용하여 배열로 추출
 *
 * [정책] carry-forward: 해당 날짜 데이터가 없으면 직전 영업일 값을 사용
 * [정책] 월 첫 영업일 이전 날짜(예: 주말 시작)는 배열에서 제외 (null carry 없음)
 *
 * @param history  { "YYYY-MM-DD": { mopsGas, mopsDiesel, mopsKero, exch, ... } }
 * @param field    추출할 필드명 ("mopsGas" | "mopsDiesel" | "mopsKero" | "exch" 등)
 * @param year     연도 (KST 기준)
 * @param month    월 (0-indexed, KST 기준)
 * @param endDay   오늘 날짜 (포함, 1-indexed)
 */
export function extractMonthlyValues(
  history: Record<string, Record<string, number>>,
  field: string,
  year: number,
  month: number,
  endDay: number
): number[] {
  const values: number[] = [];
  let lastVal: number | null = null;

  for (let d = 1; d <= endDay; d++) {
    const mm      = String(month + 1).padStart(2, "0");
    const dd      = String(d).padStart(2, "0");
    const dateStr = `${year}-${mm}-${dd}`;
    const dayData = history[dateStr];

    if (dayData != null && dayData[field] != null) {
      lastVal = dayData[field];
    }

    // lastVal이 null이면 아직 첫 영업일 도래 전 → 배열에 추가하지 않음
    if (lastVal !== null) {
      values.push(lastVal);
    }
  }

  return values;
}

/**
 * 단일 유종의 데일리/당월평균/당월예측평균 MOPS 계산
 *
 * 가정:
 *   - 제품가와 환율을 각각 평균 낸 뒤 MOPS 공식에 대입함
 *   - "일별 MOPS 계산 후 평균" 방식을 사용하지 않음
 */
export function calculateProductSummary({
  dailyProductPrice,
  dailyExchangeRate,
  monthlyProductValues,
  monthlyExchValues,
  daysInMonth,
  constants,
}: {
  dailyProductPrice:    number | null;
  dailyExchangeRate:    number | null;
  monthlyProductValues: number[];
  monthlyExchValues:    number[];
  daysInMonth:          number;
  constants:            ProductConstants;
}): MopsResult {
  const result: MopsResult = {
    daily:                  null,
    monthlyAverage:         null,
    projectedMonthlyAverage: null,
  };

  const { importCharge, tariff, tax, premium } = constants;

  // ── 1. 데일리 ──
  if (dailyProductPrice != null && dailyExchangeRate != null) {
    result.daily = calculateMopsPrice({
      productPrice: dailyProductPrice,
      exchangeRate: dailyExchangeRate,
      importCharge, tariff, tax, premium,
    });
  }

  // ── 2. 당월 평균 ──
  const avgProduct = getPeriodAverage(monthlyProductValues);
  const avgExch    = getPeriodAverage(monthlyExchValues);
  if (avgProduct != null && avgExch != null) {
    result.monthlyAverage = calculateMopsPrice({
      productPrice: avgProduct,
      exchangeRate: avgExch,
      importCharge, tariff, tax, premium,
    });
  }

  // ── 3. 당월 예측 평균 ──
  const todayProduct = monthlyProductValues.at(-1) ?? null;
  const todayExch    = monthlyExchValues.at(-1) ?? null;
  const actualCount  = monthlyProductValues.length;

  if (todayProduct != null && todayExch != null && actualCount > 0) {
    const projectedProduct = getProjectedMonthAverage({
      actualValues:   monthlyProductValues,
      todayValue:     todayProduct,
      daysInMonth,
      actualDayCount: actualCount,
    });
    const projectedExch = getProjectedMonthAverage({
      actualValues:   monthlyExchValues,
      todayValue:     todayExch,
      daysInMonth,
      actualDayCount: actualCount,
    });

    if (projectedProduct != null && projectedExch != null) {
      result.projectedMonthlyAverage = calculateMopsPrice({
        productPrice: projectedProduct,
        exchangeRate: projectedExch,
        importCharge, tariff, tax, premium,
      });
    }
  }

  return result;
}
