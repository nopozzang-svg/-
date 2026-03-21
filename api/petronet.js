// Vercel Serverless Function — 페트로넷 스크래퍼
// WTI, 두바이, Brent 원유 가격 + MOPS 국제 제품 가격 파싱
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

    // 데이터셋 레이블로 현재/전일 값 추출
    const getDataset = (section, label) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`label\\s*:\\s*["']${escaped}["'][\\s\\S]*?data\\s*:\\s*\\[([^\\]]+)\\]`);
      const m = section.match(re);
      if (!m) return null;
      const arr = m[1].split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      if (arr.length < 2) return null;
      const current = arr[arr.length - 1];
      const prev = arr[arr.length - 2];
      return { current, prev, change: +(current - prev).toFixed(2) };
    };

    // 날짜 레이블 추출 (가장 최근 날짜)
    const getLatestLabel = (section) => {
      const m = section.match(/labels\s*:\s*\[([^\]]+)\]/);
      if (!m) return null;
      const labels = m[1].split(",").map(s => s.trim().replace(/['"]/g, ""));
      return labels[labels.length - 1];
    };

    const oilSection  = getChartSection("interOilPriceChartOpt");
    const prodSection = getChartSection("interProdPriceChartOpt");

    const result = {
      date:          getLatestLabel(oilSection),
      wti:           getDataset(oilSection,  "WTI (NYMEX)"),
      dubai:         getDataset(oilSection,  "Dubai"),
      brent:         getDataset(oilSection,  "Brent (ICE)"),
      mopsGasoline:  getDataset(prodSection, "휘발유"),
      mopsDiesel:    getDataset(prodSection, "경유"),
      mopsKerosene:  getDataset(prodSection, "등유"),
    };

    // 1시간 캐시 (페트로넷 하루 1~2회 갱신)
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate");
    return res.status(200).json(result);
  } catch (err) {
    console.error("Petronet proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
