. "$PSScriptRoot\common.ps1"

$repoPath = Get-WslKatagoServerHome
$runtimeDir = Get-WslKatagoRuntimeDir
$releaseTag = "v1.16.4"
$assetName = "katago-v1.16.4-eigenavx2-linux-x64.zip"

$script = @'
set -euo pipefail
repo_path='__REPO_PATH__'
runtime_dir='__RUNTIME_DIR__'
release_tag='__RELEASE_TAG__'
asset_name='__ASSET_NAME__'

apt-get update
apt-get install -y python3-venv unzip curl

if [ ! -d "$repo_path/.git" ]; then
  git clone https://github.com/hauensteina/katago-server.git "$repo_path"
fi

cd "$repo_path"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

mkdir -p "$runtime_dir"
cd "$runtime_dir"

if [ ! -x "$runtime_dir/katago" ]; then
  curl -L -o "$asset_name" "https://github.com/lightvector/KataGo/releases/download/$release_tag/$asset_name"
  unzip -o "$asset_name"
fi

./katago version
echo "Bootstrap complete."
'@

$script = $script.Replace("__REPO_PATH__", $repoPath)
$script = $script.Replace("__RUNTIME_DIR__", $runtimeDir)
$script = $script.Replace("__RELEASE_TAG__", $releaseTag)
$script = $script.Replace("__ASSET_NAME__", $assetName)

$exitCode = Invoke-WslScript $script
if ($exitCode -ne 0) {
  throw "Bootstrap failed with exit code $exitCode."
}
