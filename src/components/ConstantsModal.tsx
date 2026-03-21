import { useState, useEffect } from "react";
import type { MonthConstants, ProductConstants } from "../types/mops";
import {
  getCurrentMonthConstants,
  getCurrentMonthKey,
  getPrevMonthKey,
  saveMonthConstants,
  getDefaultProducts,
  getAllConstants,
} from "../lib/mopsConstants";

interface Props {
  isOpen:  boolean;
  onClose: () => void;
  onSaved: () => void; // 저장 후 MopsSection 재계산 트리거
}

type ProductKey  = keyof MonthConstants["products"];
type ConstantKey = keyof ProductConstants;

const PRODUCT_LABELS: Record<ProductKey, string> = {
  gasoline: "무연",
  kerosene: "등유",
  diesel:   "경유",
};

const FIELD_META: Record<ConstantKey, { label: string; unit: string; step: string }> = {
  importCharge: { label: "수입부과금", unit: "원/ℓ",  step: "0.01"  },
  tariff:       { label: "관세",       unit: "$/bbl", step: "0.001" },
  tax:          { label: "세금",       unit: "원/ℓ",  step: "0.01"  },
  premium:      { label: "프리미엄",   unit: "$/bbl", step: "0.01"  },
};

function emptyProducts(): MonthConstants["products"] {
  return {
    gasoline: { importCharge: 0, tariff: 0, tax: 0, premium: 0 },
    kerosene: { importCharge: 0, tariff: 0, tax: 0, premium: 0 },
    diesel:   { importCharge: 0, tariff: 0, tax: 0, premium: 0 },
  };
}

export default function ConstantsModal({ isOpen, onClose, onSaved }: Props) {
  const [month,    setMonth]    = useState(getCurrentMonthKey());
  const [products, setProducts] = useState<MonthConstants["products"]>(emptyProducts);
  const [saved,    setSaved]    = useState(false);

  // 모달 열릴 때 현재 월 데이터 로드
  useEffect(() => {
    if (!isOpen) return;
    const key      = getCurrentMonthKey();
    const existing = getCurrentMonthConstants(key);
    setMonth(key);
    setProducts(existing ? structuredClone(existing.products) : getDefaultProducts());
    setSaved(false);
  }, [isOpen]);

  // 기준월 변경 → 해당 월 데이터 로드
  const handleMonthChange = (m: string) => {
    setMonth(m);
    const existing = getCurrentMonthConstants(m);
    setProducts(existing ? structuredClone(existing.products) : getDefaultProducts());
  };

  // 전월 값 불러오기
  const loadPrevMonth = () => {
    const prevKey  = getPrevMonthKey();
    const prev     = getCurrentMonthConstants(prevKey);
    setProducts(prev ? structuredClone(prev.products) : getDefaultProducts());
  };

  // 입력값 변경
  const handleChange = (product: ProductKey, field: ConstantKey, raw: string) => {
    const num = parseFloat(raw);
    setProducts(prev => ({
      ...prev,
      [product]: { ...prev[product], [field]: isNaN(num) ? 0 : num },
    }));
  };

  // 저장
  const handleSave = () => {
    saveMonthConstants({ month, products });
    setSaved(true);
    onSaved();
    setTimeout(() => setSaved(false), 2500);
  };

  if (!isOpen) return null;

  const savedMonths = Object.keys(getAllConstants()).sort();
  const productKeys = Object.keys(PRODUCT_LABELS) as ProductKey[];
  const fieldKeys   = Object.keys(FIELD_META)     as ConstantKey[];

  return (
    <div
      className="cm-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cm-modal">

        {/* ── 헤더 ── */}
        <div className="cm-header">
          <span className="cm-title">⚙ MOPS 상수 설정</span>
          <button className="cm-close" onClick={onClose}>✕</button>
        </div>

        {/* ── 기준월 ── */}
        <div className="cm-month-row">
          <label className="cm-label">기준월</label>
          <input
            type="month"
            value={month}
            onChange={e => handleMonthChange(e.target.value)}
            className="cm-month-input"
          />
          <button className="cm-prev-btn" onClick={loadPrevMonth} title="전월 값 불러오기">
            전월 불러오기
          </button>
        </div>

        {/* 저장된 월 목록 */}
        {savedMonths.length > 0 && (
          <div className="cm-saved-list">
            저장된 월: {savedMonths.map(m => (
              <button
                key={m}
                className={`cm-saved-chip ${m === month ? "cm-saved-chip-active" : ""}`}
                onClick={() => handleMonthChange(m)}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* ── 상수 테이블 ── */}
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead>
              <tr>
                <th className="cm-th cm-th-field">항목</th>
                {productKeys.map(pk => (
                  <th key={pk} className="cm-th">{PRODUCT_LABELS[pk]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fieldKeys.map(ck => {
                const { label, unit, step } = FIELD_META[ck];
                return (
                  <tr key={ck} className="cm-tr">
                    <td className="cm-td cm-td-label">
                      <div className="cm-field-label">{label}</div>
                      <div className="cm-field-unit">{unit}</div>
                    </td>
                    {productKeys.map(pk => (
                      <td key={pk} className="cm-td">
                        <input
                          type="number"
                          step={step}
                          value={products[pk][ck]}
                          onChange={e => handleChange(pk, ck, e.target.value)}
                          className="cm-input"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── 계산식 참고 ── */}
        <div className="cm-formula">
          <span className="cm-formula-label">계산식 </span>
          <span className="cm-formula-text">
            &#123;[(제품가 + 프리미엄 + 관세) ÷ 158.984] × 환율 + 수입부과금 + 세금&#125; × 1.1
          </span>
        </div>

        {/* ── 푸터 ── */}
        <div className="cm-footer">
          <button
            className={`cm-save-btn ${saved ? "cm-save-btn-ok" : ""}`}
            onClick={handleSave}
          >
            {saved ? "✓ 저장 완료!" : "저장"}
          </button>
          <button className="cm-cancel-btn" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
