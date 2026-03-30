. "$PSScriptRoot\common.ps1"

$repoPath = Get-WslKatagoServerHome
$runtimeDir = Get-WslKatagoRuntimeDir
$pidFile = Get-WslKatagoPidFile
$logFile = Get-WslKatagoLogFile
$launcherPath = Get-WslKatagoLauncherPath
$port = Get-WslKatagoServerPort

$script = @'
set -euo pipefail
repo_path='__REPO_PATH__'
runtime_dir='__RUNTIME_DIR__'
pid_file='__PID_FILE__'
log_file='__LOG_FILE__'
launcher_path='__LAUNCHER_PATH__'
port='__PORT__'

cd "$repo_path"

if [ ! -f ".venv/bin/activate" ]; then
  echo "Missing Python virtualenv. Run bootstrap-katago-server.ps1 first." >&2
  exit 1
fi

if [ ! -x "$runtime_dir/katago" ]; then
  echo "Missing KataGo runtime. Run bootstrap-katago-server.ps1 first." >&2
  exit 1
fi

if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
  echo "katago-server is already running on port $port"
  exit 0
fi

rm -f "$pid_file"
source .venv/bin/activate
export KATAGO_SERVER_HOME="$repo_path"
export KATAGO_RUNTIME_DIR="$runtime_dir"
export KATAGO_SERVER_PORT="$port"

nohup python3 "$launcher_path" > "$log_file" 2>&1 &
echo $! > "$pid_file"

for _ in $(seq 1 60); do
  if grep -q "Running on http://0.0.0.0:$port" "$log_file" 2>/dev/null; then
    echo "katago-server is ready on http://127.0.0.1:$port"
    exit 0
  fi

  if ! kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "katago-server exited during startup." >&2
    tail -n 80 "$log_file" 2>/dev/null || true
    exit 1
  fi

  sleep 1
done

echo "katago-server started, but readiness was not confirmed within 60 seconds."
echo "Check the log at $log_file"
'@

$script = $script.Replace("__REPO_PATH__", $repoPath)
$script = $script.Replace("__RUNTIME_DIR__", $runtimeDir)
$script = $script.Replace("__PID_FILE__", $pidFile)
$script = $script.Replace("__LOG_FILE__", $logFile)
$script = $script.Replace("__LAUNCHER_PATH__", $launcherPath)
$script = $script.Replace("__PORT__", $port.ToString())

$exitCode = Invoke-WslScript $script
if ($exitCode -ne 0) {
  throw "Start failed with exit code $exitCode."
}
