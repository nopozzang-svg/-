-- POS 수신 원문 보관 테이블 (우주포스 → /api/pos-receive)
-- [용도] 우주포스가 실제로 보내는 JSON을 형식 그대로 저장해 두는 "임시 수신함".
--        실제 전송 포맷 확인 후, 이 데이터를 daily_station_report(정본)로 매핑한다.
-- 실행: Supabase 대시보드 → SQL Editor 에 붙여넣고 Run 한 번.
--   (Supabase에서 SQL로 만든 테이블은 기본 RLS 비활성 → 기존 테이블처럼 anon 키로 insert 가능)

create table if not exists public.pos_raw_inbox (
  id            bigint generated always as identity primary key,
  received_at   timestamptz not null default now(),
  source_ip     text,          -- 전송 서버 IP (참고용)
  content_type  text,
  headers       jsonb,         -- 인증키 제외한 안전 헤더만 보관
  payload       jsonb,         -- 파싱된 JSON 원문 (파싱 성공 시)
  raw_text      text           -- 파싱 실패 시 원문 문자열 백업
);

-- 조회 편의용 인덱스 (최근 수신 순)
create index if not exists pos_raw_inbox_received_at_idx
  on public.pos_raw_inbox (received_at desc);
