import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { KataGoAnalysisEngine } from "./katago-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);
const chatModel = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const openAiMoveModel = process.env.OPENAI_MOVE_MODEL || chatModel;
const requestedBoardAiProvider = normalizeBoardAiProvider(
  process.env.BOARD_AI_PROVIDER || "auto"
);
const boardRules = process.env.BOARD_RULES || "chinese";
const boardKomi = parseFloatOr(process.env.BOARD_KOMI, 5.5);
const kataGoMaxVisits = parsePositiveInt(process.env.KATAGO_MAX_VISITS, 300);
const kataGoTimeoutMs = parsePositiveInt(process.env.KATAGO_TIMEOUT_MS, 12000);
const kataGoPassMinMoves = parsePositiveInt(process.env.KATAGO_PASS_MIN_MOVES, 20);
const kataGoPassScoreEpsilon = parseNonNegativeFloat(
  process.env.KATAGO_PASS_SCORE_EPSILON,
  1.25
);
const kataGoPassUtilityEpsilon = parseNonNegativeFloat(
  process.env.KATAGO_PASS_UTILITY_EPSILON,
  0.035
);
const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const kataGoEngine = new KataGoAnalysisEngine({
  executablePath: process.env.KATAGO_PATH,
  modelPath: process.env.KATAGO_MODEL,
  configPath: process.env.KATAGO_CONFIG,
  defaultTimeoutMs: kataGoTimeoutMs,
});
const kataGoLabel = createKataGoLabel(process.env.KATAGO_MODEL);

await warmBoardAiProvider();

app.use(express.json({ limit: "1mb" }));
app.use("/assets", express.static(path.join(__dirname, "assets")));

app.get("/", (_request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

app.get("/app.js", (_request, response) => {
  response.sendFile(path.join(__dirname, "app.js"));
});

app.get("/styles.css", (_request, response) => {
  response.sendFile(path.join(__dirname, "styles.css"));
});

app.get("/healthz", (_request, response) => {
  response.json(createHealthPayload());
});

app.get("/api/health", (_request, response) => {
  response.json(createHealthPayload());
});

app.get("/api/config", (_request, response) => {
  const boardAiStatus = getBoardAiAvailability();

  response.json({
    chatApiEnabled: Boolean(client),
    apiEnabled: Boolean(client),
    model: chatModel,
    boardAiApiEnabled: boardAiStatus.enabled,
    moveModel: boardAiStatus.label,
    boardAiProvider: boardAiStatus.provider,
    boardAiLabel: boardAiStatus.label,
  });
});

app.post("/api/chat", async (request, response) => {
  if (!client) {
    response.status(503).json({
      error: "OpenAI API key is not configured on the server.",
    });
    return;
  }

  const { messages, boardState, userMessage } = request.body ?? {};

  if (!Array.isArray(messages) || typeof userMessage !== "string") {
    response.status(400).json({
      error: "Invalid payload. Expected messages[] and userMessage.",
    });
    return;
  }

  const promptContext = createBoardPrompt(boardState);

  try {
    const apiResponse = await client.responses.create({
      model: chatModel,
      store: false,
      max_output_tokens: 260,
      input: [
        {
          role: "developer",
          content:
            "You are Sensei Chat, a warm and concise Go coach for a 9x9 Go prototype. Reply in Thai unless the user clearly asks for another language. Base your answer on the supplied board snapshot. Keep answers practical, friendly, and short. If you suggest a move, mention the board coordinate explicitly. If the board summary is approximate, say so briefly instead of overstating certainty.",
        },
        ...messages.map((message) => ({
          role: normalizeRole(message.role),
          content: String(message.text || ""),
        })),
        {
          role: "user",
          content: [
            "Current board snapshot:",
            promptContext,
            "",
            `Latest user question: ${userMessage}`,
          ].join("\n"),
        },
      ],
    });

    response.json({
      text: apiResponse.output_text,
      requestId: apiResponse.id,
      model: chatModel,
      provider: "openai",
      providerLabel: `OpenAI ${chatModel}`,
    });
  } catch (error) {
    console.error("OpenAI chat request failed:", error);
    response.status(500).json({
      error: "OpenAI request failed.",
      details: error instanceof Error ? error.message : String(error),
    });
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
    const move = await requestBoardMove({ boardState, legalMoves, playerColor });
    response.json(move);
  } catch (error) {
    console.error("Board move request failed:", error);
    response.status(500).json({
      error: "Board move request failed.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(port, () => {
  console.log(`Go Sensei Lab server listening on port ${port}`);
  console.log(
    client
      ? `Live OpenAI chat enabled with model ${chatModel}`
      : "OPENAI_API_KEY not found, using local fallback chat"
  );

  const boardAiStatus = getBoardAiAvailability();

  if (boardAiStatus.enabled) {
    console.log(`Board AI ready via ${boardAiStatus.label}`);
  } else {
    console.log("Board AI remote provider not ready, using local fallback engine on the client");
  }
});

registerShutdownHandlers();

async function warmBoardAiProvider() {
  if (requestedBoardAiProvider !== "katago" && requestedBoardAiProvider !== "auto") {
    return;
  }

  if (!kataGoEngine.isConfigured()) {
    if (requestedBoardAiProvider === "katago") {
      console.warn("BOARD_AI_PROVIDER is set to katago but KATAGO_PATH / KATAGO_MODEL / KATAGO_CONFIG are incomplete.");
    }
    return;
  }

  try {
    await kataGoEngine.start();
    console.log(`KataGo analysis engine is ready (${kataGoLabel})`);
  } catch (error) {
    console.error(
      `Failed to start KataGo analysis engine: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function normalizeRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

function createHealthPayload() {
  const boardAiStatus = getBoardAiAvailability();
  const kataGoStatus = kataGoEngine.getStatus();

  return {
    ok: true,
    service: "go-sensei-lab",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    chat: {
      remoteEnabled: Boolean(client),
      provider: client ? "openai" : "local-fallback",
      label: client ? `OpenAI ${chatModel}` : "Local fallback",
      model: client ? chatModel : null,
    },
    boardAi: {
      requestedProvider: requestedBoardAiProvider,
      remoteEnabled: boardAiStatus.enabled,
      provider: boardAiStatus.provider,
      label: boardAiStatus.label,
      openAiConfigured: Boolean(client),
      openAiModel: client ? openAiMoveModel : null,
      kataGo: {
        configured: kataGoStatus.configured,
        ready: kataGoStatus.ready,
        state: kataGoStatus.state,
        label: kataGoLabel,
        lastError: kataGoStatus.lastError,
      },
    },
  };
}

function getBoardAiAvailability() {
  const provider = getAvailableBoardAiProvider();

  return provider
    ? {
        enabled: true,
        provider: provider.provider,
        label: provider.label,
      }
    : {
        enabled: false,
        provider: null,
        label: null,
      };
}

function getAvailableBoardAiProvider() {
  if (requestedBoardAiProvider === "openai") {
    return client ? { provider: "openai", label: `OpenAI ${openAiMoveModel}` } : null;
  }

  if (requestedBoardAiProvider === "katago") {
    return kataGoEngine.isReady() ? { provider: "katago", label: kataGoLabel } : null;
  }

  if (kataGoEngine.isReady()) {
    return { provider: "katago", label: kataGoLabel };
  }

  if (client) {
    return { provider: "openai", label: `OpenAI ${openAiMoveModel}` };
  }

  return null;
}

async function ensureBoardProviderReady() {
  if (
    (requestedBoardAiProvider === "katago" || requestedBoardAiProvider === "auto") &&
    kataGoEngine.isConfigured() &&
    !kataGoEngine.isReady()
  ) {
    try {
      await kataGoEngine.start();
    } catch (error) {
      console.error(
        `KataGo start-on-demand failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return getAvailableBoardAiProvider();
}

async function requestBoardMove({ boardState, legalMoves, playerColor }) {
  const provider = await ensureBoardProviderReady();

  if (!provider) {
    throw new Error("No remote board AI provider is available.");
  }

  if (provider.provider === "katago") {
    try {
      return await requestKataGoMove({ boardState, legalMoves, playerColor });
    } catch (error) {
      if (requestedBoardAiProvider === "auto" && client) {
        console.warn(
          `KataGo move request failed, falling back to OpenAI: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return requestOpenAiMove({ boardState, legalMoves, playerColor });
      }

      throw error;
    }
  }

  return requestOpenAiMove({ boardState, legalMoves, playerColor });
}

async function requestOpenAiMove({ boardState, legalMoves, playerColor }) {
  if (!client) {
    throw new Error("OpenAI API key is not configured on the server.");
  }

  const allCoords = Array.isArray(legalMoves.allCoords) ? legalMoves.allCoords : [];
  const shortlist = Array.isArray(legalMoves.shortlist) ? legalMoves.shortlist : [];

  const apiResponse = await client.responses.create({
    model: openAiMoveModel,
    store: false,
    max_output_tokens: 180,
    input: [
      {
        role: "developer",
        content:
          "You are a strong but practical 9x9 Go opponent. Choose exactly one next move for the current player from the allowed moves list, or choose PASS. Do not invent coordinates. Reply with JSON only in this exact shape: {\"type\":\"move\"|\"pass\",\"coord\":\"D6\"|null,\"explanation\":\"short Thai explanation\"}. Keep explanation concise and strategic.",
      },
      {
        role: "user",
        content: createMovePrompt(boardState, playerColor, allCoords, shortlist),
      },
    ],
  });

  const parsedMove = parseMoveResponse(apiResponse.output_text);

  if (parsedMove.type === "move" && !allCoords.includes(parsedMove.coord)) {
    throw new Error(`Model chose an illegal coordinate: ${parsedMove.coord}`);
  }

  return {
    ...parsedMove,
    requestId: apiResponse.id,
    model: openAiMoveModel,
    provider: "openai",
    providerLabel: `OpenAI ${openAiMoveModel}`,
  };
}

async function requestKataGoMove({ boardState, legalMoves, playerColor }) {
  const query = createKataGoAnalysisQuery({ boardState, legalMoves, playerColor });
  const analysis = await kataGoEngine.analyze(query, { timeoutMs: kataGoTimeoutMs });
  const moveInfos = Array.isArray(analysis.moveInfos)
    ? [...analysis.moveInfos].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    : [];
  const bestMove = selectKataGoMove(moveInfos, query, boardState);

  if (!bestMove) {
    return {
      type: "pass",
      coord: null,
      explanation: "KataGo ไม่พบตาที่มั่นใจ จึงขอผ่านตานี้",
      requestId: query.id,
      model: kataGoLabel,
      provider: "katago",
      providerLabel: kataGoLabel,
    };
  }

  const normalizedMove = normalizeEngineMove(bestMove.move);
  const isPass = normalizedMove === "PASS";

  return {
    type: isPass ? "pass" : "move",
    coord: isPass ? null : normalizedMove,
    explanation: createKataGoExplanation(bestMove, analysis.rootInfo, normalizedMove),
    requestId: query.id,
    model: kataGoLabel,
    provider: "katago",
    providerLabel: kataGoLabel,
  };
}

function createKataGoAnalysisQuery({ boardState, legalMoves, playerColor }) {
  const size = clampBoardSize(boardState.size);
  const moveSequence = normalizeMoveSequence(boardState.moveSequence);
  const allowedMoves = buildAllowedMoves(legalMoves);
  const query = {
    id: createRequestId("katago"),
    moves: moveSequence,
    rules: typeof boardState.rules === "string" ? boardState.rules : boardRules,
    komi:
      typeof boardState.komi === "number" && Number.isFinite(boardState.komi)
        ? boardState.komi
        : boardKomi,
    boardXSize: size,
    boardYSize: size,
    maxVisits: kataGoMaxVisits,
    analysisPVLen: 8,
    allowMoves: [
      {
        player: toEngineColor(playerColor),
        moves: allowedMoves,
        untilDepth: 1,
      },
    ],
  };

  if (!moveSequence.length) {
    query.initialStones = buildInitialStonesFromBoardRows(boardState.boardRows, size);
    query.initialPlayer = toEngineColor(playerColor);
  }

  return query;
}

function selectKataGoMove(moveInfos, query, boardState) {
  const allowedMoves = new Set(
    (query.allowMoves?.[0]?.moves || []).map((move) => normalizeEngineMove(move))
  );
  const allowedMoveInfos = moveInfos.filter((moveInfo) =>
    allowedMoves.has(normalizeEngineMove(moveInfo.move))
  );
  const orderedMoveInfos = allowedMoveInfos.length ? allowedMoveInfos : moveInfos;
  const bestMove = orderedMoveInfos[0] || null;

  if (!bestMove) {
    return null;
  }

  const preferredPass = maybePreferKataGoPass(orderedMoveInfos, boardState);
  return preferredPass || bestMove;
}

function maybePreferKataGoPass(moveInfos, boardState) {
  const passMove = moveInfos.find((moveInfo) => normalizeEngineMove(moveInfo.move) === "PASS");
  const bestNonPassMove = moveInfos.find((moveInfo) => normalizeEngineMove(moveInfo.move) !== "PASS");
  const currentPlayer = toEngineColor(boardState?.currentPlayer) || "B";

  if (!passMove || !bestNonPassMove) {
    return null;
  }

  if (getBoardMoveCount(boardState) < kataGoPassMinMoves) {
    return null;
  }

  const scoreGap = getFiniteGap(
    normalizeKataGoMetricForPlayer(bestNonPassMove.scoreLead, currentPlayer),
    normalizeKataGoMetricForPlayer(passMove.scoreLead, currentPlayer)
  );
  const utilityGap = getFiniteGap(
    normalizeKataGoMetricForPlayer(bestNonPassMove.utility, currentPlayer),
    normalizeKataGoMetricForPlayer(passMove.utility, currentPlayer)
  );

  if (scoreGap !== null && scoreGap <= kataGoPassScoreEpsilon) {
    return passMove;
  }

  if (utilityGap !== null && utilityGap <= kataGoPassUtilityEpsilon) {
    return passMove;
  }

  return null;
}

function createKataGoExplanation(bestMove, rootInfo, normalizedMove) {
  if (normalizedMove === "PASS") {
    return "KataGo มองว่าตำแหน่งนี้นิ่งพอแล้ว จึงเลือกผ่านตานี้";
  }

  const visits =
    typeof bestMove.visits === "number"
      ? bestMove.visits
      : typeof rootInfo?.visits === "number"
        ? rootInfo.visits
        : null;
  const pv = Array.isArray(bestMove.pv) ? bestMove.pv.filter((move) => typeof move === "string") : [];
  const shortPv = pv.slice(0, 3).join(" -> ");

  return [
    `KataGo ชอบ ${normalizedMove}`,
    visits ? `จากการค้นหา ${visits} visits` : "",
    shortPv ? `ลำดับอ่านต่อหลักคือ ${shortPv}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildAllowedMoves(legalMoves) {
  const allCoords = Array.isArray(legalMoves.allCoords) ? legalMoves.allCoords : [];
  const uniqueMoves = new Set();

  allCoords.forEach((coord) => {
    if (typeof coord === "string" && coord.trim()) {
      uniqueMoves.add(coord.trim().toUpperCase());
    }
  });

  uniqueMoves.add("pass");

  return Array.from(uniqueMoves);
}

function normalizeMoveSequence(moveSequence) {
  if (!Array.isArray(moveSequence)) {
    return [];
  }

  return moveSequence
    .map((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return null;
      }

      const player = toEngineColor(entry[0]);
      const move = normalizeEngineMove(entry[1]);

      if (!player || !move) {
        return null;
      }

      return [player, move === "PASS" ? "pass" : move];
    })
    .filter(Boolean);
}

function buildInitialStonesFromBoardRows(boardRows, size) {
  if (!Array.isArray(boardRows)) {
    return [];
  }

  const stones = [];

  boardRows.forEach((rowLine, rowIndex) => {
    if (typeof rowLine !== "string") {
      return;
    }

    const match = rowLine.match(/:\s*([BW.]+)/i);
    const line = match ? match[1].trim().toUpperCase() : "";

    if (!line) {
      return;
    }

    for (let col = 0; col < Math.min(line.length, size); col += 1) {
      const stone = line[col];

      if (stone !== "B" && stone !== "W") {
        continue;
      }

      stones.push([stone, `${indexToColumn(col)}${size - rowIndex}`]);
    }
  });

  return stones;
}

function getBoardMoveCount(boardState) {
  if (Array.isArray(boardState?.moveSequence) && boardState.moveSequence.length) {
    return boardState.moveSequence.length;
  }

  if (!Array.isArray(boardState?.boardRows)) {
    return 0;
  }

  let stones = 0;

  boardState.boardRows.forEach((rowLine) => {
    if (typeof rowLine !== "string") {
      return;
    }

    const match = rowLine.match(/:\s*([BW.]+)/i);
    const line = match ? match[1].trim().toUpperCase() : "";

    for (const point of line) {
      if (point === "B" || point === "W") {
        stones += 1;
      }
    }
  });

  return stones;
}

function toEngineColor(color) {
  if (color === "black" || color === "B") {
    return "B";
  }

  if (color === "white" || color === "W") {
    return "W";
  }

  return null;
}

function normalizeEngineMove(move) {
  if (typeof move !== "string") {
    return null;
  }

  const normalized = move.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  if (normalized === "PASS") {
    return "PASS";
  }

  return normalized;
}

function clampBoardSize(size) {
  const normalized = Number(size || 9);

  if (!Number.isInteger(normalized) || normalized < 2 || normalized > 19) {
    return 9;
  }

  return normalized;
}

function indexToColumn(index) {
  const baseLabels = "ABCDEFGHJKLMNOPQRSTUVWXYZ";

  if (index < baseLabels.length) {
    return baseLabels[index];
  }

  let value = index;
  let result = "";

  while (value >= 0) {
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  }

  return result;
}

function createBoardPrompt(boardState) {
  if (!boardState || typeof boardState !== "object") {
    return "No board snapshot was provided.";
  }

  const size = Number(boardState.size || 9);
  const boardRows = Array.isArray(boardState.boardRows) ? boardState.boardRows : [];
  const lastMove = boardState.lastMove || "none";
  const captures = boardState.captures || { black: 0, white: 0 };
  const estimate = boardState.estimate || {};
  const nextPlayer = boardState.currentPlayer || "unknown";
  const moveLog = Array.isArray(boardState.moveLog) ? boardState.moveLog : [];

  return [
    `Board size: ${size}x${size}`,
    `Next player: ${nextPlayer}`,
    `Last move: ${lastMove}`,
    `Captures: black ${captures.black ?? 0}, white ${captures.white ?? 0}`,
    `Estimated score: black ${formatMaybeNumber(estimate.blackTotal)}, white ${formatMaybeNumber(estimate.whiteTotal)}, margin ${formatMaybeNumber(estimate.margin)}`,
    `Danger summary: ${boardState.dangerSummary || "none"}`,
    `Recent moves: ${moveLog.length ? moveLog.join(", ") : "none"}`,
    "Board rows from top (9) to bottom (1), with . for empty, B for black, W for white:",
    ...boardRows,
  ].join("\n");
}

function formatMaybeNumber(value) {
  return typeof value === "number" ? value.toFixed(1) : "n/a";
}

function createMovePrompt(boardState, playerColor, allCoords, shortlist) {
  const boardPrompt = createBoardPrompt(boardState);
  const shortlistLines = shortlist.length
    ? shortlist.map((move) =>
        [
          `- ${move.coord}`,
          `(score hint ${formatMaybeNumber(move.scoreHint)})`,
          `captures ${move.captured}`,
          `liberties ${move.selfLiberties}`,
          move.reasons?.length ? `reasons ${move.reasons.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join(" ")
      )
    : ["- no shortlist"];

  return [
    `Current player: ${playerColor}`,
    boardPrompt,
    "",
    `Allowed moves (${allCoords.length} total): ${allCoords.length ? allCoords.join(", ") : "none"}`,
    "Heuristic shortlist:",
    ...shortlistLines,
    "",
    "Pick one strong move for the current player. Prefer urgent defense, captures, connection, and efficient shape over random center moves.",
    "If the position is already settled and passing is best, choose PASS.",
  ].join("\n");
}

function parseMoveResponse(text) {
  const fallback = {
    type: "pass",
    coord: null,
    explanation: "ขอผ่านตานี้",
  };

  if (typeof text !== "string" || !text.trim()) {
    return fallback;
  }

  const objectText = extractFirstJsonObject(text);

  if (!objectText) {
    return fallback;
  }

  const parsed = JSON.parse(objectText);
  const type = parsed?.type === "move" ? "move" : "pass";
  const coord = type === "move" && typeof parsed?.coord === "string" ? parsed.coord.trim().toUpperCase() : null;
  const explanation =
    typeof parsed?.explanation === "string" && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : fallback.explanation;

  return {
    type,
    coord,
    explanation,
  };
}

function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

function normalizeBoardAiProvider(value) {
  const normalized = String(value || "auto").trim().toLowerCase();

  if (normalized === "katago" || normalized === "openai" || normalized === "auto") {
    return normalized;
  }

  return "auto";
}

function parseFloatOr(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function parseNonNegativeFloat(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : fallback;
}

function parsePositiveInt(value, fallback) {
  const normalized = Number.parseInt(value, 10);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function getFiniteGap(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

function normalizeKataGoMetricForPlayer(value, player) {
  if (!Number.isFinite(value)) {
    return null;
  }

  // KataGo reports these values from Black's perspective, so White needs the sign flipped.
  return player === "W" ? -value : value;
}

function createRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createKataGoLabel(modelPath) {
  if (typeof modelPath !== "string" || !modelPath.trim()) {
    return "KataGo Analysis";
  }

  return `KataGo ${path.basename(modelPath)}`;
}

function registerShutdownHandlers() {
  const shutdown = async () => {
    try {
      await kataGoEngine.stop();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
