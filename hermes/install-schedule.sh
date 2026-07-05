#!/bin/bash
# install-schedule.sh — 맥미니에서 ingest-nas.mjs 를 매일 자동 실행하도록 launchd 에 등록.
#
# 사용법 (프로젝트 폴더에서):
#   bash hermes/install-schedule.sh          # 설치 (기본: 매일 13,19,22시)
#   bash hermes/install-schedule.sh --uninstall   # 제거
#
# launchd 는 맥미니가 잠들어 있어 예약 시각을 놓쳐도 깨어날 때 한 번 실행해준다(cron 보다 안전).
# 로그는 hermes/ingest.log 에 쌓인다.

set -e
LABEL="com.seil.ilbo-ingest"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"   # 프로젝트 루트

if [ "$1" = "--uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "자동 실행 제거 완료: $PLIST"
  exit 0
fi

# node 절대경로 (launchd 는 PATH 가 최소라 절대경로 필요) — 지금 이 터미널의 node 를 사용
NODE="$(command -v node)"
if [ -z "$NODE" ]; then
  echo "❌ node 를 찾지 못했습니다. 이 스크립트는 node 가 되는 터미널에서 실행하세요."
  exit 1
fi

# .env 존재 확인
if [ ! -f "$DIR/hermes/.env" ]; then
  echo "❌ $DIR/hermes/.env 가 없습니다. 먼저 계정을 채워 만드세요 (cp hermes/.env.example hermes/.env)."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--env-file=hermes/.env</string>
    <string>hermes/ingest-nas.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StandardOutPath</key><string>$DIR/hermes/ingest.log</string>
  <key>StandardErrorPath</key><string>$DIR/hermes/ingest.log</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>19</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>22</integer><key>Minute</key><integer>0</integer></dict>
  </array>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ 자동 실행 등록 완료"
echo "   스케줄: 매일 13시 · 19시 · 22시"
echo "   node:   $NODE"
echo "   로그:   $DIR/hermes/ingest.log"
echo ""
echo "· 로그 실시간 보기:   tail -f hermes/ingest.log"
echo "· 지금 즉시 한 번 실행: launchctl start $LABEL"
echo "· 제거:              bash hermes/install-schedule.sh --uninstall"
echo "· 시각 변경: 이 파일의 StartCalendarInterval 수정 후 다시 이 스크립트 실행"
