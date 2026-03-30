. "$PSScriptRoot\common.ps1"

$pidFile = Get-WslKatagoPidFile

$script = @'
set -euo pipefail
pid_file='__PID_FILE__'

if [ ! -f "$pid_file" ]; then
  echo "katago-server is not running."
  exit 0
fi

pid="$(cat "$pid_file")"
if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  for _ in $(seq 1 10); do
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done
fi

rm -f "$pid_file"
echo "katago-server stopped."
'@

$script = $script.Replace("__PID_FILE__", $pidFile)

$exitCode = Invoke-WslScript $script
if ($exitCode -ne 0) {
  throw "Stop failed with exit code $exitCode."
}
