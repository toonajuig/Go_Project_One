import path from "path";
import { KataGoAnalysisEngine } from "./katago-engine.js";

export class KataGoBoardService {
  constructor(options = {}) {
    this.boardRules = normalizeRules(options.boardRules, "chinese");
    this.boardKomi = parseFloatOr(options.boardKomi, 5.5);
    this.maxVisits = parsePositiveInt(options.maxVisits, 300);
    this.timeoutMs = parsePositiveInt(options.timeoutMs, 12000);
    this.passMinMoves = parsePositiveInt(options.passMinMoves, 20);
    this.passScoreEpsilon = parseNonNegativeFloat(options.passScoreEpsilon, 1.25);
    this.passUtilityEpsilon = parseNonNegativeFloat(options.passUtilityEpsilon, 0.035);
    this.botName =
      typeof options.botName === "string" && options.botName.trim()
        ? options.botName.trim()
        : "katago_gtp_bot";

    this.engine = new KataGoAnalysisEngine({
      executablePath: options.executablePath,
      modelPath: options.modelPath,
      configPath: options.configPath,
      additionalArgs: options.additionalArgs,
      startupGraceMs: options.startupGraceMs,
      defaultTimeoutMs: this.timeoutMs,
      stderrPrefix: options.stderrPrefix,
    });
    this.label = createKataGoLabel(options.modelPath);
  }

  getLabel() {
    return this.label;
  }

  getBotName() {
    return this.botName;
  }

  isConfigured() {
    return this.engine.isConfigured();
  }

  isReady() {
    return this.engine.isReady();
  }

  getStatus() {
    return {
      ...this.engine.getStatus(),
      label: this.label,
      botName: this.botName,
    };
  }

  async start() {
    return this.engine.start();
  }

  async stop() {
    return this.engine.stop();
  }

  async analyze(query, options = {}) {
    const timeoutMs = parsePositiveInt(options.timeoutMs, this.timeoutMs);
    return this.engine.analyze(query, { timeoutMs });
  }

  async requestMove({ boardState, legalMoves, playerColor }) {
    const query = this.createProjectQuery({ boardState, legalMoves, playerColor });
    const analysis = await this.analyze(query, { timeoutMs: this.timeoutMs });
    return this.createProjectMoveResponse({ analysis, query, boardState });
  }

  async requestCompatibilityMove({ boardSize, moves, config = {} }) {
    const query = this.createCompatibilityQuery({ boardSize, moves, config });
    const analysis = await this.analyze(query, { timeoutMs: parsePositiveInt(config.timeoutMs, this.timeoutMs) });
    const moveInfos = sortMoveInfos(analysis.moveInfos);
    const boardState = createCompatibilityBoardState(query.moves);
    const bestMove = selectBestMove({
      moveInfos,
      query,
      boardState,
      passMinMoves: this.passMinMoves,
      passScoreEpsilon: this.passScoreEpsilon,
      passUtilityEpsilon: this.passUtilityEpsilon,
    });
    const normalizedMove = normalizeCompatibilityMove(bestMove?.move) || "pass";

    return {
      bot_move: normalizedMove,
      diagnostics: createCompatibilityDiagnostics({
        analysis,
        moveInfos,
        bestMove,
      }),
      request_id: readRequestId(config, query.id),
    };
  }

  async requestCompatibilityScore({ boardSize, moves, config = {} }) {
    const query = this.createCompatibilityQuery({
      boardSize,
      moves,
      config,
      includeOwnership: true,
    });
    const analysis = await this.analyze(query, { timeoutMs: parsePositiveInt(config.timeoutMs, this.timeoutMs) });
    const moveInfos = sortMoveInfos(analysis.moveInfos);
    const bestMove = moveInfos[0] || null;

    return {
      probs: Array.isArray(analysis.ownership) ? analysis.ownership : [],
      diagnostics: createCompatibilityDiagnostics({
        analysis,
        moveInfos,
        bestMove,
      }),
      request_id: readRequestId(config, query.id),
    };
  }

  createProjectQuery({ boardState, legalMoves, playerColor }) {
    const size = clampBoardSize(boardState?.size);
    const moveSequence = normalizeMoveSequence(boardState?.moveSequence);
    const allowedMoves = buildAllowedMoves(legalMoves);
    const query = {
      id: createRequestId("katago"),
      moves: moveSequence,
      rules: normalizeRules(boardState?.rules, this.boardRules),
      komi:
        typeof boardState?.komi === "number" && Number.isFinite(boardState.komi)
          ? boardState.komi
          : this.boardKomi,
      boardXSize: size,
      boardYSize: size,
      maxVisits: this.maxVisits,
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
      query.initialStones = buildInitialStonesFromBoardRows(boardState?.boardRows, size);
      query.initialPlayer = toEngineColor(playerColor);
    }

    return query;
  }

  createCompatibilityQuery({ boardSize, moves, config = {}, includeOwnership = false }) {
    const size = clampBoardSize(boardSize);
    const normalizedMoves = normalizeAlternatingMoves(moves);
    const query = {
      id: readRequestId(config, createRequestId("katago-rest")),
      moves: normalizedMoves,
      rules: normalizeRules(config.rules, this.boardRules),
      komi: parseFloatOr(config.komi, this.boardKomi),
      boardXSize: size,
      boardYSize: size,
      maxVisits: parsePositiveInt(config.maxVisits ?? config.max_visits, this.maxVisits),
      analysisPVLen: parsePositiveInt(
        config.analysisPVLen ?? config.analysis_pv_len,
        8
      ),
    };

    if (includeOwnership) {
      query.includeOwnership = true;
    }

    return query;
  }

  createProjectMoveResponse({ analysis, query, boardState }) {
    const moveInfos = sortMoveInfos(analysis.moveInfos);
    const bestMove = selectBestMove({
      moveInfos,
      query,
      boardState,
      passMinMoves: this.passMinMoves,
      passScoreEpsilon: this.passScoreEpsilon,
      passUtilityEpsilon: this.passUtilityEpsilon,
    });

    if (!bestMove) {
      return {
        type: "pass",
        coord: null,
        explanation: "KataGo did not find a confident move, so it passes here.",
        requestId: query.id,
        model: this.label,
        provider: "katago",
        providerLabel: this.label,
      };
    }

    const normalizedMove = normalizeEngineMove(bestMove.move);
    const isPass = normalizedMove === "PASS";

    return {
      type: isPass ? "pass" : "move",
      coord: isPass ? null : normalizedMove,
      explanation: createKataGoExplanation(bestMove, analysis.rootInfo, normalizedMove),
      requestId: query.id,
      model: this.label,
      provider: "katago",
      providerLabel: this.label,
    };
  }
}

export function createKataGoServiceFromEnv(env = process.env, overrides = {}) {
  return new KataGoBoardService({
    executablePath: overrides.executablePath ?? env.KATAGO_PATH,
    modelPath: overrides.modelPath ?? env.KATAGO_MODEL,
    configPath: overrides.configPath ?? env.KATAGO_CONFIG,
    boardRules: overrides.boardRules ?? env.BOARD_RULES,
    boardKomi: overrides.boardKomi ?? env.BOARD_KOMI,
    maxVisits: overrides.maxVisits ?? env.KATAGO_MAX_VISITS,
    timeoutMs: overrides.timeoutMs ?? env.KATAGO_TIMEOUT_MS,
    passMinMoves: overrides.passMinMoves ?? env.KATAGO_PASS_MIN_MOVES,
    passScoreEpsilon: overrides.passScoreEpsilon ?? env.KATAGO_PASS_SCORE_EPSILON,
    passUtilityEpsilon:
      overrides.passUtilityEpsilon ?? env.KATAGO_PASS_UTILITY_EPSILON,
    botName: overrides.botName ?? env.KATAGO_ADAPTER_BOT_NAME,
  });
}

export function parsePositiveInt(value, fallback) {
  const normalized = Number.parseInt(value, 10);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function sortMoveInfos(moveInfos) {
  return Array.isArray(moveInfos)
    ? [...moveInfos].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    : [];
}

function selectBestMove({
  moveInfos,
  query,
  boardState,
  passMinMoves,
  passScoreEpsilon,
  passUtilityEpsilon,
}) {
  const allowedMoves = new Set(
    (query.allowMoves?.[0]?.moves || []).map((move) => normalizeEngineMove(move))
  );
  const allowedMoveInfos = allowedMoves.size
    ? moveInfos.filter((moveInfo) => allowedMoves.has(normalizeEngineMove(moveInfo.move)))
    : moveInfos;
  const orderedMoveInfos = allowedMoveInfos.length ? allowedMoveInfos : moveInfos;
  const bestMove = orderedMoveInfos[0] || null;

  if (!bestMove) {
    return null;
  }

  const preferredPass = maybePreferPass({
    moveInfos: orderedMoveInfos,
    boardState,
    passMinMoves,
    passScoreEpsilon,
    passUtilityEpsilon,
  });
  return preferredPass || bestMove;
}

function maybePreferPass({
  moveInfos,
  boardState,
  passMinMoves,
  passScoreEpsilon,
  passUtilityEpsilon,
}) {
  const passMove = moveInfos.find((moveInfo) => normalizeEngineMove(moveInfo.move) === "PASS");
  const bestNonPassMove = moveInfos.find(
    (moveInfo) => normalizeEngineMove(moveInfo.move) !== "PASS"
  );
  const currentPlayer = toEngineColor(boardState?.currentPlayer) || "B";

  if (!passMove || !bestNonPassMove) {
    return null;
  }

  if (getBoardMoveCount(boardState) < passMinMoves) {
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

  if (scoreGap !== null && scoreGap <= passScoreEpsilon) {
    return passMove;
  }

  if (utilityGap !== null && utilityGap <= passUtilityEpsilon) {
    return passMove;
  }

  return null;
}

function createCompatibilityDiagnostics({ analysis, moveInfos, bestMove }) {
  const rootInfo = analysis?.rootInfo || null;

  return {
    winprob: Number.isFinite(rootInfo?.winrate) ? rootInfo.winrate : -1,
    score: Number.isFinite(rootInfo?.scoreLead) ? rootInfo.scoreLead : 0,
    bot_move: normalizeCompatibilityMove(bestMove?.move) || "",
    best_ten: moveInfos.slice(0, 10).map((moveInfo) => ({
      move: normalizeCompatibilityMove(moveInfo.move) || "",
      psv: typeof moveInfo.visits === "number" ? moveInfo.visits : 0,
      visits: typeof moveInfo.visits === "number" ? moveInfo.visits : 0,
    })),
  };
}

function createCompatibilityBoardState(moveSequence) {
  const currentPlayer = moveSequence.length % 2 === 0 ? "black" : "white";

  return {
    currentPlayer,
    moveSequence: moveSequence.map(([player, move]) => [
      player,
      move === "pass" ? "PASS" : move,
    ]),
  };
}

function readRequestId(config, fallback) {
  if (typeof config?.request_id === "string" && config.request_id.trim()) {
    return config.request_id.trim();
  }

  if (typeof config?.requestId === "string" && config.requestId.trim()) {
    return config.requestId.trim();
  }

  return fallback;
}

function createKataGoExplanation(bestMove, rootInfo, normalizedMove) {
  if (normalizedMove === "PASS") {
    return "KataGo thinks the position is settled enough to pass here.";
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
    `KataGo prefers ${normalizedMove}`,
    visits ? `after ${visits} visits` : "",
    shortPv ? `with follow-up ${shortPv}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildAllowedMoves(legalMoves) {
  const allCoords = Array.isArray(legalMoves?.allCoords) ? legalMoves.allCoords : [];
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

function normalizeAlternatingMoves(moves) {
  if (!Array.isArray(moves)) {
    return [];
  }

  let currentPlayer = "B";

  return moves
    .map((move) => {
      const normalizedMove = normalizeEngineMove(move);

      if (!normalizedMove) {
        return null;
      }

      const entry = [currentPlayer, normalizedMove === "PASS" ? "pass" : normalizedMove];
      currentPlayer = currentPlayer === "B" ? "W" : "B";
      return entry;
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

function normalizeCompatibilityMove(move) {
  const normalized = normalizeEngineMove(move);
  if (!normalized) {
    return null;
  }

  return normalized === "PASS" ? "pass" : normalized;
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

function parseFloatOr(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function parseNonNegativeFloat(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : fallback;
}

function getFiniteGap(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}

function normalizeKataGoMetricForPlayer(value, player) {
  if (!Number.isFinite(value)) {
    return null;
  }

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

function normalizeRules(value, fallback) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  return value.trim().toLowerCase();
}
