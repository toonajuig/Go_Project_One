# Handoff

Updated: 2026-03-31

## Current status

- Branch: `main`
- Remote: `origin/main`
- Latest pushed commit before this round: `153309a` `Fix KataGo startup in Render containers`
- Current round adds a stronger Render KataGo profile plus selectable Black/White seats in the browser UI
- The project now has a Render Blueprint and can deploy with server-side KataGo on Render
- The current Render deployment is intentionally tuned for stability on a small/free instance, so KataGo strength is noticeably reduced

## Important recent commits

- `c9ed675` `Clean up app flow and add browser smoke test`
- `f74287d` `Add KataGo service wiring and mode selector`
- `fda2266` `Add KataGo adapter setup and WSL helper tools`
- `5ce8d56` `Add heuristic training engine and handoff notes`
- `e624df4` `Add Render blueprint for Docker deploy`
- `9915f1c` `Add Render KataGo deployment support`
- `cc6f658` `Tune Render KataGo for smaller instances`
- `153309a` `Fix KataGo startup in Render containers`

## What changed after the earlier heuristic work

### 1. Browser app cleanup and verification

- `app.js` was cleaned up so the active browser flow uses one canonical implementation
- Restored the missing chat submit handler after cleanup
- Fixed the hidden scoring panel CSS regression
- Added browser smoke coverage in `tools/verify-browser-flow.spec.js`

Verified:

- `node --check app.js`
- `node --check server.js`
- `npx playwright test tools/verify-browser-flow.spec.js --reporter=line`

### 2. Render Blueprint support

Added Docker-based Render deployment support:

- `render.yaml`
- `Dockerfile`
- `DEPLOY.md`
- `.env.example`

Key behavior:

- Render builds the Docker image
- The image downloads Linux KataGo plus model during build
- Render health checks require KataGo to be ready, not just the Node server

### 3. Render KataGo startup bug and fix

Initial Render logs showed KataGo failing at startup with messages like:

- `fuse: device not found, try 'modprobe fuse' first`
- `Failed to parse stdout JSON`
- `KataGo exited during startup (code 127, signal null)`

Root cause:

- The Linux KataGo release artifact behaves as an AppImage
- In Render containers, FUSE is not available

Fix:

- `katago-engine.js` now sets `APPIMAGE_EXTRACT_AND_RUN=1` when spawning KataGo on Linux
- `Dockerfile` also sets `ENV APPIMAGE_EXTRACT_AND_RUN=1`

Result:

- Linux/WSL smoke tests confirmed KataGo can now boot and answer an `analysis` request under the same AppImage mode

### 4. Stronger Render KataGo profile and selectable player seat

This round added two user-facing improvements:

- Render KataGo was tuned upward for stronger play while staying below the earlier failure profile
- The browser UI now lets the player choose `Black` or `White` when playing against KataGo or the local heuristic

Files touched:

- `app.js`
- `index.html`
- `render.yaml`
- `tools/katago/config/render_analysis.cfg`
- `tools/verify-browser-flow.spec.js`

Behavior changes:

- New seat selector in the UI for AI modes
- If the player chooses White, the AI now correctly opens the game as Black
- Browser status text and session labels now reflect the chosen side
- Browser smoke test now covers the White-seat flow

## Current Render KataGo config

Render currently uses a lightweight config file:

- `tools/katago/config/render_analysis.cfg`

Current values:

- `maxVisits = 160`
- `wideRootNoise = 0.0`
- `numAnalysisThreads = 1`
- `numSearchThreadsPerAnalysisThread = 4`
- `nnMaxBatchSize = 4`
- `nnCacheSizePowerOfTwo = 17`
- `nnMutexPoolSizePowerOfTwo = 13`

Render environment values in `render.yaml`:

- `BOARD_AI_PROVIDER=auto`
- `HEALTH_REQUIRE_BOARD_AI=katago`
- `KATAGO_CONFIG=/app/tools/katago/config/render_analysis.cfg`
- `KATAGO_MAX_VISITS=160`
- `KATAGO_TIMEOUT_MS=45000`

## Why deployed KataGo feels weak

The deployed KataGo is not weak because of the model itself.

It feels weak because it was deliberately throttled so it could survive Render startup and run on a small CPU-only instance:

- visits were reduced a lot
- search threads were reduced a lot
- cache and batching were reduced a lot
- the config was tuned for reliability first, not playing strength

This was done after Render startup problems, so the current deployment favors:

- boot reliability
- lower memory pressure
- lower CPU pressure

at the cost of:

- shallower reading
- weaker tactical accuracy
- more human-visible mistakes

## Recommended next steps for the next round

### First thing to verify

Redeploy Render with the stronger profile and watch whether the service still boots cleanly on the free/small instance.

Specifically check:

- whether startup still passes health checks
- whether move latency is still acceptable
- whether logs show memory pressure or timeouts

### Option A: Another balanced strength increase

If the current stronger profile is still stable, try another moderate bump:

- add `wideRootNoise = 0.0`
- raise `maxVisits` to around `160`
- raise `numSearchThreadsPerAnalysisThread` to around `4`
- raise `KATAGO_TIMEOUT_MS` to around `45000`

Expected result:

- noticeably stronger play
- still has a reasonable chance to survive on Render

### Option B: Stronger but riskier on Render free

Push closer to local strength:

- higher visits again
- more threads
- larger cache
- potentially revert toward `analysis_example.cfg`

Expected result:

- stronger play
- higher risk of slow startup, timeout, or memory pressure on Render free

### Option C: Better hosting for stronger KataGo

If strong KataGo is the priority, the cleaner solution is a stronger runtime:

- upgrade the Render instance
- or deploy on a host with more CPU/RAM

This is likely the most reliable path if we want substantially better strength without constantly fighting resource limits.

## Files most relevant next round

- `render.yaml`
- `Dockerfile`
- `katago-engine.js`
- `server.js`
- `tools/katago/config/render_analysis.cfg`
- `tools/katago/config/analysis_example.cfg`
- `DEPLOY.md`

## Useful checks next round

Check local git state:

```bash
git status --short --branch
git log --oneline -n 8
```

Check syntax:

```bash
node --check server.js
node --check katago-engine.js
```

Run local server:

```bash
npm.cmd start
```

Check deployed service:

```text
/healthz
/api/health
/api/config
```

Look for these Render log signals:

- `KataGo analysis engine is ready`
- `Board AI ready via KataGo ...`
- `fuse: device not found`
- `Failed to parse stdout JSON`
- `KataGo exited during startup`
- `OOM`
- health check failures

## User preference noted

- Current round already includes one moderate strength increase for Render KataGo
- If further tuning is needed, do it incrementally and verify Render stability after each bump
