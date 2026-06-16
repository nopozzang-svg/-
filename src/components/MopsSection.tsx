import { useMemo, useState } from "react";
import {
  extractActualMonthlyValues,
  getRemainingWeekdays,
  calculateProductSummary,
  calculateMopsPrice,
} from "../lib/mopsCalculations";
import {
  getAllConstants,
  getCurrentMonthConstants,
  getCurrentMonthKey,
} from "../lib/mopsConstants";
import type { MopsAllProducts, MopsResult } from "../types/mops";

const INTL_HISTORY_KEY = "sail_intl_history";

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

function fmt(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("ko-KR") + "원";
}

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

  const availableMonths = useMemo(() => {
    const allConsts = getAllConstants();
    return Object.keys(allConsts).sort().reverse();
  }, []);

  const isCurrentMonth = selectedMonth === currentMonthKey;

  const { year: todayYear, month: todayMonth, today, todayStr } = useMemo(() => {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return {
      year:     kst.getUTCFullYear(),
      month:    kst.getUTCMonth(),
      today:    kst.getUTCDate(),
      todayStr: kst.toISOString().substring(0, 10),
    };
  }, []);

  const remainingWeekdays = getRemainingWeekdays(todayYear, todayMonth, today);

  const [selYear, selMonthIdx] = useMemo(() => {
    const parts = selectedMonth.split("-").map(Number);
    return [parts[0], parts[1] - 1];
  }, [selectedMonth]);

  const constants = getCurrentMonthConstants(selectedMonth);

  const results = useMemo((): MopsAllProducts | null => {
    if (!constants) return null;

    let history: Record<string, Record<string, number>> = {};
    try {
      history = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}");
    } catch { /* ignore */ }

    const selRemaining = isCurrentMonth ? remainingWeekdays : 0;
    const dailyExch = isCurrentMonth ? (intlData?.exch?.current ?? null) : null;
    const exchValues = extractActualMonthlyValues(history, "exch", selYear, selMonthIdx);

    const compute = (
      productField: string,
      dailyValue:   number | null | undefined,
      productKey:   keyof typeof constants.products
    ): MopsResult => {
      return calculateProductSummary({
        dailyProductPrice:    isCurrentMonth ? (dailyValue ?? null) : null,
        dailyExchangeRate:    dailyExch,
        monthlyProductValues: extractActualMonthlyValues(history, productField, selYear, selMonthIdx),
        monthlyExchValues:    exchValues,
        remainingWeekdays:    selRemaining,
        constants:            constants.products[productKey],
      });
    };

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

  // ── 메시지 생성 상태 ──
  const [msgDate, setMsgDate] = useState(todayStr);
  const [unconfirmedPrev, setUnconfirmedPrev] = useState(false);
  const [msgText, setMsgText] = useState("");
  const [copyDone, setCopyDone] = useState(false);

  const buildMessage = () => {
    let history: Record<string, Record<string, number>> = {};
    try { history = JSON.parse(localStorage.getItem(INTL_HISTORY_KEY) || "{}"); } catch {}

    const parts = msgDate.split("-").map(Number);
    const yr = parts[0], mo = parts[1], dy = parts[2];
    const moIdx = mo - 1;
    const targetMonthKey = msgDate.substring(0, 7);

    const allConsts = getAllConstants();
    const targetConst = allConsts[targetMonthKey];
    if (!targetConst) {
      setMsgText(`⚠ ${targetMonthKey} 상수가 없습니다. 상수 설정에서 입력해 주세요.`);
      return;
    }
    const c = targetConst.products;

    const isToday = msgDate === todayStr;

    // 일별(D) 값 — 오늘이면 live intlData, 과거면 history
    const dailyMopsGas  = isToday ? (intlData?.petro?.mopsGasoline?.current ?? null) : (history[msgDate]?.mopsGas    ?? null);
    const dailyMopsKero = isToday ? (intlData?.petro?.mopsKerosene?.current  ?? null) : (history[msgDate]?.mopsKero   ?? null);
    const dailyMopsDsl  = isToday ? (intlData?.petro?.mopsDiesel?.current    ?? null) : (history[msgDate]?.mopsDiesel ?? null);
    const dailyExch     = isToday ? (intlData?.exch?.current                 ?? null) : (history[msgDate]?.exch       ?? null);

    // 선택 날짜 이전 당월 평일 항목 (weekday, 당월, msgDate 미만)
    const beforeEntries = Object.entries(history)
      .filter(([date]) => {
        if (date >= msgDate) return false;
        const d = new Date(date + "T12:00:00Z");
        const dow = d.getDay();
        return d.getFullYear() === yr && d.getMonth() === moIdx && dow !== 0 && dow !== 6;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const avgOf = (field: string): number | null => {
      const vals = beforeEntries
        .map(([, v]) => v[field])
        .filter((v): v is number => v != null && !isNaN(v));
      if (!vals.length) return null;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };

    const avgMopsGas  = avgOf("mopsGas");
    const avgMopsKero = avgOf("mopsKero");
    const avgMopsDsl  = avgOf("mopsDiesel");
    const avgExch     = avgOf("exch");

    // 선택일 이후 남은 평일 수
    const lastDay = new Date(yr, moIdx + 1, 0).getDate();
    let remaining = 0;
    for (let d = dy + 1; d <= lastDay; d++) {
      const dow = new Date(yr, moIdx, d).getDay();
      if (dow !== 0 && dow !== 6) remaining++;
    }

    // 말일 추정: 이전 실적 합 + 오늘값 × 남은평일 / (이전count + 남은평일)
    const projOf = (vals: number[], todayVal: number | null): number | null => {
      if (todayVal == null) return null;
      const count = vals.length + remaining;
      if (count === 0) return todayVal;
      return (vals.reduce((s, v) => s + v, 0) + todayVal * remaining) / count;
    };

    const beforeGasVals  = beforeEntries.map(([, v]) => v["mopsGas"]).filter((v): v is number => v != null && !isNaN(v));
    const beforeKeroVals = beforeEntries.map(([, v]) => v["mopsKero"]).filter((v): v is number => v != null && !isNaN(v));
    const beforeDslVals  = beforeEntries.map(([, v]) => v["mopsDiesel"]).filter((v): v is number => v != null && !isNaN(v));
    const beforeExchVals = beforeEntries.map(([, v]) => v["exch"]).filter((v): v is number => v != null && !isNaN(v));

    const projMopsGas  = projOf(beforeGasVals,  dailyMopsGas);
    const projMopsKero = projOf(beforeKeroVals, dailyMopsKero);
    const projMopsDsl  = projOf(beforeDslVals,  dailyMopsDsl);
    const projExch     = projOf(beforeExchVals, dailyExch);

    const calcWon = (mops: number | null, exch: number | null, prod: typeof c.gasoline): number | null => {
      if (mops == null || exch == null) return null;
      return calculateMopsPrice({
        productPrice: mops, exchangeRate: exch,
        importCharge: prod.importCharge, tariff: prod.tariff,
        tax: prod.tax, premium: prod.premium,
      });
    };

    // A 섹션 (당월 평균 원화)
    const aGas  = calcWon(avgMopsGas,  avgExch, c.gasoline);
    const aKero = calcWon(avgMopsKero, avgExch, c.kerosene);
    const aDsl  = calcWon(avgMopsDsl,  avgExch, c.diesel);

    // D 섹션 (데일리 원화)
    const dGas  = calcWon(dailyMopsGas,  dailyExch, c.gasoline);
    const dKero = calcWon(dailyMopsKero, dailyExch, c.kerosene);
    const dDsl  = calcWon(dailyMopsDsl,  dailyExch, c.diesel);

    // 말일 추정 원화
    const pGas  = calcWon(projMopsGas,  projExch, c.gasoline);
    const pKero = calcWon(projMopsKero, projExch, c.kerosene);
    const pDsl  = calcWon(projMopsDsl,  projExch, c.diesel);

    const fmtWon = (v: number | null) => v == null ? "—" : Math.round(v).toLocaleString("ko-KR");
    const fmtDlr = (v: number | null) => v == null ? "—" : `$${v.toFixed(1)}`;
    const fmtExch = (v: number | null) => {
      if (v == null) return "—";
      return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const lines: string[] = [];
    if (unconfirmedPrev) lines.push(`※ ${mo}월 프리미엄 미확정`);
    lines.push(`    G ${c.gasoline.premium}  K ${c.kerosene.premium}  D ${c.diesel.premium}`);
    lines.push(`${mo}월 ${dy}일`);
    lines.push(`A(${fmtExch(avgExch)})`);
    lines.push(`${fmtWon(aGas)} / ${fmtWon(aKero)} / ${fmtWon(aDsl)}`);
    lines.push(`(${fmtDlr(avgMopsGas)})  (${fmtDlr(avgMopsKero)})  (${fmtDlr(avgMopsDsl)})`);
    lines.push("");
    lines.push(`D(${fmtExch(dailyExch)})`);
    lines.push(`${fmtWon(dGas)} / ${fmtWon(dKero)} / ${fmtWon(dDsl)}`);
    lines.push(`(${fmtDlr(dailyMopsGas)})  (${fmtDlr(dailyMopsKero)})  (${fmtDlr(dailyMopsDsl)})`);
    lines.push("");
    lines.push("* 말일 추정");
    lines.push(`${fmtWon(pGas)} / ${fmtWon(pKero)} / ${fmtWon(pDsl)}`);

    setMsgText(lines.join("\n"));
  };

  const handleCopy = async () => {
    if (!msgText) return;
    try {
      await navigator.clipboard.writeText(msgText);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    } catch {}
  };

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

      {/* ── 월초 배너 ── */}
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
              <tr className="mops-tr">
                <td className="mops-td mops-td-fuel">
                  {isCurrentMonth ? "당월 평균" : "월 평균"}<br />
                  <span className="mops-th-sub">실적 기준</span>
                </td>
                <td className="mops-td">{fmt(gas.monthlyAverage)}</td>
                <td className="mops-td">{fmt(dsl.monthlyAverage)}</td>
                <td className="mops-td">{fmt(kero.monthlyAverage)}</td>
              </tr>
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

          <div className="mops-formula-note">
            {"[(제품가 + 프리미엄 + 관세) ÷ 158.984] × 환율 + 수입부과금 + 세금"} × 1.1
          </div>
        </div>
      )}

      {/* ── 카카오톡 메시지 생성 ── */}
      <div className="mops-msg-section">
        <div className="mops-msg-header">카카오톡 메시지 생성</div>
        <div className="mops-msg-controls">
          <input
            type="date"
            className="mops-msg-date"
            value={msgDate}
            max={todayStr}
            onChange={e => { setMsgDate(e.target.value); setMsgText(""); }}
          />
          <label className="mops-msg-check">
            <input
              type="checkbox"
              checked={unconfirmedPrev}
              onChange={e => setUnconfirmedPrev(e.target.checked)}
            />
            전월 프리미엄 미확정
          </label>
          <button className="mops-msg-btn" onClick={buildMessage}>
            메시지 생성
          </button>
        </div>
        {msgText && (
          <div className="mops-msg-output">
            <textarea
              className="mops-msg-textarea"
              value={msgText}
              readOnly
              rows={13}
            />
            <div className="mops-msg-copy-row">
              <button
                className={`mops-msg-copy${copyDone ? " mops-msg-copy-done" : ""}`}
                onClick={handleCopy}
              >
                {copyDone ? "✓ 복사됨" : "복사"}
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
