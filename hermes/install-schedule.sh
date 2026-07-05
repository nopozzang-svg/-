#!/bin/bash
# install-schedule.sh — 맥미니에서 일보 수집을 launchd 에 자동 등록.
#
# 두 개의 스케줄을 설치한다:
#   ① 아침 체크 (com.seil.ilbo-morning): 7:00, 8:00, 8:30, 9:00, 그리고 9시부터 10분마다 11:00까지.
#        --morning 으로 실행 → 어제 일보 7개소 도착 확인, 미도착분 수집, 11시까지 안 오면 텔레그램(평일).
#   ② 일반 수집 (com.seil.ilbo-ingest): 매일 13·19·22시. 그날/수정분을 마저 반영(알림 없음).
#
# 사용법 (프로젝트 폴더에서):
#   bash hermes/install-schedule.sh              # 설치/갱신
#   bash hermes/install-schedule.sh --uninstall  # 둘 다 제거
#
# launchd 는 맥미니가 잠들어 예약 시각을 놓쳐도 깨어날 때 실행해준다. 로그: hermes/ingest.log

set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
MORNING_LABEL="com.seil.ilbo-morning"
INGEST_LABEL="com.seil.ilbo-ingest"
MORNING_PLIST="$HOME/Library/LaunchAgents/$MORNING_LABEL.plist"
INGEST_PLIST="$HOME/Library/LaunchAgents/$INGEST_LABEL.plist"

if [ "$1" = "--uninstall" ]; then
  for P in "$MORNING_PLIST" "$INGEST_PLIST"; do
    launchctl unload "$P" 2>/dev/null || true
    rm -f "$P"
  done
  echo "자동 실행 2종 제거 완료"
  exit 0
fi

NODE="$(command -v node)"
[ -z "$NODE" ] && { echo "❌ node 를 찾지 못했습니다. node 가 되는 터미널에서 실행하세요."; exit 1; }
[ -f "$DIR/hermes/.env" ] || { echo "❌ $DIR/hermes/.env 가 없습니다. 먼저 만드세요 (cp hermes/.env.example hermes/.env)."; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents"

# write_plist <plist경로> <label> <extra-arg(빈문자 가능)> <시각들("H:M H:M ...")>
write_plist() {
  local plist="$1" label="$2" arg="$3" times="$4"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "  <key>Label</key><string>$label</string>"
    echo '  <key>ProgramArguments</key><array>'
    echo "    <string>$NODE</string>"
    echo '    <string>--env-file=hermes/.env</string>'
    echo '    <string>hermes/ingest-nas.mjs</string>'
    [ -n "$arg" ] && echo "    <string>$arg</string>"
    echo '  </array>'
    echo "  <key>WorkingDirectory</key><string>$DIR</string>"
    echo "  <key>StandardOutPath</key><string>$DIR/hermes/ingest.log</string>"
    echo "  <key>StandardErrorPath</key><string>$DIR/hermes/ingest.log</string>"
    echo '  <key>StartCalendarInterval</key><array>'
    for t in $times; do
      echo "    <dict><key>Hour</key><integer>${t%:*}</integer><key>Minute</key><integer>${t#*:}</integer></dict>"
    done
    echo '  </array>'
    echo '</dict></plist>'
  } > "$plist"
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
}

# 아침 체크 시각: 7:00 8:00 8:30, 그리고 9:00~11:00 매 10분
MORNING_TIMES="7:0 8:0 8:30"
for h in 9 10; do for m in 0 10 20 30 40 50; do MORNING_TIMES="$MORNING_TIMES $h:$m"; done; done
MORNING_TIMES="$MORNING_TIMES 11:0"

write_plist "$MORNING_PLIST" "$MORNING_LABEL" "--morning" "$MORNING_TIMES"
write_plist "$INGEST_PLIST"  "$INGEST_LABEL"  ""          "13:0 19:0 22:0"

echo "✅ 자동 실행 등록 완료"
echo "   ① 아침 체크(--morning): 7·8·8:30·9~11시(10분 간격) → 미도착 시 11시 텔레그램(평일)"
echo "   ② 일반 수집:            매일 13·19·22시"
echo "   node: $NODE"
echo "   로그: $DIR/hermes/ingest.log"
echo ""
echo "· 로그 보기:      tail -f hermes/ingest.log"
echo "· 아침체크 즉시 실행: launchctl start $MORNING_LABEL"
echo "· 제거:           bash hermes/install-schedule.sh --uninstall"
