# 소매 일보 자동 수집 (hermes)

맥미니에서 회사 NAS(시놀로지)의 주유소 마감일보를 자동으로 받아 대시보드(Supabase)에 넣고,
어제 일보가 안 올라온 주유소를 아침에 텔레그램으로 알려주는 시스템.

> **이 문서는 사람과 에이전트(헤르메즈) 모두를 위한 운영 안내서입니다.**
> 사용자가 텔레그램/대화로 "스케줄 바꿔줘" 같은 요청을 하면 아래 "요청별 조치"대로 처리하세요.
> **파일을 고친 뒤에는 반드시 재설치 명령을 실행해야 반영됩니다. 실행 전 사용자에게 "이렇게 바꿀게요" 확인을 받으세요.**

## 무엇이 자동인가
- **자동 수집 5개소**(소장이 NAS 업로드): 통일로일품·남부순환로·박달·안양·광교
- **수동 담당 2개소**(사람이 웹앱에 직접 드롭): 엘앤케이 용인1·김포2 — 자동화는 이들을 저장하지 않음
- 미도착 알림은 **7개소 전부** 대상(엘앤케이는 수동 드롭 리마인더 역할)

## 실행 방식
- macOS `launchd` 가 `hermes/ingest-nas.mjs` 를 정해진 시각에 실행 (에이전트 상시 개입 없음)
- 스케줄 2종:
  - `com.seil.ilbo-morning` : 아침 체크(`--morning`). 미도착 시 11시에 텔레그램(평일만)
  - `com.seil.ilbo-ingest`  : 일반 수집. 늦은 업로드·수정분 반영(알림 없음)

## 주요 파일
| 파일 | 역할 |
|---|---|
| `hermes/ingest-nas.mjs` | 수집·파싱·저장·아침체크·텔레그램 (본체) |
| `hermes/schedule.conf` | **스케줄 시각(사람/에이전트가 고치는 유일한 설정)**. git 미포함, 없으면 `.example`에서 생성 |
| `hermes/install-schedule.sh` | schedule.conf 를 읽어 launchd 에 등록/갱신 |
| `hermes/.env` | NAS 계정·텔레그램 토큰(비밀). git 미포함 |
| `hermes/ingest.log` | 실행 로그 |
| `../src/lib/retailParser.js`, `retailStore.js` | 웹앱과 공유하는 파싱/저장 로직 |

## 요청별 조치 (에이전트용)

### "N시 알림 빼줘" / "알림 시간 바꿔줘"
1. `hermes/schedule.conf` 의 `MORNING_TIMES` 에서 해당 시각 제거/수정
   (예: 8시 제거 → 목록에서 `8:00` 삭제)
2. 적용: `bash hermes/install-schedule.sh`
3. 결과 로그의 "① 아침 체크" 줄에 새 시각이 맞는지 확인 후 사용자에게 보고

### "지금 웹하드 확인해서 새 일보 있으면 반영해줘" / "지금 업데이트해줘"
- `node --env-file=hermes/.env hermes/ingest-nas.mjs`
- 이 한 줄이 NAS 확인 → 새/수정 파일만 다운로드 → 파싱 → 대시보드(Supabase) 반영을 다 한다.
  (웹앱 화면을 조작할 필요 없음. 웹앱은 이 DB를 읽어 보여줄 뿐이라 결과가 바로 반영됨)
- 실행 후 출력의 `완료: 저장 N · 건너뜀 M` 을 사용자에게 그대로 보고. 저장 N>0 이면 그만큼 새로 들어온 것.

### "어제 일보 다 왔는지 확인해줘" (미도착 시 텔레그램)
- `node --env-file=hermes/.env hermes/ingest-nas.mjs --morning`

### "로그 보여줘" / "잘 돌고 있어?"
- `tail -n 40 hermes/ingest.log`

### "코드가 업데이트됐대"
- `git pull` (그 뒤 스케줄 관련 변경이 있었으면 `bash hermes/install-schedule.sh`)

## 주의
- 시각은 24시간제 `시:분`. "8시"가 아침/저녁 어느 쪽인지 애매하면 **사용자에게 되물을 것**.
- `.env`(비밀)와 `schedule.conf`(로컬 설정)는 절대 git 커밋·외부 공유 금지.
- 스케줄 변경은 `install-schedule.sh` 재실행까지 해야 실제 반영됨.
