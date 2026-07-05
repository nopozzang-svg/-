// ingest-nas.mjs — 시놀로지 NAS(웹하드)에서 마감일보를 받아 Supabase에 자동 저장
//
// 맥미니에서 Hermes가 주기적으로 실행하는 스크립트. 웹앱의 드롭 업로드와 **완전히 동일한**
// 파싱/저장 로직(../src/lib/retailParser.js, retailStore.js)을 그대로 재사용한다.
//
// 【NAS 폴더 구조】 (2026-07 기준 실제 확인)
//   /seil_share/주유소 운영 (소매)/
//       ├ 118 남부순환로주유소/  … /XXX 일보/26년 일보/26년7월/*.xls   ← 대상
//       ├ 138 통일로일품주유소/ 통일로 일품주유소 일보/26년 일보/26년7월/세영일품260701.xls
//       ├ 구도일 광교신도시/ · 구도일 박달/ · (구도일)안양/            ← 대상
//       ├ 139두바이 · 140아바타 · 145온산 · 곰돌이 …                  ← 대시보드 대상 아님 → 무시
//       └ (엘앤케이 용인1·김포2)                                      ← 웹앱 수동 드롭 담당 → 무시
//
//   즉 주유소 폴더 안엔 잡폴더(포스자료·관리비·손익·교육…)가 많고, 마감일보는 "…일보" 폴더 밑
//   년/월 로 깊게 중첩돼 있다. 그래서 ① 대상 5개소 폴더만 ② 그 안 "일보" 폴더만 ③ 대상 연도만
//   골라 재귀 수집한다. 주유소는 폴더로 확정되므로 파일명 오인식 위험이 없다.
//
// 【자동화 범위】 소장들이 NAS에 올리는 5개소:
//   통일로일품·남부순환로(세영TMS) · 박달·안양·광교(세일직영)  — 모두 마감일보(magam) 형식
//   엘앤케이(용인1·김포2)는 웹앱 수동 드롭 담당 → 제외.
//
// 실행 (Node 20+):
//   ① 최초 1회 — 시드(baseline): 현재 NAS 파일을 '이미 처리됨'으로 기록만 하고 다운로드·저장 안 함.
//      (대시보드에 이미 들어가 있는 6~7월분을 다시 안 받기 위함)
//        node --env-file=hermes/.env hermes/ingest-nas.mjs --seed
//   ② 이후 일반 실행 — 시드 이후 새로 올라오거나 수정된 파일만 가져와 저장:
//        node --env-file=hermes/.env hermes/ingest-nas.mjs
//   (검증) --test : 주유소별 최신 파일 1개만 받아 파싱값 출력(저장 안 함). 대시보드와 대조용.
//        node --env-file=hermes/.env hermes/ingest-nas.mjs --test
//
// hermes/.env (git 무시됨):
//   NAS_URL=https://seilcorp.synology.me:5001   # 비번 암호화 위해 5001(HTTPS) 권장
//   NAS_USER=아이디
//   NAS_PASS=비번
//   NAS_INSECURE=1                              # (선택) 시놀로지 인증서 TLS 오류 시
//   NAS_ROOT=/seil_share/주유소 운영 (소매)      # (선택) 미설정 시 이 기본값 사용
//   NAS_YEARS=26                                # (선택) 처리할 연도(2자리). 미설정 시 올해만.
//                                               #        백필하려면 예: NAS_YEARS=24,25,26
//   SUPABASE_URL / SUPABASE_ANON_KEY            # (선택) 미설정 시 프론트와 동일한 기본값

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import { STATIONS, parseMagamReport, isLnkWorkbook } from "../src/lib/retailParser.js";
import { saveWorkbookResult } from "../src/lib/retailStore.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROCESSED_FILE = join(HERE, ".processed.json"); // {path: mtime} — 재업로드(mtime 변경) 시 재처리

const MANUAL_ONLY_GROUP = "엘앤케이"; // 용인1·김포2 = 웹앱 수동 드롭 담당 → NAS 자동화 제외

const { NAS_URL, NAS_USER, NAS_PASS, NAS_INSECURE } = process.env;
const NAS_ROOT = process.env.NAS_ROOT || "/seil_share/주유소 운영 (소매)";

// 시드 모드: 현재 파일을 다운로드·저장 없이 '이미 처리됨'으로만 기록 (최초 1회, 기존분 재수집 방지)
const SEED = process.argv.includes("--seed") || process.env.NAS_SEED === "1";
// 테스트 모드: 주유소별 최신 파일 1개만 받아 파싱값 출력 (저장·기록 안 함, 검증용 읽기전용)
const TEST = process.argv.includes("--test");

// 처리 대상 연도(2자리 문자열). 미설정 시 올해만 → 첫 실행 때 과거 수년치 백필 폭탄 방지.
const TARGET_YEARS = new Set(
  (process.env.NAS_YEARS || String(new Date().getFullYear()).slice(-2))
    .split(",").map(s => s.trim()).filter(Boolean)
);

// self-signed 인증서 허용: 시놀로지 기본 인증서가 self-signed 라 https:5001 검증이 실패함.
// 외부 패키지(undici) 없이 되도록 Node 전역 TLS 검증만 끈다(이 단일 목적 스크립트 한정).
if (NAS_INSECURE === "1") process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const fetchOpts = {};

// ── 시놀로지 FileStation API 클라이언트 ──────────────────────────
// 엔드포인트 경로/버전은 SYNO.API.Info 로 동적 조회 (DSM 버전 간 차이 흡수)
async function apiInfo(apis) {
  const url = `${NAS_URL}/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=${apis.join(",")}`;
  const j = await (await fetch(url, fetchOpts)).json();
  if (!j.success) throw new Error("SYNO.API.Info 조회 실패");
  return j.data;
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

// 폴더 1개의 바로 아래 항목(파일+폴더) 목록. mtime 포함.
async function listFolder(info, sid, folderPath) {
  const url = call(info, "SYNO.FileStation.List", "list", {
    folder_path: folderPath, additional: '["time"]',
  }, sid);
  const j = await (await fetch(url, fetchOpts)).json();
  if (!j.success) throw new Error(`목록 조회 실패 (code ${j.error?.code}) — 경로 확인: ${folderPath}`);
  return j.data.files || [];
}

async function download(info, sid, path) {
  const url = call(info, "SYNO.FileStation.Download", "download", { path, mode: "download" }, sid);
  const res = await fetch(url, fetchOpts);
  if (!res.ok) throw new Error(`다운로드 실패 HTTP ${res.status}: ${path}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── 폴더 → 주유소 매핑 / 재귀 수집 ───────────────────────────────
const norm = (s) => String(s).replace(/\s/g, "");

// 최상위 주유소 폴더명 → STATIONS(엘앤케이 제외) 중 alias 로 매칭. 0개/2개 이상이면 null.
function matchTargetStation(folderName) {
  const hay = norm(folderName);
  const m = STATIONS.filter(s => s.group !== MANUAL_ONLY_GROUP && s.aliases.some(a => hay.includes(a)));
  return m.length === 1 ? m[0] : null;
}

// "26년 일보", "26년7월" 처럼 앞이 2자리+년 인 폴더의 연도 추출. 아니면 null(연도 폴더 아님).
function folderYear(name) {
  const m = norm(name).match(/^(\d{2})년/);
  return m ? m[1] : null;
}

// 폴더 하위를 재귀적으로 훑어 엑셀 파일 수집. 연도 폴더는 TARGET_YEARS 만 진입(과거 백필 차단).
async function collectExcelFiles(info, sid, folderPath) {
  let out = [];
  for (const e of await listFolder(info, sid, folderPath)) {
    if (e.isdir) {
      const yr = folderYear(e.name);
      if (yr && !TARGET_YEARS.has(yr)) continue; // 대상 아닌 연도 폴더 가지치기
      out = out.concat(await collectExcelFiles(info, sid, e.path));
    } else if (/\.(xls|xlsx|xlsm)$/i.test(e.name)) {
      out.push(e);
    }
  }
  return out;
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
  for (const [k, v] of Object.entries({ NAS_URL, NAS_USER, NAS_PASS })) {
    if (!v) throw new Error(`환경변수 ${k} 가 비어있음 — hermes/.env 확인`);
  }

  const info = await apiInfo(["SYNO.API.Auth", "SYNO.FileStation.List", "SYNO.FileStation.Download"]);
  const sid = await login(info);
  console.log(`NAS 로그인 성공 · 대상 연도: ${[...TARGET_YEARS].join(",")}년`);

  const alerts = []; // 사람이 봐야 할 것 (파싱 실패 등) — 나중에 카톡·메일로 연결
  try {
    // 1) 대상 5개소 폴더 탐색 → 각 폴더 안 "일보" 하위폴더 → 대상 연도 파일 수집
    const jobs = []; // { station, file }
    for (const top of await listFolder(info, sid, NAS_ROOT)) {
      if (!top.isdir) continue;
      const station = matchTargetStation(top.name);
      if (!station) continue; // 두바이·아바타·온산 등 대상 외 주유소 & 엘앤케이 → 무시

      const ilboDirs = (await listFolder(info, sid, top.path))
        .filter(e => e.isdir && norm(e.name).includes("일보"));
      if (!ilboDirs.length) {
        alerts.push(`⚠️ ${station.name}: "일보" 폴더를 못 찾음 (${top.path}) — 폴더 구조 확인 필요`);
        continue;
      }
      for (const d of ilboDirs) {
        const files = await collectExcelFiles(info, sid, d.path);
        for (const f of files) jobs.push({ station, file: f });
      }
      console.log(`📁 ${station.name}: 대상 파일 ${jobs.filter(j => j.station === station).length}개`);
    }

    // 테스트 모드: 주유소별 최신 파일 1개만 받아 파싱값 출력. 저장·이력기록 안 함(읽기전용 검증).
    if (TEST) {
      const latest = new Map(); // station.name → { file, t }
      for (const { station, file: f } of jobs) {
        const t = f.additional?.time?.mtime ?? 0;
        const cur = latest.get(station.name);
        if (!cur || t > cur.t) latest.set(station.name, { station, file: f, t });
      }
      console.log("\n[테스트] 주유소별 최신 파일 1개 파싱 (저장 안 함):");
      for (const { station, file: f } of latest.values()) {
        try {
          const buf = await download(info, sid, f.path);
          const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
          const p = parseMagamReport(wb);
          const won = (n) => Math.round(n).toLocaleString("ko-KR");
          console.log(`🔎 ${station.name} ← ${f.name}`);
          console.log(`     날짜 ${p.dateStr} · 무연 ${won(p.gas_amt)}원 · 경유 ${won(p.diesel_amt)}원 · 세차 ${won(p.carwash_amt)}원 · 무연재고 ${won(p.gas_inv)}L`);
        } catch (err) {
          console.log(`❌ ${station.name} / ${f.name} — ${err.message}`);
        }
      }
      console.log("\n위 값이 대시보드의 해당 날짜와 일치하면 파싱 정상입니다.");
      return; // logout 은 finally 에서
    }

    const processed = await loadProcessed();

    // 시드 모드: 현재 파일을 '이미 처리됨'으로만 기록(다운로드·저장 안 함).
    // 대시보드에 이미 들어가 있는 기존분을 다시 안 받으려는 최초 1회용.
    if (SEED) {
      let n = 0;
      for (const { file: f } of jobs) {
        const mtime = f.additional?.time?.mtime ?? 0;
        if (processed[f.path] !== mtime) { processed[f.path] = mtime; n++; }
      }
      await saveProcessed(processed);
      console.log(`\n[시드] 현재 파일 ${n}개를 '이미 처리됨'으로 기록 (다운로드·저장 안 함).`);
      console.log("이후 일반 실행 시 새로 올라오거나 수정된 파일만 가져옵니다.");
      return; // logout 은 finally 에서
    }

    // 2) 새 파일만 다운로드·파싱·저장
    let done = 0, skipped = 0;
    for (const { station, file: f } of jobs) {
      const mtime = f.additional?.time?.mtime ?? 0;
      if (processed[f.path] === mtime) { skipped++; continue; } // 이미 처리(변경 없음)

      try {
        const buf = await download(info, sid, f.path);
        const wb = XLSX.read(buf, { type: "buffer", cellDates: false });

        // 방어적: 일보 폴더에 엘앤케이 통합파일이 있을 리 없지만, 있으면 저장 안 함
        if (isLnkWorkbook(wb)) {
          console.log(`⏭️  ${f.name} → 엘앤케이 형식 건너뜀`);
          processed[f.path] = mtime; skipped++; continue;
        }

        // 주유소는 폴더로 이미 확정 → 파일명 자동인식에 의존하지 않고 폴더 기준으로 저장
        const parsed = parseMagamReport(wb);
        await saveWorkbookResult({ type: "magam", station, parsed });
        console.log(`✅ ${station.name} ${parsed.dateStr} ← ${f.name}`);
        processed[f.path] = mtime; done++;
      } catch (err) {
        // 마감일보 형식이 아닌 파일(잡파일)이 섞였거나 파싱 실패 → 사람 확인
        alerts.push(`❌ ${station.name} / ${f.name} — ${err.message}`);
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
