. "$PSScriptRoot\common.ps1"

$pidFile = Get-WslKatagoPidFile
$logFile = Get-WslKatagoLogFile
$port = Get-WslKatagoServerPort

$script = @'
set -euo pipefail
pid_file='__PID_FILE__'
log_file='__LOG_FILE__'
port='__PORT__'

if [ -f "$pid_file" ]; then
  pid="$(cat "$pid_file")"
else
  pid=""
fi

if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "status: running"
  echo "pid: $pid"
else
  echo "status: stopped"
fi

if ss -ltn 2>/dev/null | grep -q ":$port "; then
  echo "port: listening on $port"
else
  echo "port: not listening on $port"
fi

if [ -f "$log_file" ]; then
  echo "log tail:"
  tail -n 20 "$log_file"
fi
'@

$script = $script.Replace("__PID_FILE__", $pidFile)
$script = $script.Replace("__LOG_FILE__", $logFile)
$script = $script.Replace("__PORT__", $port.ToString())

$exitCode = Invoke-WslScript $script
if ($exitCode -ne 0) {
  throw "Status failed with exit code $exitCode."
}
