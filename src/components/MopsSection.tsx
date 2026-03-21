import { useMemo } from "react";
import {
  extractMonthlyValues,
  calculateProductSummary,
} from "../lib/mopsCalculations";
import {
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

/** 숫자 표시 헬퍼 */
function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

/** 변화 방향 배지 */
function DiffBadge({ a, b }: { a: number | null; b: number | null }) {
  if (a == null || b == null) return null;
  const diff = a - b;
  if (Math.abs(diff) < 0.01) return null;
  const up = diff > 0;
  return (
    <span style={{ fontSize: 10, color: up ? "#ef4444" : "#2563eb", marginLeft: 4 }}>
      {up ? "▲" : "▼"}{Math.abs(diff).toFixed(2)}
    </span>
  );
}

/** 단일 결과 행 */
function ResultRow({
  label,
  result,
  monthlyRef,
}: {
  label:      string;
  result:     MopsResult;
  monthlyRef: number | null; // 당월 평균 (예측과 비교용)
}) {
  return (
    <tr className="mops-tr">
      <td className="mops-td mops-td-fuel">{label}</td>
      <td className="mops-td mops-td-num" style={{ fontWeight: 600 }}>
        {fmt(result.daily)}
      </td>
      <td className="mops-td mops-td-num">
        {fmt(result.monthlyAverage)}
      </td>
      <td className="mops-td mops-td-num mops-td-projected">
        {fmt(result.projectedMonthlyAverage)}
        <DiffBadge a={result.projectedMonthlyAverage} b={monthlyRef} />
      </td>
    </tr>
  );
}

export default function MopsSection({ intlData, onOpenSettings }: Props) {
  const monthKey   = getCurrentMonthKey();
  const constants  = getCurrentMonthConstants(monthKey);

  // KST 기준 날짜 정보
  const { year, month, today, daysInMonth } = useMemo(() => {
    const kst       = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const y         = kst.getUTCFullYear();
    const m         = kst.getUTCMonth(); // 0-indexed
    const d         = kst.getUTCDate();
    const lastDay   = new Date(y, m + 1, 0).getDate();
    return { year: y, month: m, today: d, daysInMonth: lastDay };
  }, []);

  // 계산 결과 (intlData 또는 constants 변경 시 재계산)
  const results = useMemo((): MopsAllProducts | null => {
    if (!constants || !intlData) return null;

    let history: Record<string, Record<string, number>> = {};
    try {
      history = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}");
    } catch { /* ignore */ }

    const exchValues = extractMonthlyValues(history, "exch", year, month, today);
    const dailyExch  = intlData.exch?.current ?? null;

    const compute = (
      productField: string,
      dailyValue:   number | null | undefined,
      productKey:   keyof typeof constants.products
    ): MopsResult =>
      calculateProductSummary({
        dailyProductPrice:    dailyValue ?? null,
        dailyExchangeRate:    dailyExch,
        monthlyProductValues: extractMonthlyValues(history, productField, year, month, today),
        monthlyExchValues:    exchValues,
        daysInMonth,
        constants:            constants.products[productKey],
      });

    return {
      gasoline: compute("mopsGas",     intlData.petro?.mopsGasoline?.current, "gasoline"),
      diesel:   compute("mopsDiesel",  intlData.petro?.mopsDiesel?.current,   "diesel"),
      kerosene: compute("mopsKero",    intlData.petro?.mopsKerosene?.current,  "kerosene"),
    };
  }, [intlData, constants, year, month, today, daysInMonth]);

  const missingConstants = !constants;
  const showWarning      = missingConstants && today <= 5; // 월 1~5일에만 배너 표시

  const updatedAt = constants?.updatedAt
    ? new Date(constants.updatedAt).toLocaleString("ko-KR", {
        month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  const rows: { key: keyof MopsAllProducts; label: string }[] = [
    { key: "gasoline", label: "무연" },
    { key: "diesel",   label: "경유" },
    { key: "kerosene", label: "등유" },
  ];

  return (
    <div className="mops-section">

      {/* ── 헤더 ── */}
      <div className="mops-header">
        <div>
          <span className="mops-title">국내 환산 MOPS</span>
          <span className="mops-subtitle"> · 원/L · 부가세 포함</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {updatedAt && (
            <span className="mops-meta">
              기준: {constants?.month} · 수정: {updatedAt}
            </span>
          )}
          {!constants && (
            <span className="mops-meta mops-meta-warn">
              ⚠ {monthKey} 상수 미입력
            </span>
          )}
          <button className="mops-settings-btn" onClick={onOpenSettings}>
            ⚙ 상수 설정
          </button>
        </div>
      </div>

      {/* ── 월초 배너 (1~5일, 상수 없을 때) ── */}
      {showWarning && (
        <div className="mops-warning-banner">
          <span>
            ⚠ 이번 달({monthKey}) 상수값(세금/프리미엄/관세/수입부과금)이 아직
            입력되지 않았습니다.
          </span>
          <button className="mops-warning-link" onClick={onOpenSettings}>
            상수 설정으로 이동 →
          </button>
        </div>
      )}

      {/* ── 상수 없음 (월초 아닌 경우) ── */}
      {missingConstants && !showWarning && (
        <div className="mops-no-data">
          이번 달({monthKey}) 상수값이 없습니다.{" "}
          <button
            onClick={onOpenSettings}
            style={{ color: "#7c3aed", background: "none", border: "none",
              cursor: "pointer", textDecoration: "underline", padding: 0, fontSize: "inherit" }}
          >
            상수 설정
          </button>
          에서 입력해 주세요.
        </div>
      )}

      {/* ── 결과 테이블 ── */}
      {!missingConstants && (
        <div className="mops-table-wrap">
          <table className="mops-table">
            <thead>
              <tr>
                <th className="mops-th mops-th-fuel">유종</th>
                <th className="mops-th">데일리<br /><span className="mops-th-sub">오늘</span></th>
                <th className="mops-th">당월 평균<br /><span className="mops-th-sub">1일~오늘 실적</span></th>
                <th className="mops-th mops-th-accent">당월 예측 평균<br /><span className="mops-th-sub">잔여 {daysInMonth - today}일 유지 가정</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label }) => (
                <ResultRow
                  key={key}
                  label={label}
                  result={results?.[key] ?? { daily: null, monthlyAverage: null, projectedMonthlyAverage: null }}
                  monthlyRef={results?.[key]?.monthlyAverage ?? null}
                />
              ))}
            </tbody>
          </table>

          {/* 계산식 참고 */}
          <div className="mops-formula-note">
            { "[(제품가 + 수입부과금 + 관세) ÷ 158.984] × 환율 + 세금 + 프리미엄" } × 1.1
          </div>
        </div>
      )}
    </div>
  );
}
