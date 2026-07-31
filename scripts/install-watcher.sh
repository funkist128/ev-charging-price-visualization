#!/usr/bin/env bash
# 安裝／更新 launchd 排程：每週一 09:00 檢查台電電價是否調整。
# 可重複執行（會先卸載舊的再裝新的）。移除請執行：scripts/install-watcher.sh --uninstall

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.funkist.taipower-rate-check"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/taipower-rate-check.log"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已移除排程：$LABEL"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents"
chmod +x "$REPO/scripts/watch-taipower-rates.sh"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/scripts/watch-taipower-rates.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"

echo "已安裝排程：$LABEL"
echo "  執行時間：每週一 09:00（電腦當時關機或睡眠的話，開機／喚醒後會補跑）"
echo "  設定檔　：$PLIST"
echo "  紀錄檔　：$LOG"
echo "  立即測試：launchctl kickstart -p gui/$UID/$LABEL"
echo "  移除排程：$REPO/scripts/install-watcher.sh --uninstall"
