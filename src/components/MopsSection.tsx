import { useMemo, useState } from "react";
import {
  extractActualMonthlyValues,
  getRemainingWeekdays,
  calculateProductSummary,
} from "../lib/mopsCalculations";
import {
  getAllConstants,
  getCurrentMonthConstants,
  getCurrentMonthKey,
} from "../lib/mopsConstants";
import type { MopsAllProducts, MopsResult } from "../types/mops";

const INTL_HISTORY_KEY = "sail_intl_history";

// intlData 타입 (App.jsx의 intlData 구조 반영)
interface IntlData {
  petro?: {
    mopsGasoline?: { current?: number };
    mopsDiesel?:   { current?: number };
    mopsKerosene?: { current?: number };
  };
  exch?: { current?: number };
}

interface Props {
  intlData:       IntlData | null;
  onOpenSettings: () => void;
}

/** 숫자 표시 헬퍼 — #,###원 */
function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("ko-KR") + "원";
}

/** 당월比 셀 렌더링 */
function renderDiff(result: MopsResult) {
  const diff =
    result.daily != null && result.projectedMonthlyAverage != null
      ? Math.round(result.daily) - Math.round(result.projectedMonthlyAverage)
      : null;
  if (diff == null || Math.abs(diff) < 1) return <span>—</span>;
  const up = diff > 0;
  return (
    <span style={{ color: up ? "#ef4444" : "#2563eb", fontWeight: 600 }}>
      {up ? "▲" : "▼"} {Math.abs(diff).toLocaleString("ko-KR")}원
    </span>
  );
}

const EMPTY: MopsResult = { daily: null, monthlyAverage: null, projectedMonthlyAverage: null };

export default function MopsSection({ intlData, onOpenSettings }: Props) {
  const currentMonthKey = getCurrentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);

  // 상수가 저장된 월 목록 (최신순)
  const availableMonths = useMemo(() => {
    const allConsts = getAllConstants();
    return Object.keys(allConsts).sort().reverse();
  }, []);

  const isCurrentMonth = selectedMonth === currentMonthKey;

  // KST 기준 오늘 날짜 정보 (현재 월 계산용)
  const { year: todayYear, month: todayMonth, today } = useMemo(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return {
      year:  kst.getUTCFullYear(),
      month: kst.getUTCMonth(),
      today: kst.getUTCDate(),
    };
  }, []);

  const remainingWeekdays = getRemainingWeekdays(todayYear, todayMonth, today);

  // 선택된 월의 연도/월(0-indexed) 파싱
  const [selYear, selMonthIdx] = useMemo(() => {
    const parts = selectedMonth.split("-").map(Number);
    return [parts[0], parts[1] - 1];
  }, [selectedMonth]);

  // 선택된 월의 상수
  const constants = getCurrentMonthConstants(selectedMonth);

  // 계산 결과
  const results = useMemo((): MopsAllProducts | null => {
    if (!constants) return null;

    let history: Record<string, Record<string, number>> = {};
    try {
      history = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}");
    } catch { /* ignore */ }

    // 과거 월: remainingWeekdays=0, daily=null → 월 평균만 의미 있음
    const selRemaining = isCurrentMonth ? remainingWeekdays : 0;
    const dailyExch    = isCurrentMonth ? (intlData?.exch?.current ?? null) : null;

    const exchValues = extractActualMonthlyValues(history, "exch", selYear, selMonthIdx);

    const compute = (
      productField: string,
      dailyValue:   number | null | undefined,
      productKey:   keyof typeof constants.products
    ): MopsResult =>
      calculateProductSummary({
        dailyProductPrice:    isCurrentMonth ? (dailyValue ?? null) : null,
        dailyExchangeRate:    dailyExch,
        monthlyProductValues: extractActualMonthlyValues(history, productField, selYear, selMonthIdx),
        monthlyExchValues:    exchValues,
        remainingWeekdays:    selRemaining,
        constants:            constants.products[productKey],
      });

    return {
      gasoline: compute("mopsGas",    intlData?.petro?.mopsGasoline?.current, "gasoline"),
      diesel:   compute("mopsDiesel", intlData?.petro?.mopsDiesel?.current,   "diesel"),
      kerosene: compute("mopsKero",   intlData?.petro?.mopsKerosene?.current,  "kerosene"),
    };
  }, [intlData, constants, selYear, selMonthIdx, isCurrentMonth, remainingWeekdays]);

  const missingConstants = !constants;
  const showWarning      = missingConstants && isCurrentMonth && today <= 5;

  const updatedAt = constants?.updatedAt
    ? new Date(constants.updatedAt).toLocaleString("ko-KR", {
        month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  const gas  = results?.gasoline ?? EMPTY;
  const dsl  = results?.diesel   ?? EMPTY;
  const kero = results?.kerosene ?? EMPTY;

  return (
    <div className="mops-section">

      {/* ── 헤더 ── */}
      <div className="mops-header">
        <div>
          <span className="mops-title">국내 환산 MOPS</span>
          <span className="mops-subtitle"> · 원 · 부가세 포함</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {updatedAt && (
            <span className="mops-meta">
              기준: {constants?.month} · 수정: {updatedAt}
            </span>
          )}
          {!constants && (
            <span className="mops-meta mops-meta-warn">
              ⚠ {selectedMonth} 상수 미입력
            </span>
          )}
          <button className="mops-settings-btn" onClick={onOpenSettings}>
            ⚙ 상수 설정
          </button>
        </div>
      </div>

      {/* ── 월 선택 탭 ── */}
      {availableMonths.length > 0 && (
        <div className="mops-month-tabs">
          {/* 현재 월이 목록에 없을 경우 별도 탭 */}
          {!availableMonths.includes(currentMonthKey) && (
            <button
              className={`mops-month-tab ${selectedMonth === currentMonthKey ? "mops-month-tab-active" : ""}`}
              onClick={() => setSelectedMonth(currentMonthKey)}
            >
              {currentMonthKey} (당월)
            </button>
          )}
          {availableMonths.map((m) => (
            <button
              key={m}
              className={`mops-month-tab ${selectedMonth === m ? "mops-month-tab-active" : ""}`}
              onClick={() => setSelectedMonth(m)}
            >
              {m}{m === currentMonthKey ? " (당월)" : ""}
            </button>
          ))}
        </div>
      )}

      {/* ── 월초 배너 (1~5일, 상수 없을 때) ── */}
      {showWarning && (
        <div className="mops-warning-banner">
          <span>
            ⚠ 이번 달({currentMonthKey}) 상수값(세금/프리미엄/관세/수입부과금)이 아직
            입력되지 않았습니다.
          </span>
          <button className="mops-warning-link" onClick={onOpenSettings}>
            상수 설정으로 이동 →
          </button>
        </div>
      )}

      {/* ── 상수 없음 ── */}
      {missingConstants && !showWarning && (
        <div className="mops-no-data">
          {selectedMonth} 상수값이 없습니다.{" "}
          {isCurrentMonth && (
            <button
              onClick={onOpenSettings}
              style={{ color: "#7c3aed", background: "none", border: "none",
                cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: "inherit" }}
            >
              상수 설정
            </button>
          )}
          {isCurrentMonth && "에서 입력해 주세요."}
        </div>
      )}

      {/* ── 결과 테이블 ── */}
      {!missingConstants && (
        <div className="mops-table-wrap">
          <table className="mops-table">
            <thead>
              <tr>
                <th className="mops-th mops-th-fuel">구분</th>
                <th className="mops-th mops-th-center">무연</th>
                <th className="mops-th mops-th-center">경유</th>
                <th className="mops-th mops-th-center">등유</th>
              </tr>
            </thead>
            <tbody>
              {/* 데일리 — 당월에서만 표시 */}
              {isCurrentMonth && (
                <tr className="mops-tr">
                  <td className="mops-td mops-td-fuel">
                    데일리<br /><span className="mops-th-sub">오늘</span>
                  </td>
                  <td className="mops-td" style={{ fontWeight: 600 }}>{fmt(gas.daily)}</td>
                  <td className="mops-td" style={{ fontWeight: 600 }}>{fmt(dsl.daily)}</td>
                  <td className="mops-td" style={{ fontWeight: 600 }}>{fmt(kero.daily)}</td>
                </tr>
              )}
              {/* 월 평균 */}
              <tr className="mops-tr">
                <td className="mops-td mops-td-fuel">
                  {isCurrentMonth ? "당월 평균" : "월 평균"}<br />
                  <span className="mops-th-sub">실적 기준</span>
                </td>
                <td className="mops-td">{fmt(gas.monthlyAverage)}</td>
                <td className="mops-td">{fmt(dsl.monthlyAverage)}</td>
                <td className="mops-td">{fmt(kero.monthlyAverage)}</td>
              </tr>
              {/* 당월 예측 평균 — 당월에서만 표시 */}
              {isCurrentMonth && (
                <tr className="mops-tr">
                  <td className="mops-td mops-td-fuel mops-td-projected">
                    당월 예측<br /><span className="mops-th-sub">잔여 {remainingWeekdays}평일 가정</span>
                  </td>
                  <td className="mops-td mops-td-projected">{fmt(gas.projectedMonthlyAverage)}</td>
                  <td className="mops-td mops-td-projected">{fmt(dsl.projectedMonthlyAverage)}</td>
                  <td className="mops-td mops-td-projected">{fmt(kero.projectedMonthlyAverage)}</td>
                </tr>
              )}
              {/* 당월比 — 당월에서만 표시 */}
              {isCurrentMonth && (
                <tr className="mops-tr">
                  <td className="mops-td mops-td-fuel mops-td-rowdiff">
                    당월比<br /><span className="mops-th-sub">데일리 − 당월예측</span>
                  </td>
                  <td className="mops-td mops-td-diff">{renderDiff(gas)}</td>
                  <td className="mops-td mops-td-diff">{renderDiff(dsl)}</td>
                  <td className="mops-td mops-td-diff">{renderDiff(kero)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 계산식 참고 */}
          <div className="mops-formula-note">
            {"[(제품가 + 프리미엄 + 관세) ÷ 158.984] × 환율 + 수입부과금 + 세금"} × 1.1
          </div>
        </div>
      )}
    </div>
  );
}
