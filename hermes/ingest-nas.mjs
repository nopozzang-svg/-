// ingest-nas.mjs — 시놀로지 NAS(웹하드)에서 마감일보를 받아 Supabase에 자동 저장
//
// 맥미니에서 Hermes가 주기적으로 실행하는 스크립트. 웹앱의 드롭 업로드와 **완전히 동일한**
// 파싱/저장 로직(../src/lib/retailParser.js, retailStore.js)을 그대로 재사용한다.
//
// 흐름: 로그인 → 폴더 파일목록 → 새 파일만 선별 → 다운로드 → 파싱 → Supabase 저장 → 미처리분 리포트
//
// 실행 (Node 20+):
//   node --env-file=hermes/.env hermes/ingest-nas.mjs
//
// hermes/.env 에 채울 값 (이 파일은 git에 올라가지 않음 — .gitignore 처리됨):
//   NAS_URL=https://seilcorp.synology.me:5001   # 비번 암호화 전송 위해 5001(HTTPS) 권장
//   NAS_USER=아이디
//   NAS_PASS=비번
//   NAS_FOLDER=/일보                             # 소장들이 일보를 올리는 공유폴더 경로 (← 확인 필요)
//   NAS_INSECURE=1                               # (선택) 시놀로지 인증서가 self-signed 라 TLS 오류 나면 설정
//   SUPABASE_URL / SUPABASE_ANON_KEY             # (선택) 미설정 시 프론트와 동일한 기본값 사용

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import { parseWorkbook } from "../src/lib/retailParser.js";
import { saveWorkbookResult } from "../src/lib/retailStore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROCESSED_FILE = join(HERE, ".processed.json"); // {path: mtime} — 재업로드(mtime 변경) 시 재처리

const {
  NAS_URL,
  NAS_USER,
  NAS_PASS,
  NAS_FOLDER,
  NAS_INSECURE,
} = process.env;

// self-signed 인증서 허용 옵션 (undici는 Node에 내장)
let dispatcher;
if (NAS_INSECURE === "1") {
  const { Agent } = await import("undici");
  dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
}
const fetchOpts = dispatcher ? { dispatcher } : {};

// ── 시놀로지 FileStation API 클라이언트 ──────────────────────────
// 엔드포인트 경로/버전은 SYNO.API.Info 로 동적 조회 (DSM 버전 간 차이 흡수)
async function apiInfo(apis) {
  const url = `${NAS_URL}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=${apis.join(",")}`;
  const j = await (await fetch(url, fetchOpts)).json();
  if (!j.success) throw new Error("SYNO.API.Info 조회 실패");
  return j.data; // { "SYNO.FileStation.List": { path, maxVersion }, … }
}

function call(info, api, method, params, sid) {
  const meta = info[api];
  if (!meta) throw new Error(`${api} 미지원 (NAS에서 FileStation 패키지 확인 필요)`);
  const qs = new URLSearchParams({ api, version: String(meta.maxVersion), method, ...params });
  if (sid) qs.set("_sid", sid);
  return `${NAS_URL}/webapi/${meta.path}?${qs.toString()}`;
}

async function login(info) {
  const url = call(info, "SYNO.API.Auth", "login", {
    account: NAS_USER, passwd: NAS_PASS, session: "FileStation", format: "sid",
  });
  const j = await (await fetch(url, fetchOpts)).json();
  if (!j.success) throw new Error(`로그인 실패 (code ${j.error?.code}) — 아이디/비번 확인`);
  return j.data.sid;
}

async function logout(info, sid) {
  const url = call(info, "SYNO.API.Auth", "logout", { session: "FileStation" }, sid);
  await fetch(url, fetchOpts).catch(() => {});
}

async function listFiles(info, sid, folder) {
  const url = call(info, "SYNO.FileStation.List", "list", {
    folder_path: folder, additional: '["time","size"]',
  }, sid);
  const j = await (await fetch(url, fetchOpts)).json();
  if (!j.success) throw new Error(`목록 조회 실패 (code ${j.error?.code}) — 폴더 경로(${folder}) 확인`);
  return j.data.files || [];
}

async function download(info, sid, path) {
  const url = call(info, "SYNO.FileStation.Download", "download", { path, mode: "download" }, sid);
  const res = await fetch(url, fetchOpts);
  if (!res.ok) throw new Error(`다운로드 실패 HTTP ${res.status}: ${path}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── 처리 이력 (중복 다운로드/재처리 방지) ────────────────────────
async function loadProcessed() {
  try { return JSON.parse(await readFile(PROCESSED_FILE, "utf8")); }
  catch { return {}; }
}
async function saveProcessed(map) {
  await mkdir(HERE, { recursive: true });
  await writeFile(PROCESSED_FILE, JSON.stringify(map, null, 2));
}

// ── 메인 ─────────────────────────────────────────────────────────
async function main() {
  for (const [k, v] of Object.entries({ NAS_URL, NAS_USER, NAS_PASS, NAS_FOLDER })) {
    if (!v) throw new Error(`환경변수 ${k} 가 비어있음 — hermes/.env 확인`);
  }

  const info = await apiInfo(["SYNO.API.Auth", "SYNO.FileStation.List", "SYNO.FileStation.Download"]);
  const sid = await login(info);
  console.log("NAS 로그인 성공");

  const alerts = []; // 사람이 봐야 할 것 (파싱 실패 / 주유소 자동인식 실패) — 나중에 카톡·메일로 연결
  try {
    const processed = await loadProcessed();
    const files = (await listFiles(info, sid, NAS_FOLDER))
      .filter(f => !f.isdir && /\.(xls|xlsx|xlsm)$/i.test(f.name));

    console.log(`폴더 파일 ${files.length}개 발견`);
    let done = 0, skipped = 0;

    for (const f of files) {
      const mtime = f.additional?.time?.mtime ?? 0;
      if (processed[f.path] === mtime) { skipped++; continue; } // 이미 처리(변경 없음)

      try {
        const buf = await download(info, sid, f.path);
        const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
        const result = parseWorkbook(wb, f.name);

        if (result.type === "manual") {
          // 주유소 자동인식 실패 → 저장하지 않고 사람에게 넘김 (무인 자동화라 임의 배정 금지)
          alerts.push(`⚠️ 주유소 자동인식 실패: ${f.name} (${result.parsed.dateStr}) — 웹앱에서 수동 지정 필요`);
          continue; // processed 에 기록하지 않음 → 다음 실행 때 재시도
        }

        const dates = await saveWorkbookResult(result);
        const label = result.type === "lnk"
          ? `${result.items.length}건 (${dates[0]}~${dates[dates.length - 1]})`
          : `${result.station.name} ${dates[0]}`;
        console.log(`✅ ${f.name} → ${label}`);
        processed[f.path] = mtime;
        done++;
      } catch (err) {
        alerts.push(`❌ 처리 실패: ${f.name} — ${err.message}`);
      }
    }

    await saveProcessed(processed);
    console.log(`\n완료: 저장 ${done} · 건너뜀 ${skipped} · 알림 ${alerts.length}`);
    if (alerts.length) {
      console.log("\n─── 사람 확인 필요 ───");
      alerts.forEach(a => console.log(a));
      // TODO: 여기서 카톡/메일 발송 (sail-kakao-report 등과 연결)
    }
  } finally {
    await logout(info, sid);
  }
}

main().catch(err => { console.error("치명적 오류:", err.message); process.exit(1); });
