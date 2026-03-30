import "dotenv/config";
import express from "express";
import {
  createKataGoServiceFromEnv,
  parsePositiveInt,
} from "./katago-service.js";

const app = express();
const port = parsePositiveInt(process.env.KATAGO_ADAPTER_PORT, 2719);
const kataGoService = createKataGoServiceFromEnv(process.env);

await warmAdapter();

app.use(express.json({ limit: "1mb" }));

app.get("/", (_request, response) => {
  response.json({
    ok: true,
    service: "katago-rest-adapter",
    message: "Use /api/health, /api/analyze, /api/move, or the compatibility endpoints.",
  });
});

app.get("/healthz", (_request, response) => {
  response.json(createHealthPayload());
});

app.get("/api/health", (_request, response) => {
  response.json(createHealthPayload());
});

app.get("/api/config", (_request, response) => {
  const status = kataGoService.getStatus();

  response.json({
    apiEnabled: status.ready,
    boardAiApiEnabled: status.ready,
    provider: "katago",
    botName: kataGoService.getBotName(),
    label: kataGoService.getLabel(),
    configured: status.configured,
    ready: status.ready,
    state: status.state,
    lastError: status.lastError,
  });
});

app.post("/api/analyze", async (request, response) => {
  const body = request.body ?? {};
  const query = body.query ?? body;
  const timeoutMs = body.timeoutMs;

  if (!query || typeof query !== "object" || Array.isArray(query)) {
    response.status(400).json({
      error: "Invalid payload. Expected a KataGo analysis query object.",
    });
    return;
  }

  try {
    const analysis = await kataGoService.analyze(query, { timeoutMs });
    response.json(analysis);
  } catch (error) {
    handleAdapterError(response, "KataGo analysis request failed.", error);
  }
});

app.post("/api/move", async (request, response) => {
  const { boardState, legalMoves, playerColor } = request.body ?? {};

  if (!boardState || typeof boardState !== "object" || !legalMoves || typeof legalMoves !== "object") {
    response.status(400).json({
      error: "Invalid payload. Expected boardState and legalMoves.",
    });
    return;
  }

  if (typeof playerColor !== "string") {
    response.status(400).json({
      error: "Invalid payload. Expected playerColor.",
    });
    return;
  }

  try {
    const move = await kataGoService.requestMove({ boardState, legalMoves, playerColor });
    response.json(move);
  } catch (error) {
    handleAdapterError(response, "KataGo move request failed.", error);
  }
});

app.post(`/select-move/${kataGoService.getBotName()}`, async (request, response) => {
  const { board_size: boardSize, moves, config } = request.body ?? {};

  if (!Array.isArray(moves)) {
    response.status(400).json({
      error: "Invalid payload. Expected moves to be an array.",
    });
    return;
  }

  try {
    const result = await kataGoService.requestCompatibilityMove({
      boardSize,
      moves,
      config,
    });
    response.json(result);
  } catch (error) {
    handleAdapterError(response, "Compatibility select-move request failed.", error);
  }
});

app.post(`/score/${kataGoService.getBotName()}`, async (request, response) => {
  const { board_size: boardSize, moves, config } = request.body ?? {};

  if (!Array.isArray(moves)) {
    response.status(400).json({
      error: "Invalid payload. Expected moves to be an array.",
    });
    return;
  }

  try {
    const result = await kataGoService.requestCompatibilityScore({
      boardSize,
      moves,
      config,
    });
    response.json(result);
  } catch (error) {
    handleAdapterError(response, "Compatibility score request failed.", error);
  }
});

app.listen(port, () => {
  console.log(`KataGo REST adapter listening on port ${port}`);
  console.log(`Compatibility bot name: ${kataGoService.getBotName()}`);
  console.log(`KataGo label: ${kataGoService.getLabel()}`);
});

registerShutdownHandlers();

async function warmAdapter() {
  if (!kataGoService.isConfigured()) {
    console.warn("KATAGO_PATH / KATAGO_MODEL / KATAGO_CONFIG are incomplete. Adapter will start in an unready state.");
    return;
  }

  try {
    await kataGoService.start();
    console.log(`KataGo adapter engine is ready (${kataGoService.getLabel()})`);
  } catch (error) {
    console.error(
      `Failed to start KataGo adapter engine: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function createHealthPayload() {
  return {
    ok: true,
    service: "katago-rest-adapter",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    kataGo: kataGoService.getStatus(),
  };
}

function handleAdapterError(response, message, error) {
  console.error(message, error);
  response.status(500).json({
    error: message,
    details: error instanceof Error ? error.message : String(error),
  });
}

function registerShutdownHandlers() {
  const shutdown = async () => {
    try {
      await kataGoService.stop();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
