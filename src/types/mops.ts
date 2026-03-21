/** 유종별 상수값 */
export interface ProductConstants {
  /** 수입부과금 (단위: $/bbl) — 제품가와 같은 단위로 brackets 내부에서 사용 */
  importCharge: number;
  /** 관세 (단위: $/bbl) */
  tariff: number;
  /** 세금 — 교통세+교육세+주행세 합계 (단위: 원/L) */
  tax: number;
  /** 프리미엄 (단위: 원/L) */
  premium: number;
}

/** 월별 상수 설정 전체 구조 */
export interface MonthConstants {
  /** 기준월 "YYYY-MM" */
  month: string;
  /** 마지막 수정 시각 (ISO string) */
  updatedAt: string;
  /** 유종별 상수 */
  products: {
    gasoline: ProductConstants;
    kerosene: ProductConstants;
    diesel:   ProductConstants;
  };
}

/** MOPS 환산 결과 — 단일 유종 */
export interface MopsResult {
  /** 데일리 (원/L, 부가세 포함) */
  daily: number | null;
  /** 당월 평균 (원/L, 부가세 포함) */
  monthlyAverage: number | null;
  /** 당월 예측 평균 (원/L, 부가세 포함) */
  projectedMonthlyAverage: number | null;
}

/** MOPS 환산 결과 — 전 유종 */
export interface MopsAllProducts {
  gasoline: MopsResult;
  kerosene: MopsResult;
  diesel:   MopsResult;
}

/** calculateMopsPrice 입력 파라미터 */
export interface MopsPriceInput {
  productPrice:  number; // $/bbl
  exchangeRate:  number; // 원/달러
  importCharge:  number; // $/bbl
  tariff:        number; // $/bbl
  tax:           number; // 원/L
  premium:       number; // 원/L
}

/** getProjectedMonthAverage 입력 파라미터 */
export interface ProjectedAverageInput {
  /** 1일~오늘까지 carry-forward 채운 값 배열 */
  actualValues:   number[];
  /** 오늘 값 (남은 일수에 사용) */
  todayValue:     number;
  /** 이번 달 총 캘린더 일수 */
  daysInMonth:    number;
  /** 실제 데이터 구간 캘린더 일수 (actualValues.length 와 동일) */
  actualDayCount: number;
}
