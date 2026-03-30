# KataGo REST Adapter

This adapter exposes the current `KataGoAnalysisEngine` through HTTP without using the older Python `katago-server`.

It keeps the current Windows KataGo executable path and can continue to use the local GPU-backed setup that is already configured in `.env`.

## Start

```powershell
npm run start:katago-adapter
```

Optional environment variables:

```env
KATAGO_ADAPTER_PORT=2719
KATAGO_ADAPTER_BOT_NAME=katago_gtp_bot
```

## Endpoints

### Health

```text
GET /healthz
GET /api/health
GET /api/config
```

### Native adapter endpoints

```text
POST /api/analyze
POST /api/move
```

`POST /api/analyze` accepts either:

```json
{
  "query": {
    "boardXSize": 9,
    "boardYSize": 9,
    "rules": "chinese",
    "komi": 5.5,
    "moves": [],
    "maxVisits": 100
  },
  "timeoutMs": 12000
}
```

or a raw KataGo analysis query object as the whole request body.

`POST /api/move` accepts the same payload shape that the current app server already uses:

```json
{
  "boardState": {
    "size": 9,
    "currentPlayer": "black",
    "moveSequence": [],
    "boardRows": []
  },
  "legalMoves": {
    "allCoords": ["A1", "B1", "C1"]
  },
  "playerColor": "black"
}
```

## Compatibility endpoints

The adapter also exposes compatibility endpoints so anything that previously expected `katago-server` style routes can be pointed here instead:

```text
POST /select-move/katago_gtp_bot
POST /score/katago_gtp_bot
```

Unlike the older Python `katago-server`, this adapter uses the current analysis engine and correctly respects board sizes like 9x9.
