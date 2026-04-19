// Vercel Edge Function — 페트로넷 스크래퍼
// Edge Runtime: 한국 노드에서 실행 → petronet.co.kr 접근 가능
export const config = { runtime: "edge" };

export default async function handler(req) {
  try {
    const response = await fetch("https://www.petronet.co.kr/v4/main.jsp", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        "Referer": "https://www.petronet.co.kr/",
      },
      signal: AbortSignal.timeout(9000),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Petronet upstream error" }), { status: response.status });
    }

    const html = await response.text();

    const getChartSection = (name) => {
      const start = html.indexOf(`const ${name}`);
      if (start === -1) return "";
      const nextConst = html.indexOf("const ", start + name.length + 6);
      return nextConst === -1 ? html.slice(start) : html.slice(start, nextConst);
    };

    const labelToDate = (label) => {
      const parts = label.split(".");
      if (parts.length !== 2) return null;
      const m = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      if (isNaN(m) || isNaN(d)) return null;
      const now = new Date();
      const curMonth = now.getMonth() + 1;
      const year = m > curMonth + 6 ? now.getFullYear() - 1 : now.getFullYear();
      return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    };

    const getDataset = (section, label) => {
      const labelMatch = section.match(/labels\s*:\s*\[([^\]]+)\]/);
      const labels = labelMatch
        ? labelMatch[1].split(",").map(s => s.trim().replace(/['"]/g, ""))
        : [];
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`label\\s*:\\s*["']${escaped}["'][\\s\\S]*?data\\s*:\\s*\\[([^\\]]+)\\]`);
      const m = section.match(re);
      if (!m) return null;
      const rawArr = m[1].split(",").map(v => parseFloat(v.trim()));
      const history = {};
      labels.forEach((lbl, i) => {
        const dateStr = labelToDate(lbl);
        if (dateStr && i < rawArr.length && !isNaN(rawArr[i])) history[dateStr] = rawArr[i];
      });
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

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
