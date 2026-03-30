# Handoff

Updated: 2026-03-30

## Current status

- Branch: `main`
- Tracking: `main...origin/main`
- Working tree is still dirty
- Files actively changed this round:
  - `app.js`
  - `local-heuristic-engine.js`
  - `HANDOFF.md`
- Other modified/untracked files already in the tree:
  - `index.html`
  - `styles.css`
  - `package.json`
  - `tools/train-local-vs-katago.js`

## What changed this round

### 1. Life-and-death heuristic upgrade

- Added group life analysis to `local-heuristic-engine.js`
- Added eye-related concepts:
  - `eyeCount`
  - `eyePotential`
  - `falseEyeCount`
  - status buckets: `alive`, `stable`, `unsettled`, `critical`, `dead`
- Added move metrics:
  - `eyeBonus`
  - `lifeDeathBonus`
  - `cleanupPressurePenalty`
  - `futileDefensePenalty`
- Integrated those signals into:
  - board evaluation
  - urgent-move collection
  - static move ranking
  - search candidate selection
  - pass logic

### 2. Browser heuristic synced

- Mirrored the same logic into the active implementation near the bottom of `app.js`
- `node --check app.js` passes after sync
- Later cleaned up `app.js` so the active path now uses one canonical implementation instead of duplicate legacy declarations

### 3. Reproduced screenshot bug and fixed it

Two user-reported local-heuristic mistakes were reproduced from screenshot positions:

1. A dead group was still being chased in endgame
- Symptom: local heuristic kept playing cleanup moves on stones that were already dead
- Fixes:
  - dead/already-lost groups now get reduced urgency
  - cleanup chasing now has explicit penalty
  - pass logic now checks unresolved life/death before deciding to continue or stop

2. Local heuristic chose `J6` then `J4` instead of taking `B6`
- Reproduced locally from the board in the screenshot
- Before fix:
  - static rank liked `B6`
  - deeper search still drifted to `J6` / `J4`
- Root cause:
  - right-side white group was being treated as too urgent
  - search could over-prefer soft territorial/shape moves over obvious tactical captures
- Fixes:
  - group life analysis now considers a "runway" / large shared external liberty region before labeling some groups as `critical`
  - added tactical override in `chooseStrategicMove` so a clearly stronger capture is not skipped by a soft search preference
- After fix:
  - both "before J6" and "before J4" scenarios now choose `B6`

## Key implementation notes

### `local-heuristic-engine.js`

- `analyzeGroupLife(...)`
  - now tracks external region information:
    - `externalRegionCount`
    - `maxExternalRegionSize`
    - `sharedLibertySpan`
  - uses `strongRunway` to avoid overcalling some flexible groups as `critical`
- `chooseStrategicMove(...)`
  - now includes `findTacticalOverrideMove(...)`
  - uses tactical override after search to keep obvious captures from being discarded

### `app.js`

- Duplicate legacy declarations were removed after the heuristic sync
- The current browser flow now uses one canonical implementation for rendering, move suggestions, scoring, and game mode handling

## Verification already done

- `node --check local-heuristic-engine.js`
- `node --check app.js`
- Reproduced and checked screenshot scenarios with inline Node scripts
- `npx playwright test tools/verify-browser-flow.spec.js --reporter=line`
- Ran short training batches:

```bash
npm.cmd run train:heuristic -- --games 2 --max-moves 16 --max-visits 40 --keep-examples 6
```

Latest short-run logs:

```text
analysis_logs/heuristic-vs-katago-20260330-135954.json
analysis_logs/heuristic-vs-katago-20260330-140111.json
```

Latest short-run result from `heuristic-vs-katago-20260330-140111.json`:

- strict agreement: `18.8%`
- relaxed agreement: `37.5%`
- strongest mismatch signals:
  - `board evaluation`
  - `life-and-death swing`
  - `defense urgency`
  - `enemy pressure`
  - `liberty swing`
  - `cleanup chase penalty`

Interpretation:
- life/death logic is now affecting decisions in the intended direction
- but its weight is still likely too strong in some positions
- `boardDelta` is also still dominating too much

## Important caveats

- Heuristic tuning is still incomplete even after the life-and-death upgrade
- The latest short runs still suggest `boardDelta`, `lifeDeathBonus`, and defense pressure can dominate too much in some positions
- Reproducible regression fixtures for the screenshot positions have still not been added yet

## Suggested next steps

1. Continue heuristic tuning
- Focus next on reducing over-bias from:
  - `boardDelta`
  - `lifeDeathBonus`
  - `defenseUrgencyBonus`
- A good next pass is to stage-weight those even more toward late endgame only

2. Add reproducible regression cases
- Save the two screenshot positions as code fixtures or small JSON snapshots
- Add a script/test that asserts expected top move or selected move
- This will prevent the same bug from coming back during tuning

3. Expand training coverage
- Run longer batches once you are happy with the current weights
- Compare agreement rate changes before and after each heuristic adjustment

## Useful commands for next round

Run app:

```bash
npm.cmd start
```

Run dev mode:

```bash
npm.cmd run dev
```

Run training:

```bash
npm.cmd run train:heuristic -- --games 8 --max-moves 20 --max-visits 80
```

Check git state:

```bash
git status --short --branch
git log --oneline -n 5
```

## Latest known base commits

- `7156314` Remove OpenAI integration and API key references
- `e597d3b` Prepare Render deployment
