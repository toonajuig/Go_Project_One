# WSL KataGo Server

This project now includes helper scripts to run `hauensteina/katago-server` inside WSL2 on Windows.

The setup on this machine was prepared on March 30, 2026 with:

- WSL distro: `Ubuntu 24.04.1 LTS`
- `katago-server` repo path inside WSL: `/root/katago-server`
- KataGo runtime used for compatibility: official `v1.16.4` `katago-v1.16.4-eigenavx2-linux-x64.zip`

Why this uses an official KataGo runtime instead of the binary bundled in `katago-server`:

- the repo's bundled `katago_eigen` depends on older Ubuntu libraries such as Boost 1.65
- Ubuntu 24.04 in WSL does not ship those exact library versions
- using a current official KataGo Linux binary is more reliable than pinning old system libraries

## Commands

Run these from PowerShell in the project root:

```powershell
.\tools\wsl-katago-server\bootstrap-katago-server.ps1
.\tools\wsl-katago-server\start-katago-server.ps1
.\tools\wsl-katago-server\status-katago-server.ps1
.\tools\wsl-katago-server\test-katago-server.ps1
.\tools\wsl-katago-server\stop-katago-server.ps1
```

The REST API will be reachable from Windows at:

```text
http://127.0.0.1:2718
```

Example endpoint:

```text
POST /select-move/katago_gtp_bot
```

## Files

- `tools/wsl-katago-server/bootstrap-katago-server.ps1`
  - installs WSL packages, clones `katago-server`, creates `.venv`, installs Python dependencies, downloads the KataGo runtime
- `tools/wsl-katago-server/start-katago-server.ps1`
  - starts the Flask service inside WSL and writes a PID file plus log file in `/root/katago-server`
- `tools/wsl-katago-server/status-katago-server.ps1`
  - shows process state, port state, and the last log lines
- `tools/wsl-katago-server/test-katago-server.ps1`
  - sends a sample move request from Windows to the WSL service
- `tools/wsl-katago-server/stop-katago-server.ps1`
  - stops the background WSL process
- `tools/wsl-katago-server/launch_katago_server.py`
  - launcher that reuses upstream `katago-server` Python modules but points them at the current KataGo Linux runtime

## Environment overrides

If you later move the WSL repo away from `/root/katago-server`, you can override the defaults with Windows environment variables:

```powershell
$env:WSL_KATAGO_SERVER_HOME = "/home/your-user/katago-server"
$env:WSL_KATAGO_RUNTIME_DIR = "/home/your-user/katago-server/runtime"
$env:WSL_KATAGO_SERVER_PORT = "2718"
```

## Important note for this project

This setup does not automatically switch the current Node server in this repo to use the REST API.

Right now:

- this repo's `server.js` talks directly to `katago-engine.js`
- the new WSL setup runs a separate `katago-server` REST service

If you want, the next step can be adding a small adapter so this project can choose between:

- direct local KataGo executable
- WSL `katago-server` REST API
