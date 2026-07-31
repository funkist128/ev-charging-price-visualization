#!/usr/bin/env bash
# 定期檢查台電電價是否調整（由 launchd 每週執行，見 scripts/install-watcher.sh）
#
# 台電網站的 WAF 會把境外機房 IP 一律擋成 403，所以這件事只能從台灣的網路跑，
# 不能放在 GitHub Actions 上。
#
# 有異動時：跳 macOS 通知 + 開一張 GitHub issue（順便留下 email 通知與紀錄）。

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$REPO" || exit 1

LABEL="taipower-rates"
STAMP="$(date '+%Y-%m-%d %H:%M')"

notify() {
  osascript -e "display notification \"$2\" with title \"$1\" sound name \"Ping\"" >/dev/null 2>&1 || true
}

OUTPUT="$(node scripts/check-taipower-rates.mjs 2>&1)"
STATUS="$(printf '%s\n' "$OUTPUT" | sed -n 's/^status=//p' | head -1)"
[ -z "$STATUS" ] && STATUS="script-error"

echo "[$STAMP] status=$STATUS"

case "$STATUS" in
  ok)
    exit 0
    ;;

  changed)
    TITLE="台電電價已調整，請更新 rates.js"
    notify "台電電價已調整" "夏月／非夏月費率與 rates.js 不一致，已開 GitHub issue"
    ;;

  *)
    TITLE="台電電價檢查失敗，需人工確認"
    notify "台電電價檢查失敗" "$STATUS — 詳見 ~/Library/Logs/taipower-rate-check.log"
    ;;
esac

# 開 issue（同標題的 open issue 已存在就不重複開）
if ! command -v gh >/dev/null 2>&1; then
  echo "[$STAMP] 找不到 gh，略過開 issue"
  printf '%s\n' "$OUTPUT"
  exit 0
fi

gh label create "$LABEL" --description "台電電價異動監看" --color FBCA04 >/dev/null 2>&1 || true

if gh issue list --state open --label "$LABEL" --json title -q '.[].title' 2>/dev/null | grep -Fxq "$TITLE"; then
  echo "[$STAMP] 已有相同的 open issue，不重複開單"
  exit 0
fi

REPORT="rate-check-report.md"
[ -f "$REPORT" ] || printf '%s\n' "$OUTPUT" > "$REPORT"

if gh issue create \
  --title "$TITLE" \
  --label "$LABEL" \
  --assignee "@me" \
  --body-file "$REPORT" >/dev/null 2>&1; then
  echo "[$STAMP] 已開 issue：$TITLE"
else
  echo "[$STAMP] 開 issue 失敗，報告內容如下"
  printf '%s\n' "$OUTPUT"
fi
