// Vercel Serverless Function — 페트로넷 스크래퍼
// WTI, 두바이, Brent 원유 가격 + MOPS 국제 제품 가격 파싱
// history 포함 (당월 평균 계산용)
export default async function handler(req, res) {
  try {
    const response = await fetch("https://www.petronet.co.kr/v4/main.jsp", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": "https://www.petronet.co.kr/",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "Petronet upstream error" });
    }

    const html = await response.text();

    // 차트 변수 섹션 추출
    const getChartSection = (name) => {
      const start = html.indexOf(`const ${name}`);
      if (start === -1) return "";
      const nextConst = html.indexOf("const ", start + name.length + 6);
      return nextConst === -1 ? html.slice(start) : html.slice(start, nextConst);
    };

    // 'M.D' 레이블 → 'YYYY-MM-DD' 변환 (현재 연도 기준)
    const labelToDate = (label) => {
      const parts = label.split(".");
      if (parts.length !== 2) return null;
      const m = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      if (isNaN(m) || isNaN(d)) return null;
      const now = new Date();
      const curMonth = now.getMonth() + 1;
      // 레이블 월이 현재 월보다 6개월 이상 크면 작년 데이터
      const year = m > curMonth + 6 ? now.getFullYear() - 1 : now.getFullYear();
      return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    };

    // 데이터셋 레이블로 전체 history + 현재/전일 값 추출
    const getDataset = (section, label) => {
      // 날짜 레이블 배열
      const labelMatch = section.match(/labels\s*:\s*\[([^\]]+)\]/);
      const labels = labelMatch
        ? labelMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
        : [];

      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`label\\s*:\\s*["']${escaped}["'][\\s\\S]*?data\\s*:\\s*\\[([^\\]]+)\\]`);
      const m = section.match(re);
      if (!m) return null;

      // 인덱스 정합성 유지: NaN 필터 전 원본 배열로 labels↔data 매핑
      const rawArr = m[1].split(",").map(v => parseFloat(v.trim()));

      // 날짜 → 값 매핑 (history) — rawArr 인덱스와 labels 인덱스를 동일하게 사용
      const history = {};
      labels.forEach((lbl, i) => {
        const dateStr = labelToDate(lbl);
        if (dateStr && i < rawArr.length && !isNaN(rawArr[i])) history[dateStr] = rawArr[i];
      });

      // current/prev: 마지막 유효(non-NaN) 값 두 개
      const validArr = rawArr.filter(v => !isNaN(v));
      if (validArr.length < 2) return null;
      const current = validArr[validArr.length - 1];
      const prev    = validArr[validArr.length - 2];
      return { current, prev, change: +(current - prev).toFixed(2), history };
    };

    const oilSection  = getChartSection("interOilPriceChartOpt");
    const prodSection = getChartSection("interProdPriceChartOpt");

    const result = {
      wti:          getDataset(oilSection,  "WTI (NYMEX)"),
      dubai:        getDataset(oilSection,  "Dubai"),
      brent:        getDataset(oilSection,  "Brent (ICE)"),
      mopsGasoline: getDataset(prodSection, "휘발유"),
      mopsDiesel:   getDataset(prodSection, "경유"),
      mopsKerosene: getDataset(prodSection, "등유"),
    };

    // CDN 캐시 비활성화 — 프론트엔드 localStorage에서 캐싱 처리
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(result);
  } catch (err) {
    console.error("Petronet proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
