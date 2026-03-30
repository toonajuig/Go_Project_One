import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { KataGoAnalysisEngine } from "../katago-engine.js";
import {
  HEURISTIC_METRIC_SPECS,
  applyChoice,
  chooseStrategicMove,
  createInitialState,
  estimateScore,
  findRankedMove,
  getBoardRows,
  getMoveSequenceForApi,
  rankMovesStatic,
  resolveChoiceIndex,
} from "../local-heuristic-engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const options = parseArgs(process.argv.slice(2));
const kataGoEngine = new KataGoAnalysisEngine({
  executablePath: process.env.KATAGO_PATH,
  modelPath: process.env.KATAGO_MODEL,
  configPath: process.env.KATAGO_CONFIG,
  defaultTimeoutMs: options.timeoutMs,
});

await main();

async function main() {
  if (!kataGoEngine.isConfigured()) {
    throw new Error("KataGo is not configured. Set KATAGO_PATH, KATAGO_MODEL, and KATAGO_CONFIG.");
  }

  await kataGoEngine.start();
  const summary = createSummary();

  try {
    for (let gameIndex = 0; gameIndex < options.games; gameIndex += 1) {
      const result = await playGame(gameIndex);
      summary.games.push(result);
      summary.localWins += result.winner === "local" ? 1 : 0;
      summary.kataGoWins += result.winner === "katago" ? 1 : 0;
      summary.draws += result.winner === "draw" ? 1 : 0;
      summary.totalLocalTurns += result.localTurns;
      summary.totalComparedTurns += result.comparedTurns;
      summary.strictAgreements += result.strictAgreements;
      summary.relaxedAgreements += result.relaxedAgreements;
      accumulateAgreementBreakdown(summary.agreementBreakdown, result.agreementBreakdown);

      for (const disagreement of result.disagreements) {
        accumulateDisagreement(summary.metricStats, disagreement.metricDeltas);
      }

      console.log(
        [
          `game ${gameIndex + 1}/${options.games}`,
          `local=${result.localColor}`,
          `winner=${result.winner}`,
          `estimate=${formatSigned(result.localMargin)}`,
          `strict=${result.strictAgreements}/${result.comparedTurns}`,
          `relaxed=${result.relaxedAgreements}/${result.comparedTurns}`,
          `turns=${result.turns.length}`,
        ].join(" | ")
      );
    }
  } finally {
    await kataGoEngine.stop();
  }

  const topSignals = summarizeMetricStats(summary.metricStats);
  const output = {
    createdAt: new Date().toISOString(),
    options,
    results: {
      localWins: summary.localWins,
      kataGoWins: summary.kataGoWins,
      draws: summary.draws,
      totalLocalTurns: summary.totalLocalTurns,
      comparedTurns: summary.totalComparedTurns,
      agreementRate:
        summary.totalComparedTurns > 0
          ? Number((summary.strictAgreements / summary.totalComparedTurns).toFixed(4))
          : 0,
      strictAgreementRate:
        summary.totalComparedTurns > 0
          ? Number((summary.strictAgreements / summary.totalComparedTurns).toFixed(4))
          : 0,
      relaxedAgreementRate:
        summary.totalComparedTurns > 0
          ? Number((summary.relaxedAgreements / summary.totalComparedTurns).toFixed(4))
          : 0,
      agreementBreakdown: summary.agreementBreakdown,
      topSignals,
    },
    games: summary.games,
  };

  const outDir = path.resolve(projectRoot, "analysis_logs");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `heuristic-vs-katago-${createTimestamp()}.json`);
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));

  console.log("");
  console.log(`Saved training log to ${outPath}`);
  console.log(`record: local ${summary.localWins} | kataGo ${summary.kataGoWins} | draws ${summary.draws}`);
  console.log(
    `strict agreement rate: ${
      summary.totalComparedTurns > 0
        ? ((summary.strictAgreements / summary.totalComparedTurns) * 100).toFixed(1)
        : "0.0"
    }%`
  );
  console.log(
    `relaxed agreement rate: ${
      summary.totalComparedTurns > 0
        ? ((summary.relaxedAgreements / summary.totalComparedTurns) * 100).toFixed(1)
        : "0.0"
    }%`
  );
  console.log(
    `agreement breakdown: exact ${summary.agreementBreakdown.exact} | symmetry ${summary.agreementBreakdown.symmetry} | near-score ${summary.agreementBreakdown.nearScore} | mismatch ${summary.agreementBreakdown.mismatch}`
  );

  if (topSignals.length) {
    console.log("strongest mismatch signals:");
    for (const signal of topSignals) {
      console.log(`- ${signal.label}: ${signal.summary}`);
    }
  }
}

async function playGame(gameIndex) {
  const localColor = gameIndex % 2 === 0 ? "black" : "white";
  let snapshot = createInitialState({ currentPlayer: "black", humanColor: "black", aiColor: "white" });
  const turns = [];
  const disagreements = [];
  const nearMatches = [];
  let strictAgreements = 0;
  let relaxedAgreements = 0;
  const agreementBreakdown = createAgreementBreakdown();

  while (!snapshot.gameOver && turns.length < options.maxMoves) {
    const currentPlayer = snapshot.currentPlayer;
    const rankedMoves = rankMovesStatic(snapshot, currentPlayer);
    const localChoice = chooseStrategicMove(snapshot, currentPlayer);
    const kataGoChoice = await requestKataGoMove(snapshot, currentPlayer, rankedMoves);
    const isLocalTurn = currentPlayer === localColor;
    const actualChoice = isLocalTurn ? localChoice : kataGoChoice;
    const comparison = compareChoices(snapshot, rankedMoves, localChoice, kataGoChoice);

    if (isLocalTurn) {
      agreementBreakdown[comparison.agreementType] += 1;
      if (comparison.strictlyAgreed) strictAgreements += 1;
      if (comparison.relaxedAgreement) relaxedAgreements += 1;

      if (!comparison.relaxedAgreement) {
        disagreements.push({
          turn: turns.length + 1,
          player: currentPlayer,
          local: localChoice.coord || "PASS",
          kataGo: kataGoChoice.coord || "PASS",
          agreementType: comparison.agreementType,
          metricDeltas: comparison.metricDeltas,
          localRank: comparison.localRank,
          kataGoRank: comparison.kataGoRank,
          localScore: comparison.localScore,
          kataGoScore: comparison.kataGoScore,
          scoreGap: comparison.scoreGap,
        });
      } else if (!comparison.strictlyAgreed) {
        nearMatches.push({
          turn: turns.length + 1,
          player: currentPlayer,
          local: localChoice.coord || "PASS",
          kataGo: kataGoChoice.coord || "PASS",
          agreementType: comparison.agreementType,
          localRank: comparison.localRank,
          kataGoRank: comparison.kataGoRank,
          localScore: comparison.localScore,
          kataGoScore: comparison.kataGoScore,
          scoreGap: comparison.scoreGap,
        });
      }
    }

    turns.push({
      turn: turns.length + 1,
      player: currentPlayer,
      actor: isLocalTurn ? "local" : "katago",
      played: actualChoice.coord || "PASS",
      local: localChoice.coord || "PASS",
      kataGo: kataGoChoice.coord || "PASS",
      agreed: comparison.strictlyAgreed,
      relaxedAgreed: comparison.relaxedAgreement,
      agreementType: comparison.agreementType,
    });

    snapshot = applyChoice(snapshot, currentPlayer, actualChoice).snapshot;
  }

  const estimate = estimateScore(snapshot);
  const localMargin = localColor === "black" ? estimate.margin : -estimate.margin;
  const comparedTurns = strictAgreements + disagreements.length + nearMatches.length;
  return {
    localColor,
    winner: localMargin > 0 ? "local" : localMargin < 0 ? "katago" : "draw",
    localMargin: Number(localMargin.toFixed(2)),
    agreements: strictAgreements,
    strictAgreements,
    relaxedAgreements,
    comparedTurns,
    agreementBreakdown,
    localTurns: turns.filter((turn) => turn.actor === "local").length,
    turns,
    nearMatches: nearMatches.slice(0, options.keepExamples),
    disagreements: disagreements.slice(0, options.keepExamples),
    finalEstimate: {
      black: Number(estimate.blackTotal.toFixed(2)),
      white: Number(estimate.whiteTotal.toFixed(2)),
      margin: Number(estimate.margin.toFixed(2)),
    },
  };
}

function compareChoices(snapshot, rankedMoves, localChoice, kataGoChoice) {
  const localMove = findRankedMove(rankedMoves, localChoice, snapshot.size);
  const kataGoMove = findRankedMove(rankedMoves, kataGoChoice, snapshot.size);
  const localCoord = localChoice.coord || "PASS";
  const kataGoCoord = kataGoChoice.coord || "PASS";
  const localIndex = resolveChoiceIndex(localChoice, snapshot.size);
  const kataGoIndex = resolveChoiceIndex(kataGoChoice, snapshot.size);
  const localScore = localMove ? Number(localMove.score.toFixed(2)) : null;
  const kataGoScore = kataGoMove ? Number(kataGoMove.score.toFixed(2)) : null;
  const scoreGap =
    typeof localMove?.score === "number" && typeof kataGoMove?.score === "number"
      ? Number(Math.abs(localMove.score - kataGoMove.score).toFixed(2))
      : null;

  if (localCoord === kataGoCoord) {
    return {
      strictlyAgreed: true,
      relaxedAgreement: true,
      agreementType: "exact",
      metricDeltas: {},
      localRank: localMove ? rankedMoves.indexOf(localMove) + 1 : null,
      kataGoRank: kataGoMove ? rankedMoves.indexOf(kataGoMove) + 1 : null,
      localScore,
      kataGoScore,
      scoreGap,
    };
  }

  if (areMovesSymmetryEquivalent(snapshot, localIndex, kataGoIndex)) {
    return {
      strictlyAgreed: false,
      relaxedAgreement: true,
      agreementType: "symmetry",
      metricDeltas: buildMetricDeltas(localMove, kataGoMove),
      localRank: localMove ? rankedMoves.indexOf(localMove) + 1 : null,
      kataGoRank: kataGoMove ? rankedMoves.indexOf(kataGoMove) + 1 : null,
      localScore,
      kataGoScore,
      scoreGap,
    };
  }

  if (scoreGap !== null && scoreGap <= options.scoreTolerance) {
    return {
      strictlyAgreed: false,
      relaxedAgreement: true,
      agreementType: "nearScore",
      metricDeltas: buildMetricDeltas(localMove, kataGoMove),
      localRank: localMove ? rankedMoves.indexOf(localMove) + 1 : null,
      kataGoRank: kataGoMove ? rankedMoves.indexOf(kataGoMove) + 1 : null,
      localScore,
      kataGoScore,
      scoreGap,
    };
  }

  return {
    strictlyAgreed: false,
    relaxedAgreement: false,
    agreementType: "mismatch",
    metricDeltas: buildMetricDeltas(localMove, kataGoMove),
    localRank: localMove ? rankedMoves.indexOf(localMove) + 1 : null,
    kataGoRank: kataGoMove ? rankedMoves.indexOf(kataGoMove) + 1 : null,
    localScore,
    kataGoScore,
    scoreGap,
  };
}

async function requestKataGoMove(snapshot, playerColor, rankedMoves) {
  if (!rankedMoves.length) {
    return { type: "pass", coord: null, explanation: "No legal move." };
  }

  const query = createKataGoAnalysisQuery(snapshot, playerColor, rankedMoves);
  const analysis = await kataGoEngine.analyze(query, { timeoutMs: options.timeoutMs });
  const moveInfos = Array.isArray(analysis.moveInfos)
    ? [...analysis.moveInfos].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    : [];
  const allowedMoves = new Set(query.allowMoves[0].moves.map((move) => normalizeEngineMove(move)));
  const allowedMoveInfos = moveInfos.filter((moveInfo) => allowedMoves.has(normalizeEngineMove(moveInfo.move)));
  const bestMove = (allowedMoveInfos.length ? allowedMoveInfos : moveInfos)[0] || null;
  const normalizedMove = normalizeEngineMove(bestMove?.move);

  if (!normalizedMove || normalizedMove === "PASS") {
    return { type: "pass", coord: null, explanation: "KataGo prefers pass here." };
  }

  return { type: "move", coord: normalizedMove, explanation: `KataGo prefers ${normalizedMove}.` };
}

function createKataGoAnalysisQuery(snapshot, playerColor, rankedMoves) {
  const moves = getMoveSequenceForApi(snapshot);
  const query = {
    id: createRequestId("trainer"),
    moves,
    rules: process.env.BOARD_RULES || "chinese",
    komi: parseFloatOr(process.env.BOARD_KOMI, 5.5),
    boardXSize: snapshot.size,
    boardYSize: snapshot.size,
    maxVisits: options.maxVisits,
    analysisPVLen: 6,
    allowMoves: [
      {
        player: toEngineColor(playerColor),
        moves: [...rankedMoves.map((move) => move.coord.toUpperCase()), "pass"],
        untilDepth: 1,
      },
    ],
  };

  if (!moves.length) {
    query.initialStones = buildInitialStonesFromBoardRows(getBoardRows(snapshot), snapshot.size);
    query.initialPlayer = toEngineColor(playerColor);
  }

  return query;
}

function createSummary() {
  const metricStats = {};
  for (const spec of HEURISTIC_METRIC_SPECS) {
    metricStats[spec.key] = { sum: 0, count: 0, label: spec.label };
  }
  return {
    localWins: 0,
    kataGoWins: 0,
    draws: 0,
    totalLocalTurns: 0,
    totalComparedTurns: 0,
    strictAgreements: 0,
    relaxedAgreements: 0,
    agreementBreakdown: createAgreementBreakdown(),
    metricStats,
    games: [],
  };
}

function createAgreementBreakdown() {
  return {
    exact: 0,
    symmetry: 0,
    nearScore: 0,
    mismatch: 0,
  };
}

function accumulateAgreementBreakdown(target, source) {
  for (const key of Object.keys(target)) {
    target[key] += Number(source?.[key] || 0);
  }
}

function accumulateDisagreement(metricStats, deltas) {
  for (const [key, value] of Object.entries(deltas)) {
    if (!metricStats[key] || !Number.isFinite(value)) continue;
    metricStats[key].sum += value;
    metricStats[key].count += 1;
  }
}

function buildMetricDeltas(localMove, kataGoMove) {
  const metricDeltas = {};
  for (const spec of HEURISTIC_METRIC_SPECS) {
    const localValue = Number(localMove?.metrics?.[spec.key] || 0);
    const kataGoValue = Number(kataGoMove?.metrics?.[spec.key] || 0);
    const adjustedGap = spec.better === "lower" ? localValue - kataGoValue : kataGoValue - localValue;
    metricDeltas[spec.key] = Number(adjustedGap.toFixed(4));
  }
  return metricDeltas;
}

function summarizeMetricStats(metricStats) {
  return Object.entries(metricStats)
    .map(([key, stat]) => ({
      key,
      label: stat.label,
      average: stat.count > 0 ? stat.sum / stat.count : 0,
      count: stat.count,
    }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => Math.abs(b.average) - Math.abs(a.average))
    .slice(0, 6)
    .map((entry) => ({
      ...entry,
      summary:
        entry.average >= 0
          ? `KataGo tends to want more ${entry.label} (avg +${entry.average.toFixed(2)})`
          : `Local heuristic currently overvalues ${entry.label} (avg ${entry.average.toFixed(2)})`,
    }));
}

function areMovesSymmetryEquivalent(snapshot, localIndex, kataGoIndex) {
  if (!Number.isInteger(localIndex) || !Number.isInteger(kataGoIndex)) {
    return false;
  }

  return getInvariantTransforms(snapshot).some(
    (transformName) => transformIndex(localIndex, snapshot.size, transformName) === kataGoIndex
  );
}

function getInvariantTransforms(snapshot) {
  const transforms = [
    "identity",
    "rotate90",
    "rotate180",
    "rotate270",
    "flipHorizontal",
    "flipVertical",
    "flipMainDiagonal",
    "flipAntiDiagonal",
  ];

  return transforms.filter((transformName) =>
    snapshot.board.every(
      (stone, index) =>
        stone === snapshot.board[transformIndex(index, snapshot.size, transformName)]
    )
  );
}

function transformIndex(index, size, transformName) {
  const row = Math.floor(index / size);
  const col = index % size;
  let targetRow = row;
  let targetCol = col;

  switch (transformName) {
    case "rotate90":
      targetRow = col;
      targetCol = size - 1 - row;
      break;
    case "rotate180":
      targetRow = size - 1 - row;
      targetCol = size - 1 - col;
      break;
    case "rotate270":
      targetRow = size - 1 - col;
      targetCol = row;
      break;
    case "flipHorizontal":
      targetRow = size - 1 - row;
      targetCol = col;
      break;
    case "flipVertical":
      targetRow = row;
      targetCol = size - 1 - col;
      break;
    case "flipMainDiagonal":
      targetRow = col;
      targetCol = row;
      break;
    case "flipAntiDiagonal":
      targetRow = size - 1 - col;
      targetCol = size - 1 - row;
      break;
    default:
      break;
  }

  return targetRow * size + targetCol;
}

function buildInitialStonesFromBoardRows(boardRows, size) {
  const stones = [];
  boardRows.forEach((rowLine, rowIndex) => {
    if (typeof rowLine !== "string") return;
    const match = rowLine.match(/:\s*([BW.]+)/i);
    const line = match ? match[1].trim().toUpperCase() : "";
    for (let col = 0; col < Math.min(line.length, size); col += 1) {
      const stone = line[col];
      if (stone === "B" || stone === "W") {
        stones.push([stone, `${indexToColumn(col)}${size - rowIndex}`]);
      }
    }
  });
  return stones;
}

function toEngineColor(color) {
  if (color === "black" || color === "B") return "B";
  if (color === "white" || color === "W") return "W";
  return null;
}

function normalizeEngineMove(move) {
  if (typeof move !== "string") return null;
  const normalized = move.trim().toUpperCase();
  if (!normalized) return null;
  return normalized === "PASS" ? "PASS" : normalized;
}

function indexToColumn(index) {
  const baseLabels = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
  if (index < baseLabels.length) return baseLabels[index];
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

function createRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createTimestamp() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
}

function parseArgs(args) {
  return {
    games: parseIntegerArg(args, "--games", 2),
    maxMoves: parseIntegerArg(args, "--max-moves", 120),
    maxVisits: parseIntegerArg(args, "--max-visits", parseFloatOr(process.env.KATAGO_MAX_VISITS, 120)),
    timeoutMs: parseIntegerArg(args, "--timeout-ms", parseFloatOr(process.env.KATAGO_TIMEOUT_MS, 12000)),
    keepExamples: parseIntegerArg(args, "--keep-examples", 20),
    scoreTolerance: parseFloatArg(args, "--score-tolerance", 0.45),
  };
}

function parseIntegerArg(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return fallback;
  const parsed = Number.parseInt(args[index + 1], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatArg(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) return fallback;
  const parsed = Number.parseFloat(args[index + 1]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function formatSigned(value) {
  return value >= 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}
