// ============================================================
//  SalesReport.jsx  –  세일 판매 리포트 컴포넌트
//  의존성: xlsx (npm install xlsx)
//  저장소: window.storage (Vercel / Claude 앱 전용 persistent storage)
//          로컬 환경에서는 localStorage fallback 자동 적용
// ============================================================

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";

// ── 상수 ────────────────────────────────────────────────────
const STORAGE_KEY = "sail_records_v2";
const LEARNED_KEY = "sail_learned_v2";

const YUJONG_MAP = {
  고급휘발유: "PG",
  휘발유: "G",
  등유: "K",
  경유: "D",
  화물차우대: "D",
  "공공조달(경유)": "D",
};

const DG_OPTIONS = [
  "01.대리점영업팀",
  "02.극동유화",
  "03.원일유통_중부본부",
  "04.원일유통_현대",
  "06.한화토탈",
  "07.서울석유",
  "09.인천한일탱크",
  "11.지에스이앤알",
  "12.원일유통 영남권",
  "13.마블에너지",
];

const COLS = ["PG", "G", "K", "D"];
const COL_LABELS = { PG: "고급휘발유", G: "휘발유", K: "등유", D: "경유" };

// ── 유틸 ────────────────────────────────────────────────────
const stripNum = (dg) => (dg || "").replace(/^\d+\./, "").trim();

const fmtKL = (v) => (v ? Math.round(v / 1000).toLocaleString() : "-");
const fmtKLint = (v) => (v ? Math.round(v / 1000).toLocaleString() : "-");

function mapDG(maip, teuk, jiyeok, learned, jeoyuso, jeojangso) {
  const m = (maip || "").trim();
  const t = (teuk || "").trim().toLowerCase();
  const yu = (jeoyuso || "").trim();
  const jo = (jeojangso || "").trim();
  if (learned[m]) return learned[m];
  if (m.includes("원일유통")) {
    if (yu.includes("평택한일") || yu.includes("한일평택") || jo.includes("평택한일") || jo.includes("한일평택")) return "원일유통_평택한일";
    if (jiyeok === "영남권") return "12.원일유통 영남권";
    if (t.includes("hd") || t.includes("현대")) return "04.원일유통_현대";
    return "03.원일유통_중부본부";
  }
  if (m.includes("S-OIL") || m.includes("s-oil")) {
    if (t.includes("세일 보관출하") || t.includes("한일")) return "09.인천한일탱크";
    return "01.대리점영업팀";
  }
  if (m.includes("극동유화")) return "02.극동유화";
  if (m.includes("한화토탈")) return "06.한화토탈";
  if (m.includes("서울석유")) return "07.서울석유";
  if (m.includes("마블에너지")) return "13.마블에너지";
  if (m.includes("지에스이앤알") || m.includes("GS이앤알")) return "11.지에스이앤알";
  if (m.includes("인천한일") || m.includes("한일탱크")) return "09.인천한일탱크";
  return null;
}

function findHeaderRow(ws) {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  for (let r = 0; r <= Math.min(range.e.r, 10); r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && String(cell.v).includes("거래일자")) return r;
  }
  return 5;
}

// ── Storage helper (window.storage → localStorage fallback) ─
const Store = {
  async get(key) {
    try {
      if (window.storage) {
        const r = await window.storage.get(key);
        return r ? r.value : null;
      }
    } catch {}
    return localStorage.getItem(key);
  },
  async set(key, val) {
    try {
      if (window.storage) { await window.storage.set(key, val); return; }
    } catch {}
    localStorage.setItem(key, val);
  },
  async del(key) {
    try {
      if (window.storage) { await window.storage.delete(key); return; }
    } catch {}
    localStorage.removeItem(key);
  },
};

// ── 피벗 계산 ────────────────────────────────────────────────
function buildPivot(records) {
  const pivot = {};
  records.forEach(({ dg, jiyeok, yj, qty }) => {
    if (!pivot[dg]) pivot[dg] = { t1: { PG:0,G:0,K:0,D:0 }, t2: { PG:0,G:0,K:0,D:0 } };
    pivot[dg][jiyeok === "수도권" ? "t1" : "t2"][yj] += qty;
  });
  return pivot;
}

// ════════════════════════════════════════════════════════════
//  메인 컴포넌트
// ════════════════════════════════════════════════════════════
export default function SalesReport() {
  const [tab, setTab] = useState("upload");
  const [records, setRecords] = useState([]);
  const [learned, setLearned] = useState({});

  // 미매핑 처리 상태
  const [pendingRows, setPendingRows] = useState([]);
  const [pendingJiyeok, setPendingJiyeok] = useState("");
  const [unmappedQueue, setUnmappedQueue] = useState([]);
  const [unmappedIdx, setUnmappedIdx] = useState(0);
  const [customInput, setCustomInput] = useState("");

  // 필터
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // 드롭존 상태
  const [dzState, setDzState] = useState({ 수도권: "idle", 영남권: "idle" });
  const [dzInfo, setDzInfo] = useState({ 수도권: null, 영남권: null });

  // ── 초기 로드 ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const lRaw = await Store.get(LEARNED_KEY);
      setLearned(lRaw ? JSON.parse(lRaw) : {});

      // 1) 확정 history JSON 로드 (public/sales_history.json)
      let historyRecs = [];
      try {
        const res = await fetch("/sales_history.json");
        if (res.ok) historyRecs = await res.json();
      } catch {}

      // 2) localStorage 당월 업로드 데이터 로드
      const rRaw = await Store.get(STORAGE_KEY);
      const localRecs = rRaw ? JSON.parse(rRaw) : [];

      // 3) 병합: history의 마지막 날짜 이후 localStorage 데이터만 추가
      //    (history와 localStorage 날짜 범위가 겹치면 history 우선)
      const histDates = historyRecs.map((r) => r.date).filter(Boolean).sort();
      const histMax = histDates.length ? histDates[histDates.length - 1] : "";
      const localOnly = localRecs.filter((r) => !histMax || r.date > histMax);
      const merged = [...historyRecs, ...localOnly];

      setRecords(merged);
      if (merged.length) {
        const dates = merged.map((r) => r.date).filter(Boolean).sort();
        setDateFrom(dates[0]);
        setDateTo(dates[dates.length - 1]);
      }
    })();
  }, []);

  // ── 파일 파싱 ──────────────────────────────────────────────
  const parseFile = useCallback(
    (file, jiyeok) => {
      setDzState((s) => ({ ...s, [jiyeok]: "loading" }));
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array", cellDates: false });
          const sheetName = wb.SheetNames.find((n) => n.includes(jiyeok)) ?? wb.SheetNames[0];
          const ws = wb.Sheets[sheetName];
          const range = XLSX.utils.decode_range(ws["!ref"]);

          const unmappedSet = {};
          const rows = [];

          for (let r = 6; r <= range.e.r; r++) {
            const get = (c) => {
              const cell = ws[XLSX.utils.encode_cell({ r, c })];
              return cell ? cell.v : "";
            };
            const qty = parseFloat(get(16)) || 0;
            if (qty <= 0) continue;
            const yj = YUJONG_MAP[(String(get(13)) || "").trim()];
            if (!yj) continue;
            const maip = String(get(5) || "").trim();
            const teuk = String(get(44) || "").trim();
            const jeoyuso = String(get(31) || "").trim();
            const jeojangso = String(get(29) || "").trim();
            const dg = mapDG(maip, teuk, jiyeok, learned, jeoyuso, jeojangso);
            const dv = get(0);
            let ds;
            if (typeof dv === "number") {
              ds = new Date(Math.round((dv - 25569) * 86400 * 1000)).toISOString().substring(0, 10);
            } else {
              ds = String(dv).substring(0, 10);
            }
            if (!dg) {
              if (!unmappedSet[maip]) unmappedSet[maip] = { count: 0, samples: [], teuk };
              unmappedSet[maip].count++;
              if (unmappedSet[maip].samples.length < 3) unmappedSet[maip].samples.push(String(get(7)));
            }
            rows.push({ date: ds, dg, jiyeok, yj, qty, maip, teuk });
          }

          const dates = rows.map((r) => r.date).filter(Boolean).sort();
          setDzState((s) => ({ ...s, [jiyeok]: "done" }));
          setDzInfo((s) => ({
            ...s,
            [jiyeok]: {
              filename: file.name,
              range: dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : "-",
              count: rows.length,
              unmapped: Object.keys(unmappedSet).length,
              uploadedAt: new Date().toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            },
          }));

          const uks = Object.keys(unmappedSet);
          if (uks.length) {
            setPendingRows(rows);
            setPendingJiyeok(jiyeok);
            setUnmappedQueue(uks.map((k) => ({ maip: k, info: unmappedSet[k] })));
            setUnmappedIdx(0);
          } else {
            applyAndSave(rows, jiyeok);
          }
        } catch (err) {
          setDzState((s) => ({ ...s, [jiyeok]: "error" }));
          console.error(err);
        }
      };
      reader.readAsArrayBuffer(file);
    },
    [learned, records]
  );

  // ── 매핑 확정 ──────────────────────────────────────────────
  const confirmMapping = useCallback(
    (dg) => {
      if (!dg) return;
      const item = unmappedQueue[unmappedIdx];
      const newLearned = { ...learned, [item.maip]: dg };
      const updatedRows = pendingRows.map((r) =>
        r.maip === item.maip && !r.dg ? { ...r, dg } : r
      );
      setLearned(newLearned);
      Store.set(LEARNED_KEY, JSON.stringify(newLearned));
      setPendingRows(updatedRows);
      setCustomInput("");

      const nextIdx = unmappedIdx + 1;
      if (nextIdx >= unmappedQueue.length) {
        setUnmappedQueue([]);
        applyAndSave(updatedRows, pendingJiyeok);
      } else {
        setUnmappedIdx(nextIdx);
      }
    },
    [unmappedQueue, unmappedIdx, learned, pendingRows, pendingJiyeok]
  );

  const skipOne = () => {
    const next = unmappedIdx + 1;
    if (next >= unmappedQueue.length) { setUnmappedQueue([]); applyAndSave(pendingRows, pendingJiyeok); }
    else setUnmappedIdx(next);
  };

  const skipAll = () => { setUnmappedQueue([]); applyAndSave(pendingRows, pendingJiyeok); };

  // ── 저장 ───────────────────────────────────────────────────
  const applyAndSave = async (rows, jiyeok) => {
    const valid = rows.filter((r) => r.dg);
    const uploadedDates = valid.map((r) => r.date).filter(Boolean).sort();
    const minDate = uploadedDates[0];
    const maxDate = uploadedDates[uploadedDates.length - 1];

    // localStorage에는 당월(history에 없는) 데이터만 저장
    // history의 날짜 범위를 가져와서 그 이후 데이터만 localStorage에 보관
    let histMax = "";
    try {
      const res = await fetch("/sales_history.json");
      if (res.ok) {
        const hist = await res.json();
        const hDates = hist.map((r) => r.date).filter(Boolean).sort();
        histMax = hDates.length ? hDates[hDates.length - 1] : "";
      }
    } catch {}

    // 기존 localStorage에서 해당 지역+날짜범위 제거 후 새 데이터 추가
    const prevRaw = await Store.get(STORAGE_KEY);
    const prevLocal = prevRaw ? JSON.parse(prevRaw) : [];
    const newLocal = [
      ...prevLocal.filter((r) => r.jiyeok !== jiyeok || r.date < minDate || r.date > maxDate),
      ...valid.filter((r) => !histMax || r.date > histMax),
    ];
    await Store.set(STORAGE_KEY, JSON.stringify(newLocal));

    // 화면: 기존 records에서 해당 지역+날짜범위만 교체 (수도권/영남권 각각 보존)
    const merged = [
      ...records.filter((r) => r.jiyeok !== jiyeok || r.date < minDate || r.date > maxDate),
      ...valid,
    ];
    setRecords(merged);
    const dates = merged.map((r) => r.date).filter(Boolean).sort();
    if (dates.length) { setDateFrom(dates[0]); setDateTo(dates[dates.length - 1]); }
    setTab("report");
  };

  const clearAll = async () => {
    if (!confirm("저장된 데이터를 모두 삭제할까요?")) return;
    setRecords([]);
    setDateFrom(""); setDateTo("");
    await Store.del(STORAGE_KEY);
  };

  const removeLearn = async (key) => {
    const nl = { ...learned };
    delete nl[key];
    setLearned(nl);
    await Store.set(LEARNED_KEY, JSON.stringify(nl));
  };

  // ── 필터된 레코드 ──────────────────────────────────────────
  const filtered = records.filter((r) => {
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    return true;
  });

  // ── 월 목록 ───────────────────────────────────────────────
  const months = [...new Set(records.map((r) => r.date.substring(0, 7)).filter(Boolean))].sort();

  const setMonth = (m) => {
    if (m === "all") {
      const dates = records.map((r) => r.date).filter(Boolean).sort();
      setDateFrom(dates[0] || ""); setDateTo(dates[dates.length - 1] || "");
    } else {
      const [y, mo] = m.split("-");
      const last = new Date(+y, +mo, 0).getDate();
      setDateFrom(`${m}-01`); setDateTo(`${m}-${String(last).padStart(2, "0")}`);
    }
  };

  // ── 피벗 ──────────────────────────────────────────────────
  const pivot = buildPivot(filtered);
  const dgList = DG_OPTIONS.filter((d) => pivot[d]);
  const others = Object.keys(pivot).filter((d) => !DG_OPTIONS.includes(d));
  const allDg = [...dgList, ...others];

  const tot = { t1: { PG:0,G:0,K:0,D:0 }, t2: { PG:0,G:0,K:0,D:0 } };
  allDg.forEach((dg) => COLS.forEach((c) => { tot.t1[c] += pivot[dg]?.t1[c] || 0; tot.t2[c] += pivot[dg]?.t2[c] || 0; }));
  const s1T = COLS.reduce((s, c) => s + tot.t1[c], 0);
  const s2T = COLS.reduce((s, c) => s + tot.t2[c], 0);
  const totalAll = filtered.reduce((s, r) => s + r.qty, 0);
  const byYj = { PG:0, G:0, K:0, D:0 };
  filtered.forEach((r) => { byYj[r.yj] += r.qty; });

  const storageDates = records.map((r) => r.date).filter(Boolean).sort();

  // ── 현재 미매핑 항목 ───────────────────────────────────────
  const currentUnmapped = unmappedQueue[unmappedIdx];

  // ════════════════════════════════════════════════════════
  //  렌더
  // ════════════════════════════════════════════════════════
  return (
    <div style={{ fontFamily: "inherit", padding: "0" }}>

      {/* 탭 */}
      <div style={{ display: "flex", borderBottom: "0.5px solid var(--color-border-tertiary, #e0e0e0)", marginBottom: "1.2rem" }}>
        {["upload", "report"].map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 18px", fontSize: "13px", cursor: "pointer",
              background: "none", border: "none",
              borderBottom: tab === t ? "2px solid currentColor" : "2px solid transparent",
              color: tab === t ? "var(--color-text-primary, #111)" : "var(--color-text-secondary, #888)",
              fontWeight: tab === t ? 500 : 400, marginBottom: "-1px",
            }}
          >
            {i === 0 ? "업로드" : "판매 리포트"}
          </button>
        ))}
      </div>

      {/* ── 업로드 탭 ── */}
      {tab === "upload" && (
        <div>
          {/* 저장 현황 */}
          <div style={{ background: "var(--color-background-secondary,#f5f5f5)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: "1rem" }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>저장된 데이터</span>
            {records.length ? (
              <>
                <span style={badgeStyle("ok")}>{records.length.toLocaleString()}건</span>
                <span style={badgeStyle("gray")}>{storageDates[0]} ~ {storageDates[storageDates.length - 1]}</span>
                <button onClick={clearAll} style={{ marginLeft: "auto", fontSize: 11, color: "#999", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>전체 삭제</button>
              </>
            ) : <span style={badgeStyle("gray")}>없음</span>}
          </div>

          {/* 드롭존 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: "1rem" }}>
            {["수도권", "영남권"].map((jiyeok, i) => (
              <DropZone
                key={jiyeok}
                jiyeok={jiyeok}
                state={dzState[jiyeok]}
                info={dzInfo[jiyeok]}
                inputId={`fi${i + 1}`}
                onFile={(f) => parseFile(f, jiyeok)}
              />
            ))}
          </div>

          {/* 미매핑 질문 */}
          {unmappedQueue.length > 0 && currentUnmapped && (
            <div style={{ border: "1px solid #BA7517", borderRadius: 12, overflow: "hidden", marginBottom: "1rem" }}>
              <div style={{ background: "var(--color-background-warning,#fdf3e3)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                <span>❓</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-warning,#854F0B)", flex: 1 }}>분류가 필요한 매입처가 있습니다</span>
                <span style={{ fontSize: 11, color: "var(--color-text-warning,#854F0B)" }}>{unmappedIdx + 1} / {unmappedQueue.length}</span>
              </div>
              <div style={{ padding: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 4px" }}>「{currentUnmapped.maip}」의 대구분을 선택해주세요</p>
                <p style={{ fontSize: 11, color: "#888", margin: "0 0 12px" }}>
                  거래 건수: {currentUnmapped.info.count}건
                  {currentUnmapped.info.samples.length > 0 && ` · 매출처 예시: ${currentUnmapped.info.samples.join(", ")}`}
                  {currentUnmapped.info.teuk && ` · 특이사항: ${currentUnmapped.info.teuk}`}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                  {DG_OPTIONS.map((d) => (
                    <button key={d} onClick={() => confirmMapping(d)}
                      style={{ padding: "5px 10px", border: "0.5px solid var(--color-border-secondary,#ddd)", borderRadius: 6, background: "var(--color-background-primary,#fff)", color: "var(--color-text-primary,#111)", fontSize: 12, cursor: "pointer" }}
                      onMouseEnter={(e) => { e.target.style.background = "var(--color-background-info,#e6f1fb)"; e.target.style.color = "var(--color-text-info,#185FA5)"; }}
                      onMouseLeave={(e) => { e.target.style.background = "var(--color-background-primary,#fff)"; e.target.style.color = "var(--color-text-primary,#111)"; }}
                    >
                      {stripNum(d)}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                  <input value={customInput} onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="직접 입력 (예: 신규거래처명)"
                    style={{ flex: 1, padding: "6px 10px", fontSize: 12, border: "0.5px solid var(--color-border-secondary,#ddd)", borderRadius: 6, background: "var(--color-background-primary,#fff)", color: "var(--color-text-primary,#111)" }}
                  />
                  <button onClick={() => confirmMapping(customInput)}
                    style={{ padding: "6px 12px", fontSize: 12, border: "0.5px solid var(--color-border-secondary,#ddd)", borderRadius: 6, background: "var(--color-background-primary,#fff)", cursor: "pointer" }}>
                    추가
                  </button>
                </div>
                <div style={{ display: "flex", gap: 14 }}>
                  <button onClick={skipOne} style={{ fontSize: 11, color: "#aaa", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>이번만 제외</button>
                  <button onClick={skipAll} style={{ fontSize: 11, color: "#aaa", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>모두 제외하고 저장</button>
                </div>
              </div>
            </div>
          )}

          {/* 학습된 매핑 */}
          {Object.keys(learned).length > 0 && (
            <div style={{ marginTop: ".5rem" }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "#888", marginBottom: 6 }}>학습된 매핑 ({Object.keys(learned).length}개)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {Object.entries(learned).map(([k, v]) => (
                  <span key={k} style={{ fontSize: 11, padding: "3px 8px", background: "var(--color-background-secondary,#f5f5f5)", borderRadius: 10, color: "#888" }}>
                    {k} → {stripNum(v)}{" "}
                    <span onClick={() => removeLearn(k)} style={{ cursor: "pointer", color: "#ccc" }}>✕</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 리포트 탭 ── */}
      {tab === "report" && (
        <div>
          {/* 저장 현황 */}
          <div style={{ background: "var(--color-background-secondary,#f5f5f5)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: "1rem" }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>저장된 데이터</span>
            {records.length ? (
              <><span style={badgeStyle("ok")}>{records.length.toLocaleString()}건</span><span style={badgeStyle("gray")}>{storageDates[0]} ~ {storageDates[storageDates.length - 1]}</span></>
            ) : <span style={badgeStyle("gray")}>없음</span>}
          </div>

          {records.length === 0 ? (
            <div style={{ padding: "3rem", textAlign: "center", color: "#aaa", fontSize: 13 }}>
              저장된 데이터가 없습니다. 업로드 탭에서 파일을 올려주세요.
            </div>
          ) : (
            <>
              {/* 기간 필터 */}
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: "#888", marginBottom: 6 }}>기간 선택</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                    style={{ fontSize: 12, padding: "5px 8px", border: "0.5px solid var(--color-border-secondary,#ddd)", borderRadius: 6, background: "var(--color-background-primary,#fff)", color: "var(--color-text-primary,#111)" }} />
                  <span style={{ fontSize: 12, color: "#888" }}>~</span>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                    style={{ fontSize: 12, padding: "5px 8px", border: "0.5px solid var(--color-border-secondary,#ddd)", borderRadius: 6, background: "var(--color-background-primary,#fff)", color: "var(--color-text-primary,#111)" }} />
                  <span style={{ fontSize: 11, color: "#aaa" }}>({filtered.length.toLocaleString()}건)</span>
                </div>
                {/* 월 칩 */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  <button onClick={() => setMonth("all")} style={chipStyle(dateFrom === storageDates[0] && dateTo === storageDates[storageDates.length - 1])}>전체</button>
                  {months.map((m) => {
                    const [y, mo] = m.split("-");
                    const last = new Date(+y, +mo, 0).getDate();
                    const isActive = dateFrom === `${m}-01` && dateTo === `${m}-${String(last).padStart(2, "0")}`;
                    return <button key={m} onClick={() => setMonth(m)} style={chipStyle(isActive)}>{m.replace("-", "년 ")}월</button>;
                  })}
                </div>
              </div>

              {/* 요약 카드 */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 8, marginBottom: "1.2rem" }}>
                {[{ label: "총 판매량", val: Math.round(totalAll / 1000).toLocaleString(), unit: "kL" },
                  ...COLS.map((c) => ({ label: COL_LABELS[c], val: Math.round((byYj[c] || 0) / 1000).toLocaleString(), unit: "kL" }))
                ].map(({ label, val, unit }) => (
                  <div key={label} style={{ background: "var(--color-background-secondary,#f5f5f5)", borderRadius: 8, padding: ".8rem", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 500 }}>{val}<span style={{ fontSize: 11, fontWeight: 400, color: "#888" }}> {unit}</span></div>
                  </div>
                ))}
              </div>

              {/* 피벗 테이블 */}
              <div style={{ overflowX: "auto", border: "0.5px solid var(--color-border-tertiary,#eee)", borderRadius: 12 }}>
                <div style={{ padding: "6px 10px", fontSize: 11, color: "#aaa", borderBottom: "0.5px solid var(--color-border-tertiary,#eee)" }}>단위: kL (소수점 1자리)</div>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, fontSize: 12 }}>
                  <thead>
                    <tr>
                      <Th rowSpan={2} align="left" style={{ borderBottom: "0.5px solid var(--color-border-secondary,#ddd)", verticalAlign: "bottom" }}>대구분</Th>
                      <Th colSpan={5} style={{ textAlign: "center", borderLeft: "0.5px solid var(--color-border-secondary,#ddd)", borderBottom: "0.5px solid var(--color-border-tertiary,#eee)" }}>영업1팀 (수도권)</Th>
                      <Th colSpan={5} style={{ textAlign: "center", borderLeft: "0.5px solid var(--color-border-secondary,#ddd)", borderBottom: "0.5px solid var(--color-border-tertiary,#eee)" }}>영업2팀 (영남권)</Th>
                      <Th rowSpan={2} style={{ borderLeft: "0.5px solid var(--color-border-secondary,#ddd)", borderBottom: "0.5px solid var(--color-border-secondary,#ddd)", verticalAlign: "bottom" }}>총계</Th>
                    </tr>
                    <tr>
                      {["PG","G","K","D","계"].map((c, i) => <Th key={`t1${c}`} style={{ borderBottom: "0.5px solid var(--color-border-secondary,#ddd)", ...(i===0 ? {borderLeft:"0.5px solid var(--color-border-secondary,#ddd)"} : {}) }}>{c}</Th>)}
                      {["PG","G","K","D","계"].map((c, i) => <Th key={`t2${c}`} style={{ borderBottom: "0.5px solid var(--color-border-secondary,#ddd)", ...(i===0 ? {borderLeft:"0.5px solid var(--color-border-secondary,#ddd)"} : {}) }}>{c}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {allDg.map((dg) => {
                      const t1 = pivot[dg].t1, t2 = pivot[dg].t2;
                      const s1 = COLS.reduce((s,c)=>s+(t1[c]||0),0);
                      const s2 = COLS.reduce((s,c)=>s+(t2[c]||0),0);
                      return (
                        <tr key={dg}>
                          <Td align="left">{stripNum(dg)}</Td>
                          {COLS.map((c,i)=><Td key={c} style={i===0?{borderLeft:"0.5px solid var(--color-border-secondary,#ddd)"}:{}}>{fmtKL(t1[c])}</Td>)}
                          <Td style={{ borderLeft:"0.5px solid var(--color-border-secondary,#ddd)", fontWeight:500 }}>{fmtKL(s1)}</Td>
                          {COLS.map((c,i)=><Td key={c} style={i===0?{borderLeft:"0.5px solid var(--color-border-secondary,#ddd)"}:{}}>{fmtKL(t2[c])}</Td>)}
                          <Td style={{ borderLeft:"0.5px solid var(--color-border-secondary,#ddd)", fontWeight:500 }}>{fmtKL(s2)}</Td>
                          <Td style={{ borderLeft:"0.5px solid var(--color-border-secondary,#ddd)", fontWeight:500, fontSize:13 }}>{fmtKLint(s1+s2)}</Td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "var(--color-background-secondary,#f5f5f5)" }}>
                      <Td align="left" style={{ fontWeight:500 }}>총합계</Td>
                      {COLS.map((c,i)=><Td key={c} style={{ fontWeight:500, ...(i===0?{borderLeft:"0.5px solid var(--color-border-secondary,#ddd)"}:{}) }}>{fmtKL(tot.t1[c])}</Td>)}
                      <Td style={{ fontWeight:500, borderLeft:"0.5px solid var(--color-border-secondary,#ddd)" }}>{fmtKL(s1T)}</Td>
                      {COLS.map((c,i)=><Td key={c} style={{ fontWeight:500, ...(i===0?{borderLeft:"0.5px solid var(--color-border-secondary,#ddd)"}:{}) }}>{fmtKL(tot.t2[c])}</Td>)}
                      <Td style={{ fontWeight:500, borderLeft:"0.5px solid var(--color-border-secondary,#ddd)" }}>{fmtKL(s2T)}</Td>
                      <Td style={{ fontWeight:500, borderLeft:"0.5px solid var(--color-border-secondary,#ddd)", fontSize:13 }}>{fmtKLint(s1T+s2T)}</Td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── 서브 컴포넌트 ────────────────────────────────────────────
function DropZone({ jiyeok, state, info, inputId, onFile }) {
  const [drag, setDrag] = useState(false);
  const isLoaded = state === "done";

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 500, color: "#888", marginBottom: 5 }}>{jiyeok} (도매팀 {jiyeok === "수도권" ? "서울" : "영남"})</div>
      <div
        onClick={() => document.getElementById(inputId).click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}
        style={{
          border: `1.5px ${isLoaded ? "solid" : "dashed"} ${drag ? "var(--color-border-primary,#555)" : isLoaded ? "#3B6D11" : "var(--color-border-secondary,#ddd)"}`,
          borderRadius: 10, padding: "1rem", textAlign: "center", cursor: "pointer",
          background: isLoaded ? "var(--color-background-success,#eaf3de)" : "transparent",
          transition: "border-color .15s",
        }}
      >
        {state === "loading" ? (
          <div style={{ fontSize: 11, color: "#888" }}>⏳ 처리 중...</div>
        ) : state === "error" ? (
          <div style={{ fontSize: 11, color: "#ef4444" }}>❌ 파일 파싱 실패. 형식을 확인해주세요.</div>
        ) : isLoaded && info ? (
          <>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#3B6D11", marginBottom: 2 }}>{info.filename}</div>
            <div style={{ fontSize: 11, color: "#3B6D11", marginBottom: 1 }}>{info.range}</div>
            <div style={{ fontSize: 11, color: "#6B9B3A", marginBottom: 4 }}>{info.uploadedAt} 업로드</div>
            <span style={badgeStyle("ok")}>{info.count.toLocaleString()}건</span>
            {info.unmapped > 0 && <span style={{ ...badgeStyle("warn"), marginLeft: 4 }}>미매핑 {info.unmapped}종</span>}
          </>
        ) : (
          <>
            <div style={{ fontSize: 20, marginBottom: 4 }}>📂</div>
            <div style={{ fontSize: 12, color: "#888" }}>ERP xls 드롭 또는 클릭</div>
            <div style={{ fontSize: 11, color: "#bbb", marginTop: 2 }}>전체 기간 파일 1개</div>
          </>
        )}
      </div>
      <input id={inputId} type="file" accept=".xls,.xlsx" style={{ display: "none" }} onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
    </div>
  );
}

const Th = ({ children, align = "right", colSpan, rowSpan, style = {} }) => (
  <th colSpan={colSpan} rowSpan={rowSpan}
    style={{ padding: "6px 8px", fontWeight: 500, color: "var(--color-text-secondary,#888)", background: "var(--color-background-secondary,#f5f5f5)", textAlign: align, whiteSpace: "nowrap", ...style }}>
    {children}
  </th>
);

const Td = ({ children, align = "right", style = {} }) => (
  <td style={{ padding: "6px 8px", textAlign: align, borderBottom: "0.5px solid var(--color-border-tertiary,#eee)", color: "var(--color-text-primary,#111)", ...style }}>
    {children}
  </td>
);

const badgeStyle = (type) => {
  const map = {
    ok: { background: "var(--color-background-success,#eaf3de)", color: "var(--color-text-success,#3B6D11)" },
    warn: { background: "var(--color-background-warning,#fdf3e3)", color: "var(--color-text-warning,#854F0B)" },
    gray: { background: "var(--color-background-secondary,#f5f5f5)", color: "var(--color-text-secondary,#888)" },
  };
  return { fontSize: 11, padding: "2px 8px", borderRadius: 10, display: "inline-block", ...map[type] };
};

const chipStyle = (active) => ({
  fontSize: 11, padding: "3px 8px",
  border: "0.5px solid var(--color-border-secondary,#ddd)",
  borderRadius: 10, cursor: "pointer",
  background: active ? "var(--color-text-primary,#111)" : "var(--color-background-primary,#fff)",
  color: active ? "var(--color-background-primary,#fff)" : "var(--color-text-secondary,#888)",
});
