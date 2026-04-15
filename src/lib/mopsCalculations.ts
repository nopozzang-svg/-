/**
 * MOPS 국내 환산 가격 계산 유틸
 *
 * [계산식]
 * 국내 환산 MOPS (원/L, 부가세 포함)
 *   = { [(제품가 + 프리미엄 + 관세) ÷ 158.984] × 환율 + 수입부과금 + 세금 } × 1.1
 *
 * [단위]
 *   제품가, 프리미엄, 관세: $/bbl → 분자 안 (배럴 기준)
 *   수입부과금, 세금: 원/L         → 환산 후 바깥에서 더함
 *   환율: 원/달러
 *   결과: 원/L (부가세 10% 포함)
 *
 * [평균 계산 방식] — 국제지표 월간 분석(calcMonthStats)과 동일
 *   - 실제 데이터가 있는 날만 포함 (carry-forward 없음)
 *   - 남은 일수: 오늘 이후 평일(월~금) 수
 *   - 예측 분모: 실적수 + 남은평일수
 *
 * [계산 방식]
 *   - 데일리:          오늘 제품가 + 오늘 환율
 *   - 당월 평균:       실적 제품가 평균 + 실적 환율 평균 → 공식 대입
 *   - 당월 예측 평균:  예측 제품가 평균 + 예측 환율 평균 → 공식 대입
 *   ※ "일별 MOPS 계산 후 평균" 방식이 아님 — 평균값을 공식에 넣는 방식임
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
 * = { [(제품가 + 프리미엄 + 관세) ÷ 158.984] × 환율 + 수입부과금 + 세금 } × 1.1
 *
 * 프리미엄·관세: $/bbl → 분자 안
 * 수입부과금·세금: 원/L → 환산 후 바깥에서 더함
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
    ((productPrice + premium + tariff) / BARRELS_TO_LITERS) * exchangeRate;
  return (perLiter + importCharge + tax) * VAT_RATE;
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
 * — 국제지표 calcMonthStats 와 동일한 로직 —
 *
 * 예측 평균 = (실제 누적합 + 마지막값 × 남은평일수) / (실적수 + 남은평일수)
 *
 * @param actualValues      실제 데이터가 있는 날짜의 값 배열 (carry-forward 없음)
 * @param todayValue        마지막 실제 값 (남은 평일에 반복 적용)
 * @param remainingWeekdays 오늘 이후 남은 평일(월~금) 수
 * @param actualDayCount    실적 데이터 포인트 수
 */
export function getProjectedMonthAverage({
  actualValues,
  todayValue,
  remainingWeekdays,
  actualDayCount,
}: ProjectedAverageInput): number | null {
  if (!actualValues || actualValues.length === 0) return null;
  if (actualDayCount <= 0) return null;

  const totalSum = actualValues.reduce((sum, v) => sum + v, 0) + todayValue * remainingWeekdays;
  return totalSum / (actualDayCount + remainingWeekdays);
}

/**
 * localStorage의 sail_intl_history에서 당월 특정 필드의 실제값만 추출
 * — 국제지표 calcMonthStats 와 동일한 필터링 로직 —
 *
 * [정책] carry-forward 없음: 실제 데이터가 있는 날짜의 값만 포함
 * [정책] 날짜 오름차순 정렬
 *
 * @param history  { "YYYY-MM-DD": { mopsGas, mopsDiesel, mopsKero, exch, ... } }
 * @param field    추출할 필드명
 * @param year     연도 (KST 기준)
 * @param month    월 (0-indexed, KST 기준)
 */
export function extractActualMonthlyValues(
  history: Record<string, Record<string, number>>,
  field: string,
  year: number,
  month: number,
): number[] {
  // KST 기준 오늘 날짜 — Petronet 1일 lag으로 인해 오늘 history 항목은
  // 실제 어제 싱가포르 가격이므로 월 평균에서 제외 (이중 계산 방지)
  const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().substring(0, 10);

  return Object.entries(history)
    .filter(([date]) => {
      if (date === kstToday) return false; // 오늘 제외
      const d = new Date(date + "T12:00:00Z"); // UTC 정오 기준 파싱 (요일 오차 방지)
      const dow = d.getDay(); // 0=일, 6=토
      return d.getFullYear() === year && d.getMonth() === month && dow !== 0 && dow !== 6;
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v[field])
    .filter((v): v is number => v != null && !isNaN(v));
}

/**
 * 오늘 이후 남은 평일(월~금) 수 계산
 * — 국제지표 calcMonthStats 와 동일한 로직 —
 */
export function getRemainingWeekdays(year: number, month: number, today: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate();
  let remaining = 0;
  for (let d = today + 1; d <= lastDay; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow !== 0 && dow !== 6) remaining++;
  }
  return remaining;
}

/**
 * 단일 유종의 데일리/당월평균/당월예측평균 MOPS 계산
 *
 * 평균 계산: 국제지표 월간 분석(calcMonthStats)과 동일한 방식
 *   - 실적: 실제 데이터 있는 날만 (carry-forward 없음)
 *   - 예측: 마지막값 × 남은평일 / (실적수 + 남은평일)
 *   - 평균 제품가 + 평균 환율을 공식에 대입 (일별 MOPS 평균 아님)
 */
export function calculateProductSummary({
  dailyProductPrice,
  dailyExchangeRate,
  monthlyProductValues,
  monthlyExchValues,
  remainingWeekdays,
  constants,
}: {
  dailyProductPrice:    number | null;
  dailyExchangeRate:    number | null;
  monthlyProductValues: number[];
  monthlyExchValues:    number[];
  remainingWeekdays:    number;
  constants:            ProductConstants;
}): MopsResult {
  const result: MopsResult = {
    daily:                   null,
    monthlyAverage:          null,
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
  // todayProduct: history 마지막값 (= Petronet 1일 lag → 어제 싱가포르 가격 = 오늘 데일리)
  // todayExch:    dailyExchangeRate 우선 (오늘 실제 환율), 없으면 history 마지막값
  const todayProduct  = monthlyProductValues.at(-1) ?? null;
  const todayExch     = dailyExchangeRate ?? monthlyExchValues.at(-1) ?? null;
  const actualCount   = monthlyProductValues.length;

  if (todayProduct != null && todayExch != null && actualCount > 0) {
    const projectedProduct = getProjectedMonthAverage({
      actualValues:      monthlyProductValues,
      todayValue:        todayProduct,
      remainingWeekdays,
      actualDayCount:    actualCount,
    });
    const projectedExch = getProjectedMonthAverage({
      actualValues:      monthlyExchValues,
      todayValue:        todayExch,
      remainingWeekdays,
      actualDayCount:    monthlyExchValues.length,
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

// 하위 호환용 — MopsSection.tsx에서 더 이상 사용하지 않음
export function extractMonthlyValues(
  history: Record<string, Record<string, number>>,
  field: string,
  year: number,
  month: number,
  _endDay: number
): number[] {
  return extractActualMonthlyValues(history, field, year, month);
}
