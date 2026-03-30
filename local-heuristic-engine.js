export const BOARD_SIZE = 9;
export const WHITE_KOMI = 5.5;
export const COLUMN_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "J"];
export const STAR_POINTS = new Set([20, 24, 40, 56, 60]);

export const HEURISTIC_METRIC_SPECS = [
  { key: "captured", better: "higher", label: "capture pressure" },
  { key: "selfLiberties", better: "higher", label: "self liberties" },
  { key: "territoryDelta", better: "higher", label: "territory swing" },
  { key: "pressureBonus", better: "higher", label: "enemy pressure" },
  { key: "escapeBonus", better: "higher", label: "escape support" },
  { key: "eyeBonus", better: "higher", label: "eye shape" },
  { key: "lifeDeathBonus", better: "higher", label: "life-and-death swing" },
  { key: "connectionBonus", better: "higher", label: "connection value" },
  { key: "attackUrgencyBonus", better: "higher", label: "attack urgency" },
  { key: "defenseUrgencyBonus", better: "higher", label: "defense urgency" },
  { key: "opponentAtariCount", better: "higher", label: "atari count" },
  { key: "boardDelta", better: "higher", label: "board evaluation" },
  { key: "libertySwing", better: "higher", label: "liberty swing" },
  { key: "cutBonus", better: "higher", label: "cut potential" },
  { key: "openSpaceBonus", better: "higher", label: "open-space growth" },
  { key: "crowdingPenalty", better: "lower", label: "crowding penalty" },
  { key: "cleanupPressurePenalty", better: "lower", label: "cleanup chase penalty" },
  { key: "futileDefensePenalty", better: "lower", label: "futile defense penalty" },
  { key: "territoryFillPenalty", better: "lower", label: "territory-fill penalty" },
];

export function createInitialState(options = {}) {
  const size = Number.isInteger(options.size) ? options.size : BOARD_SIZE;
  const board = Array(size * size).fill(null);
  return {
    size,
    board,
    currentPlayer: options.currentPlayer || "black",
    humanColor: options.humanColor || "black",
    aiColor: options.aiColor || "white",
    captures: { black: 0, white: 0 },
    turn: 1,
    boardHash: hashBoard(board),
    previousBoardHash: null,
    lastMove: null,
    recommendedMove: null,
    consecutivePasses: 0,
    gameOver: false,
    winnerText: "",
    moveLog: [],
    scoring: { active: false, finalized: false, deadStones: [] },
  };
}

export function otherColor(color) {
  return color === "black" ? "white" : "black";
}

export function hashBoard(board) {
  return board.map((stone) => (stone ? stone[0] : ".")).join("");
}

export function indexToCoord(index, size = BOARD_SIZE) {
  const row = Math.floor(index / size);
  const col = index % size;
  return `${COLUMN_LABELS[col]}${size - row}`;
}

export function coordToIndex(coord, size = BOARD_SIZE) {
  if (typeof coord !== "string" || coord.length < 2) {
    return null;
  }

  const normalized = coord.trim().toUpperCase();
  const column = normalized[0];
  const rowValue = Number(normalized.slice(1));
  const col = COLUMN_LABELS.indexOf(column);

  if (col === -1 || Number.isNaN(rowValue) || rowValue < 1 || rowValue > size) {
    return null;
  }

  return (size - rowValue) * size + col;
}

export function getNeighbors(index, size = BOARD_SIZE) {
  const row = Math.floor(index / size);
  const col = index % size;
  const neighbors = [];
  if (row > 0) neighbors.push(index - size);
  if (row < size - 1) neighbors.push(index + size);
  if (col > 0) neighbors.push(index - 1);
  if (col < size - 1) neighbors.push(index + 1);
  return neighbors;
}

export function getGroup(board, startIndex, size = BOARD_SIZE) {
  const color = board[startIndex];
  if (!color) return null;
  const stones = [];
  const liberties = new Set();
  const visited = new Set([startIndex]);
  const stack = [startIndex];

  while (stack.length) {
    const current = stack.pop();
    stones.push(current);
    for (const neighbor of getNeighbors(current, size)) {
      const occupant = board[neighbor];
      if (!occupant) {
        liberties.add(neighbor);
        continue;
      }
      if (occupant === color && !visited.has(neighbor)) {
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
  }

  return { color, stones, liberties, anchor: stones[0] };
}

export function collectGroups(board, size = BOARD_SIZE) {
  const groups = [];
  const visited = new Set();
  board.forEach((stone, index) => {
    if (!stone || visited.has(index)) return;
    const group = getGroup(board, index, size);
    group.stones.forEach((member) => visited.add(member));
    groups.push(group);
  });
  return groups;
}

export const GROUP_STATUS_SCORES = {
  dead: -2,
  critical: -1,
  unsettled: 0,
  stable: 1,
  alive: 2,
};

export function getDiagonalNeighbors(index, size = BOARD_SIZE) {
  const row = Math.floor(index / size);
  const col = index % size;
  const neighbors = [];
  if (row > 0 && col > 0) neighbors.push(index - size - 1);
  if (row > 0 && col < size - 1) neighbors.push(index - size + 1);
  if (row < size - 1 && col > 0) neighbors.push(index + size - 1);
  if (row < size - 1 && col < size - 1) neighbors.push(index + size + 1);
  return neighbors;
}

export function collectEmptyRegion(board, startIndex, size = BOARD_SIZE) {
  if (board[startIndex]) {
    return { points: [], borderColors: new Set() };
  }

  const visited = new Set([startIndex]);
  const stack = [startIndex];
  const points = [];
  const borderColors = new Set();

  while (stack.length) {
    const current = stack.pop();
    points.push(current);

    for (const neighbor of getNeighbors(current, size)) {
      const occupant = board[neighbor];
      if (!occupant) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
        continue;
      }
      borderColors.add(occupant);
    }
  }

  return { points, borderColors };
}

export function isSinglePointTrueEye(board, index, color, size = BOARD_SIZE) {
  if (board[index]) return false;

  for (const neighbor of getNeighbors(index, size)) {
    if (board[neighbor] !== color) return false;
  }

  const row = Math.floor(index / size);
  const col = index % size;
  const diagonalNeighbors = getDiagonalNeighbors(index, size);
  let offboardDiagonalCount = 0;
  if (row === 0) offboardDiagonalCount += 2;
  if (row === size - 1) offboardDiagonalCount += 2;
  if (col === 0) offboardDiagonalCount += 2;
  if (col === size - 1) offboardDiagonalCount += 2;
  if ((row === 0 || row === size - 1) && (col === 0 || col === size - 1)) {
    offboardDiagonalCount -= 1;
  }

  const supportiveCorners =
    offboardDiagonalCount + diagonalNeighbors.filter((neighbor) => board[neighbor] === color).length;
  const requiredSupport = offboardDiagonalCount > 0 ? 4 : 3;
  return supportiveCorners >= requiredSupport;
}

export function getEyePotentialForRegionSize(regionSize) {
  if (regionSize <= 1) return 0.45;
  if (regionSize === 2) return 0.95;
  if (regionSize === 3) return 1.2;
  return 1.45;
}

export function getGroupStatusScore(status) {
  return GROUP_STATUS_SCORES[status] ?? 0;
}

export function analyzeGroupLife(board, group, size = BOARD_SIZE) {
  const visitedLibertyRegions = new Set();
  let eyeCount = 0;
  let eyePotential = 0;
  let falseEyeCount = 0;
  let enclosedRegionCount = 0;
  let externalRegionCount = 0;
  let maxExternalRegionSize = 0;
  let sharedLibertySpan = 0;

  group.liberties.forEach((libertyIndex) => {
    if (visitedLibertyRegions.has(libertyIndex)) return;
    const region = collectEmptyRegion(board, libertyIndex, size);
    region.points.forEach((point) => visitedLibertyRegions.add(point));
    const touchingPoints = region.points.filter((point) =>
      getNeighbors(point, size).some((neighbor) => board[neighbor] === group.color)
    ).length;

    if (region.borderColors.size !== 1 || !region.borderColors.has(group.color)) {
      externalRegionCount += 1;
      maxExternalRegionSize = Math.max(maxExternalRegionSize, region.points.length);
      sharedLibertySpan = Math.max(sharedLibertySpan, touchingPoints);
      return;
    }

    enclosedRegionCount += 1;
    if (region.points.length === 1) {
      const point = region.points[0];
      if (isSinglePointTrueEye(board, point, group.color, size)) {
        eyeCount += 1;
        eyePotential += 1;
      } else {
        falseEyeCount += 1;
        eyePotential += getEyePotentialForRegionSize(region.points.length);
      }
      return;
    }

    eyePotential += getEyePotentialForRegionSize(region.points.length);
  });

  const libertyCount = group.liberties.size;
  const strongRunway =
    libertyCount >= 3 &&
    group.stones.length >= 3 &&
    maxExternalRegionSize >= 6 &&
    sharedLibertySpan >= 3;
  let status = "unsettled";

  if (eyeCount >= 2) {
    status = "alive";
  } else if (eyeCount >= 1 && eyePotential >= 1.9 && libertyCount >= 3) {
    status = "alive";
  } else if (eyePotential >= 2.35 && libertyCount >= 4) {
    status = "alive";
  } else if (eyeCount >= 1 && libertyCount >= 3) {
    status = "stable";
  } else if (eyePotential >= 1.25 && libertyCount >= 4) {
    status = "stable";
  } else if (libertyCount <= 1 && eyePotential < 0.9) {
    status = "dead";
  } else if (libertyCount <= 2 && eyePotential < 1.05) {
    status = "dead";
  } else if (libertyCount <= 3 && eyePotential < 1.35 && !strongRunway) {
    status = "critical";
  } else if (libertyCount <= 2 && falseEyeCount > 0 && eyeCount === 0) {
    status = "critical";
  } else if (strongRunway) {
    status = eyeCount > 0 || eyePotential >= 0.45 ? "stable" : "unsettled";
  }

  const stability =
    libertyCount * 0.7 +
    eyeCount * 2.2 +
    eyePotential * 3.4 -
    falseEyeCount * 1.6 +
    Math.min(maxExternalRegionSize, 8) * 0.18 +
    sharedLibertySpan * 0.65;

  return {
    libertyCount,
    eyeCount,
    eyePotential: Number(eyePotential.toFixed(3)),
    falseEyeCount,
    enclosedRegionCount,
    externalRegionCount,
    maxExternalRegionSize,
    sharedLibertySpan,
    status,
    stability: Number(stability.toFixed(3)),
  };
}

export function summarizeLifeAndDeath(snapshot) {
  const groups = collectGroups(snapshot.board, snapshot.size).map((group) => {
    const life = analyzeGroupLife(snapshot.board, group, snapshot.size);
    return {
      color: group.color,
      size: group.stones.length,
      anchor: group.anchor,
      ...life,
    };
  });

  return {
    groups,
    unresolvedGroups: groups.filter(
      (group) => group.status === "critical" || group.status === "unsettled"
    ).length,
    clearlyDeadGroups: groups.filter((group) => group.status === "dead").length,
  };
}

export function getGroupUrgencyMultiplier(status) {
  switch (status) {
    case "dead":
      return 0.12;
    case "critical":
      return 1.55;
    case "unsettled":
      return 1.18;
    case "stable":
      return 0.7;
    case "alive":
      return 0.38;
    default:
      return 1;
  }
}

export function getLifeStatusTransitionBonus(beforeStatus, afterStatus, groupSize, isFriendly) {
  const before = getGroupStatusScore(beforeStatus);
  const after = getGroupStatusScore(afterStatus);
  const delta = after - before;
  if (!delta) return 0;
  const scale = 2.8 + Math.min(groupSize, 8) * 0.95;
  return (isFriendly ? delta : -delta) * scale;
}

export function simulateMove(board, size, index, color, koReferenceHash) {
  if (index === null) {
    return { legal: true, isPass: true, board: board.slice(), hash: hashBoard(board), captured: [] };
  }
  if (board[index]) {
    return { legal: false, reason: "occupied" };
  }

  const working = board.slice();
  const capturedSet = new Set();
  working[index] = color;

  for (const neighbor of getNeighbors(index, size)) {
    if (working[neighbor] !== otherColor(color)) continue;
    const enemyGroup = getGroup(working, neighbor, size);
    if (enemyGroup.liberties.size === 0) {
      enemyGroup.stones.forEach((stoneIndex) => capturedSet.add(stoneIndex));
    }
  }

  capturedSet.forEach((stoneIndex) => {
    working[stoneIndex] = null;
  });

  const selfGroup = getGroup(working, index, size);
  if (!selfGroup || selfGroup.liberties.size === 0) {
    return { legal: false, reason: "suicide" };
  }

  const nextHash = hashBoard(working);
  if (koReferenceHash && nextHash === koReferenceHash) {
    return { legal: false, reason: "ko" };
  }

  return {
    legal: true,
    isPass: false,
    board: working,
    hash: nextHash,
    captured: Array.from(capturedSet),
    selfGroup,
  };
}

export function estimateScore(snapshot) {
  const visited = new Set();
  let blackStones = 0;
  let whiteStones = 0;
  let blackTerritory = 0;
  let whiteTerritory = 0;

  snapshot.board.forEach((stone) => {
    if (stone === "black") blackStones += 1;
    if (stone === "white") whiteStones += 1;
  });

  snapshot.board.forEach((stone, index) => {
    if (stone || visited.has(index)) return;
    const queue = [index];
    const region = [];
    const borders = new Set();
    visited.add(index);

    while (queue.length) {
      const current = queue.pop();
      region.push(current);
      for (const neighbor of getNeighbors(current, snapshot.size)) {
        const occupant = snapshot.board[neighbor];
        if (!occupant && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
          continue;
        }
        if (occupant) borders.add(occupant);
      }
    }

    if (borders.size === 1) {
      const [owner] = Array.from(borders);
      if (owner === "black") blackTerritory += region.length;
      else whiteTerritory += region.length;
    }
  });

  const blackTotal = blackStones + blackTerritory;
  const whiteTotal = whiteStones + whiteTerritory + WHITE_KOMI;
  return { blackStones, whiteStones, blackTerritory, whiteTerritory, blackTotal, whiteTotal, margin: blackTotal - whiteTotal };
}

export function listLegalMoves(snapshot, color) {
  const legalMoves = [];
  snapshot.board.forEach((stone, index) => {
    if (stone) return;
    const result = simulateMove(snapshot.board, snapshot.size, index, color, snapshot.previousBoardHash);
    if (result.legal) legalMoves.push({ index, result });
  });
  return legalMoves;
}

export function countEmptyPoints(snapshot) {
  let emptyCount = 0;
  snapshot.board.forEach((stone) => {
    if (!stone) emptyCount += 1;
  });
  return emptyCount;
}

export function createSnapshotAfterMove(snapshot, color, moveResult, index) {
  const capturedCount = moveResult.captured.length;
  const consecutivePasses = moveResult.isPass ? snapshot.consecutivePasses + 1 : 0;
  return {
    ...snapshot,
    board: moveResult.board,
    boardHash: moveResult.hash,
    previousBoardHash: snapshot.boardHash,
    currentPlayer: otherColor(color),
    captures: { ...snapshot.captures, [color]: snapshot.captures[color] + capturedCount },
    turn: snapshot.turn + 1,
    consecutivePasses,
    gameOver: consecutivePasses >= 2,
    lastMove: moveResult.isPass
      ? { isPass: true, color }
      : { isPass: false, color, index, coord: indexToCoord(index, snapshot.size) },
  };
}

export function evaluateGroupValue(group, life) {
  const liberties = group.liberties.size;
  const size = group.stones.length;
  let value = size * 3.2;

  if (liberties === 1) value -= 10 + size * 3.4;
  else if (liberties === 2) value -= 4.6 + size * 1.7;
  else if (liberties === 3) value += 1.4 + size * 0.35;
  else value += Math.min(liberties, 6) * 1.8;

  value += life.eyeCount * 9.5;
  value += life.eyePotential * 4.4;
  value -= life.falseEyeCount * 2.8;

  if (life.status === "alive") value += 11 + Math.min(life.libertyCount, 5) * 1.4;
  else if (life.status === "stable") value += 4.8;
  else if (life.status === "critical") value -= 10 + size * 2.4;
  else if (life.status === "dead") value -= 19 + size * 4.2;

  return value;
}

export function getBoundedMargin(snapshot, perspectiveColor, estimate = estimateScore(snapshot)) {
  const rawMargin = perspectiveColor === "black" ? estimate.margin : -estimate.margin;
  const emptyCount = countEmptyPoints(snapshot);
  const clamp = emptyCount > 60 ? 3.5 : emptyCount > 45 ? 6 : emptyCount > 25 ? 10 : 20;
  return Math.max(-clamp, Math.min(clamp, rawMargin));
}

export function evaluateBoard(snapshot, perspectiveColor) {
  const estimate = estimateScore(snapshot);
  const scoreMargin = getBoundedMargin(snapshot, perspectiveColor, estimate);
  const captureMargin = snapshot.captures[perspectiveColor] - snapshot.captures[otherColor(perspectiveColor)];
  const emptyCount = countEmptyPoints(snapshot);
  const territoryWeight = emptyCount > 50 ? 4.8 : emptyCount > 28 ? 7.2 : 10.2;
  let groupScore = 0;
  let tacticalScore = 0;

  for (const group of collectGroups(snapshot.board, snapshot.size)) {
    const sign = group.color === perspectiveColor ? 1 : -1;
    const liberties = group.liberties.size;
    const ownGroup = group.color === perspectiveColor;
    const life = analyzeGroupLife(snapshot.board, group, snapshot.size);
    groupScore += sign * evaluateGroupValue(group, life);
    if (liberties === 1) tacticalScore += ownGroup ? -16 : 7;
    else if (liberties === 2) tacticalScore += ownGroup ? -5 : 2;
    if (life.status === "critical") tacticalScore += ownGroup ? -11 : 10;
    else if (life.status === "dead") tacticalScore += ownGroup ? -17 : 15;
    else if (life.status === "alive" && life.eyeCount >= 2) tacticalScore += ownGroup ? 4.5 : -4.5;
  }

  return scoreMargin * territoryWeight + captureMargin * 6.8 + groupScore + tacticalScore;
}

export function collectUrgentMoveMap(snapshot, color) {
  const urgentMap = new Map();
  for (const group of collectGroups(snapshot.board, snapshot.size)) {
    const libertyCount = group.liberties.size;
    if (libertyCount > 3) continue;
    const life = analyzeGroupLife(snapshot.board, group, snapshot.size);
    const severity =
      (libertyCount === 1 ? 18 + group.stones.length * 2.5 : libertyCount === 2 ? 9 + group.stones.length * 1.8 : 3 + group.stones.length * 0.7) *
      getGroupUrgencyMultiplier(life.status);
    group.liberties.forEach((libertyIndex) => {
      const entry = urgentMap.get(libertyIndex) || { attack: 0, defense: 0 };
      if (group.color === color) entry.defense += severity;
      else entry.attack += severity;
      urgentMap.set(libertyIndex, entry);
    });
  }
  return urgentMap;
}

export function getPositionalMoveBonus(snapshot, index, emptyCount) {
  const row = Math.floor(index / snapshot.size);
  const col = index % snapshot.size;
  const edgeDistance = Math.min(row, col, snapshot.size - 1 - row, snapshot.size - 1 - col);

  if (emptyCount >= 66) {
    if (index === 40) return 2.6;
    if (STAR_POINTS.has(index)) return 2.2;
    if (edgeDistance === 3) return 2.9;
    if (edgeDistance === 2) return 1.8;
    if (edgeDistance === 1) return 0.5;
    if (edgeDistance === 0) return -1.6;
    return 1.4;
  }

  if (emptyCount >= 42) {
    if (index === 40) return 2.4;
    if (STAR_POINTS.has(index)) return 2.1;
    if (edgeDistance === 3) return 2.3;
    if (edgeDistance === 2) return 1.8;
    if (edgeDistance === 1) return 0.9;
    if (edgeDistance === 0) return -1.1;
    return 1.1;
  }

  if (edgeDistance === 0) return -0.8;
  if (edgeDistance === 1) return 0.6;
  if (edgeDistance === 2) return 1.2;
  return 0.9;
}

export function getOpenSpaceBonus(snapshot, index, color, emptyCount) {
  const row = Math.floor(index / snapshot.size);
  const col = index % snapshot.size;
  let emptyNearby = 0;
  let friendlyNearby = 0;
  let enemyNearby = 0;

  for (let target = 0; target < snapshot.board.length; target += 1) {
    if (target === index) continue;
    const targetRow = Math.floor(target / snapshot.size);
    const targetCol = target % snapshot.size;
    const distance = Math.abs(targetRow - row) + Math.abs(targetCol - col);
    if (distance === 0 || distance > 2) continue;
    const weight = distance === 1 ? 1 : 0.55;
    const occupant = snapshot.board[target];
    if (!occupant) emptyNearby += weight;
    else if (occupant === color) friendlyNearby += weight;
    else enemyNearby += weight;
  }

  const openSpaceProfile = getOpenSpaceProfile(emptyCount);
  return (
    emptyNearby * openSpaceProfile.stageWeight +
    enemyNearby * openSpaceProfile.enemyWeight -
    Math.max(0, friendlyNearby - 1.2) * openSpaceProfile.friendlyPenaltyWeight
  );
}

export function getOpenSpaceProfile(emptyCount) {
  if (emptyCount >= 52) {
    return {
      stageWeight: 0.46,
      enemyWeight: 0.5,
      friendlyPenaltyWeight: 0.78,
    };
  }

  if (emptyCount >= 28) {
    return {
      stageWeight: 0.3,
      enemyWeight: 0.5,
      friendlyPenaltyWeight: 0.6,
    };
  }

  return {
    stageWeight: 0.1,
    enemyWeight: 0.42,
    friendlyPenaltyWeight: 0.52,
  };
}

export function getMoveWeightProfile(emptyCount) {
  if (emptyCount >= 66) {
    return {
      boardDeltaWeight: 0.2,
      selfLibertyWeight: 0.52,
      territoryDeltaWeight: 1.8,
      defenseUrgencyWeight: 0.66,
      libertySwingWeight: 0.78,
      eyeBonusWeight: 0.24,
      lifeDeathWeight: 0.28,
      openSpaceWeight: 1.7,
      cleanupPenaltyWeight: 1.15,
      futileDefenseWeight: 1,
      boardDeltaCap: 9,
      selfLibertyCap: 3.5,
      libertySwingCap: 0.6,
    };
  }

  if (emptyCount >= 42) {
    return {
      boardDeltaWeight: 0.48,
      selfLibertyWeight: 0.74,
      territoryDeltaWeight: 2.25,
      defenseUrgencyWeight: 0.84,
      libertySwingWeight: 1.2,
      eyeBonusWeight: 0.48,
      lifeDeathWeight: 0.62,
      openSpaceWeight: 1.38,
      cleanupPenaltyWeight: 1.1,
      futileDefenseWeight: 1,
      boardDeltaCap: 12,
      selfLibertyCap: 4,
      libertySwingCap: 1.2,
    };
  }

  return {
    boardDeltaWeight: 1.08,
    selfLibertyWeight: 0.98,
    territoryDeltaWeight: 2.7,
    defenseUrgencyWeight: 1,
    libertySwingWeight: 1.75,
    eyeBonusWeight: 0.92,
    lifeDeathWeight: 1.02,
    openSpaceWeight: 1.02,
    cleanupPenaltyWeight: 1,
    futileDefenseWeight: 1,
    boardDeltaCap: Infinity,
    selfLibertyCap: Infinity,
    libertySwingCap: Infinity,
  };
}

export function createMoveEvaluationContext(snapshot, color) {
  return {
    beforeEstimate: estimateScore(snapshot),
    baselineScore: evaluateBoard(snapshot, color),
    urgentMoves: collectUrgentMoveMap(snapshot, color),
    emptyCount: countEmptyPoints(snapshot),
  };
}

export function evaluateMove(snapshot, index, moveResult, color, context = {}) {
  const beforeEstimate = context.beforeEstimate || estimateScore(snapshot);
  const baselineScore = typeof context.baselineScore === "number" ? context.baselineScore : evaluateBoard(snapshot, color);
  const urgentEntry = context.urgentMoves?.get(index) || { attack: 0, defense: 0 };
  const emptyCount = typeof context.emptyCount === "number" ? context.emptyCount : countEmptyPoints(snapshot);
  const nextSnapshot = createSnapshotAfterMove(snapshot, color, moveResult, index);
  const afterEstimate = estimateScore(nextSnapshot);
  const boardScore = evaluateBoard(nextSnapshot, color);
  const boardDelta = boardScore - baselineScore;
  const beforeMargin = getBoundedMargin(snapshot, color, beforeEstimate);
  const afterMargin = getBoundedMargin(nextSnapshot, color, afterEstimate);
  const territoryDelta = afterMargin - beforeMargin;
  const selfLiberties = moveResult.selfGroup.liberties.size;
  const adjacentFriendRoots = new Set();
  const adjacentEnemyRoots = new Set();
  const adjacentOccupiedCount = getNeighbors(index, snapshot.size).filter((neighbor) => snapshot.board[neighbor]).length;
  const openSpaceBonus = getOpenSpaceBonus(snapshot, index, color, emptyCount);
  let pressureBonus = 0;
  let escapeBonus = 0;
  let eyeBonus = 0;
  let lifeDeathBonus = 0;
  let opponentAtariCount = 0;
  let libertySwing = 0;
  let cleanupPressurePenalty = 0;
  let futileDefensePenalty = 0;

  for (const neighbor of getNeighbors(index, snapshot.size)) {
    const occupant = snapshot.board[neighbor];

    if (occupant === color) {
      const friendlyGroup = getGroup(snapshot.board, neighbor, snapshot.size);
      if (adjacentFriendRoots.has(friendlyGroup.anchor)) continue;
      adjacentFriendRoots.add(friendlyGroup.anchor);
      const friendlyLifeBefore = analyzeGroupLife(snapshot.board, friendlyGroup, snapshot.size);
      const friendlyGroupAfter = getGroup(nextSnapshot.board, neighbor, snapshot.size);
      if (friendlyGroup.liberties.size <= 2 && selfLiberties >= 3) escapeBonus += 3.2;
      if (friendlyGroupAfter) {
        const friendlyLifeAfter = analyzeGroupLife(nextSnapshot.board, friendlyGroupAfter, snapshot.size);
        libertySwing += Math.max(0, friendlyGroupAfter.liberties.size - friendlyGroup.liberties.size) * 0.7;
        eyeBonus += Math.max(0, friendlyLifeAfter.eyePotential - friendlyLifeBefore.eyePotential) * 4.1;
        lifeDeathBonus += getLifeStatusTransitionBonus(
          friendlyLifeBefore.status,
          friendlyLifeAfter.status,
          friendlyGroup.stones.length,
          true
        );
        if (friendlyLifeBefore.status === "dead" && friendlyLifeAfter.status === "dead") {
          futileDefensePenalty += 3.6 + friendlyGroup.stones.length * 0.8;
        }
        if (
          friendlyLifeBefore.status === "critical" &&
          (friendlyLifeAfter.status === "stable" || friendlyLifeAfter.status === "alive")
        ) {
          escapeBonus += 4.4;
        }
      }
    }

    if (occupant === otherColor(color)) {
      const enemyGroupBefore = getGroup(snapshot.board, neighbor, snapshot.size);
      if (adjacentEnemyRoots.has(enemyGroupBefore.anchor)) continue;
      adjacentEnemyRoots.add(enemyGroupBefore.anchor);
      const enemyLifeBefore = analyzeGroupLife(snapshot.board, enemyGroupBefore, snapshot.size);
      const enemyGroupAfter = nextSnapshot.board[neighbor] === otherColor(color) ? getGroup(nextSnapshot.board, neighbor, snapshot.size) : null;

      if (!enemyGroupAfter) {
        pressureBonus += 6 + enemyGroupBefore.stones.length * 1.4;
        libertySwing += Math.max(2.5, enemyGroupBefore.liberties.size * 1.2);
        eyeBonus += enemyLifeBefore.eyePotential * 2.8;
        lifeDeathBonus += getLifeStatusTransitionBonus(enemyLifeBefore.status, "dead", enemyGroupBefore.stones.length, false);
        continue;
      }

      const enemyLifeAfter = analyzeGroupLife(nextSnapshot.board, enemyGroupAfter, snapshot.size);
      libertySwing += Math.max(0, enemyGroupBefore.liberties.size - enemyGroupAfter.liberties.size) * 0.95;
      eyeBonus += Math.max(0, enemyLifeBefore.eyePotential - enemyLifeAfter.eyePotential) * 3.6;
      lifeDeathBonus += getLifeStatusTransitionBonus(
        enemyLifeBefore.status,
        enemyLifeAfter.status,
        enemyGroupBefore.stones.length,
        false
      );
      if (enemyLifeBefore.status === "dead" && enemyLifeAfter.status === "dead" && moveResult.captured.length === 0) {
        cleanupPressurePenalty += 3.2 + enemyGroupBefore.stones.length * 0.55;
      }
      if (
        (enemyLifeBefore.status === "stable" || enemyLifeBefore.status === "alive") &&
        enemyLifeAfter.status === "critical"
      ) {
        pressureBonus += 3.8;
      }
      if (enemyGroupAfter.liberties.size === 1) {
        opponentAtariCount += 1;
        pressureBonus += 5.4 + enemyGroupAfter.stones.length * 1.1;
      } else if (enemyGroupAfter.liberties.size === 2) {
        pressureBonus += 2.6;
      }
    }
  }

  const connectionBonus = Math.max(0, adjacentFriendRoots.size - 1) * 3.1;
  const positionalBonus = getPositionalMoveBonus(snapshot, index, emptyCount);
  const cutBonus = adjacentEnemyRoots.size >= 2 ? Math.max(0, 3.4 + (adjacentEnemyRoots.size - 2) * 1.1 - Math.max(0, adjacentFriendRoots.size - 1) * 0.6) : 0;
  const contactPenalty = adjacentOccupiedCount === 0 ? emptyCount >= 60 ? 0 : emptyCount >= 36 ? 0.8 : 2.1 : 0;
  const selfAtariPenalty = selfLiberties === 1 ? Math.max(0, 19 - moveResult.captured.length * 5) : 0;
  const crowdingPenalty = adjacentEnemyRoots.size === 0 && adjacentFriendRoots.size >= 2 && openSpaceBonus <= 1.8 ? 1.9 + (adjacentFriendRoots.size - 2) * 0.7 : 0;
  const territoryFillPenalty =
    emptyCount <= 22 &&
    adjacentEnemyRoots.size === 0 &&
    moveResult.captured.length === 0 &&
    urgentEntry.attack < 4 &&
    urgentEntry.defense < 4 &&
    openSpaceBonus < 1.4
      ? 2.6
      : 0;
  const weightProfile = getMoveWeightProfile(emptyCount);
  const effectiveBoardDelta =
    Number.isFinite(weightProfile.boardDeltaCap)
      ? Math.max(-weightProfile.boardDeltaCap, Math.min(weightProfile.boardDeltaCap, boardDelta))
      : boardDelta;
  const effectiveSelfLiberties = Math.min(selfLiberties, weightProfile.selfLibertyCap);
  const effectiveLibertySwing = Math.min(libertySwing, weightProfile.libertySwingCap);
  const score =
    effectiveBoardDelta * weightProfile.boardDeltaWeight +
    moveResult.captured.length * 18.4 +
    effectiveSelfLiberties * weightProfile.selfLibertyWeight +
    territoryDelta * weightProfile.territoryDeltaWeight +
    pressureBonus +
    escapeBonus +
    eyeBonus * weightProfile.eyeBonusWeight +
    lifeDeathBonus * weightProfile.lifeDeathWeight +
    connectionBonus +
    positionalBonus +
    urgentEntry.attack * 1.18 +
    urgentEntry.defense * weightProfile.defenseUrgencyWeight +
    opponentAtariCount * 7.4 +
    effectiveLibertySwing * weightProfile.libertySwingWeight +
    cutBonus +
    openSpaceBonus * weightProfile.openSpaceWeight -
    selfAtariPenalty -
    contactPenalty -
    crowdingPenalty -
    cleanupPressurePenalty * weightProfile.cleanupPenaltyWeight -
    futileDefensePenalty * weightProfile.futileDefenseWeight -
    territoryFillPenalty;

  return {
    score,
    metrics: {
      captured: moveResult.captured.length,
      selfLiberties,
      territoryDelta,
      pressureBonus,
      escapeBonus,
      eyeBonus,
      lifeDeathBonus,
      connectionBonus,
      positionalBonus,
      attackUrgencyBonus: urgentEntry.attack,
      defenseUrgencyBonus: urgentEntry.defense,
      opponentAtariCount,
      boardDelta,
      boardScore,
      libertySwing,
      cutBonus,
      openSpaceBonus,
      crowdingPenalty,
      cleanupPressurePenalty,
      futileDefensePenalty,
      territoryFillPenalty,
    },
  };
}

export function listInterestingMoves(snapshot, color) {
  const candidateIndices = new Set();
  const occupiedCount = snapshot.board.filter(Boolean).length;

  snapshot.board.forEach((stone, index) => {
    if (!stone) return;
    for (const neighbor of getNeighbors(index, snapshot.size)) {
      if (!snapshot.board[neighbor]) candidateIndices.add(neighbor);
      for (const secondary of getNeighbors(neighbor, snapshot.size)) {
        if (!snapshot.board[secondary]) candidateIndices.add(secondary);
      }
    }
  });

  for (const group of collectGroups(snapshot.board, snapshot.size)) {
    if (group.liberties.size <= 3) {
      group.liberties.forEach((libertyIndex) => candidateIndices.add(libertyIndex));
    }
  }

  if (occupiedCount <= 6) {
    [0, 2, 6, 8, 18, 20, 24, 40, 56, 60, 62, 72, 74, 78, 80].forEach((index) => {
      if (!snapshot.board[index]) candidateIndices.add(index);
    });
  }

  if (!candidateIndices.size) return listLegalMoves(snapshot, color);

  const interestingMoves = [];
  candidateIndices.forEach((index) => {
    const result = simulateMove(snapshot.board, snapshot.size, index, color, snapshot.previousBoardHash);
    if (result.legal) interestingMoves.push({ index, result });
  });
  return interestingMoves.length ? interestingMoves : listLegalMoves(snapshot, color);
}

export function rankMovesStatic(snapshot, color, options = {}) {
  const movePool = options.onlyInteresting ? listInterestingMoves(snapshot, color) : listLegalMoves(snapshot, color);
  if (!movePool.length) return [];
  const context = createMoveEvaluationContext(snapshot, color);
  return movePool
    .map(({ index, result }) => {
      const evaluation = evaluateMove(snapshot, index, result, color, context);
      return { index, coord: indexToCoord(index, snapshot.size), result, score: evaluation.score, metrics: evaluation.metrics };
    })
    .sort((a, b) => b.score - a.score || b.metrics.boardDelta - a.metrics.boardDelta || b.metrics.captured - a.metrics.captured);
}

export function hasCriticalGroups(snapshot) {
  return collectGroups(snapshot.board, snapshot.size).some((group) => {
    const life = analyzeGroupLife(snapshot.board, group, snapshot.size);
    return life.status === "critical" || (life.status === "unsettled" && life.libertyCount <= 3);
  });
}

export function getSearchDepth(snapshot) {
  const emptyCount = countEmptyPoints(snapshot);
  const critical = hasCriticalGroups(snapshot);
  if (critical && emptyCount <= 18) return 4;
  if (emptyCount > 60) return critical ? 3 : 2;
  if (emptyCount > 26) return 3;
  return critical ? 3 : 2;
}

export function getSearchCandidateLimit(snapshot, depth) {
  const emptyCount = countEmptyPoints(snapshot);
  if (depth >= 4) return emptyCount > 12 ? 5 : 6;
  if (depth >= 3) return emptyCount > 45 ? 6 : emptyCount > 24 ? 7 : 8;
  return emptyCount > 45 ? 7 : 9;
}

export function isUrgentCandidate(move) {
  return (
    move.metrics.captured > 0 ||
    move.metrics.opponentAtariCount > 0 ||
    move.metrics.attackUrgencyBonus >= 8 ||
    move.metrics.defenseUrgencyBonus >= 8 ||
    move.metrics.lifeDeathBonus >= 6 ||
    move.metrics.eyeBonus >= 4
  );
}

export function selectSearchCandidates(snapshot, rankedMoves, depth) {
  const limit = getSearchCandidateLimit(snapshot, depth);
  const selected = rankedMoves.slice(0, limit);
  const seen = new Set(selected.map((move) => move.index));

  for (const move of rankedMoves) {
    if (selected.length >= limit + 4) break;
    if (!isUrgentCandidate(move) || seen.has(move.index)) continue;
    selected.push(move);
    seen.add(move.index);
  }

  return selected;
}

export function searchPosition(snapshot, colorToPlay, rootColor, depth, alpha, beta, cache) {
  const cacheKey = [snapshot.boardHash, snapshot.previousBoardHash || "", colorToPlay, depth, snapshot.consecutivePasses].join("|");
  const cachedScore = cache.get(cacheKey);
  if (typeof cachedScore === "number") return cachedScore;
  if (depth <= 0 || snapshot.gameOver) {
    const leafScore = evaluateBoard(snapshot, rootColor);
    cache.set(cacheKey, leafScore);
    return leafScore;
  }

  const rankedMoves = rankMovesStatic(snapshot, colorToPlay, { onlyInteresting: true });
  if (!rankedMoves.length) {
    const fallbackScore = evaluateBoard(snapshot, rootColor);
    cache.set(cacheKey, fallbackScore);
    return fallbackScore;
  }

  const candidates = selectSearchCandidates(snapshot, rankedMoves, depth);
  const maximizing = colorToPlay === rootColor;
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const candidate of candidates) {
    const nextSnapshot = createSnapshotAfterMove(snapshot, colorToPlay, candidate.result, candidate.index);
    const replyScore = searchPosition(nextSnapshot, otherColor(colorToPlay), rootColor, depth - 1, alpha, beta, cache);
    if (maximizing) {
      bestScore = Math.max(bestScore, replyScore);
      alpha = Math.max(alpha, bestScore);
    } else {
      bestScore = Math.min(bestScore, replyScore);
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha) break;
  }

  cache.set(cacheKey, bestScore);
  return bestScore;
}

export function describeMoveReasons(metrics) {
  const reasons = [];
  if (metrics.captured > 0) reasons.push(`capture ${metrics.captured}`);
  if (metrics.defenseUrgencyBonus >= 8 || metrics.escapeBonus >= 3) reasons.push("stabilizes a weak group");
  if (metrics.attackUrgencyBonus >= 8 || metrics.opponentAtariCount > 0 || metrics.pressureBonus >= 4) reasons.push("pressures a weak enemy group");
  if (metrics.lifeDeathBonus >= 6 || metrics.eyeBonus >= 4) reasons.push("settles life and death");
  if (metrics.cutBonus >= 3) reasons.push("cuts enemy shape");
  if (metrics.connectionBonus >= 2.5) reasons.push("connects friendly stones");
  if (metrics.libertySwing >= 2.5) reasons.push("wins the liberty race");
  if (metrics.boardDelta >= 8 || metrics.territoryDelta >= 1.5) reasons.push("improves board balance");
  if (metrics.positionalBonus >= 2.4) reasons.push("takes a good opening point");
  if (metrics.openSpaceBonus >= 2.2) reasons.push("expands into open space cleanly");
  return reasons.slice(0, 2);
}

export function findTacticalOverrideMove(rankedMoves, selectedMove, emptyCount) {
  if (!selectedMove) return null;

  const captureMove = rankedMoves.find((move) => move.metrics.captured > 0);
  if (captureMove && captureMove.index !== selectedMove.index) {
    const scoreGap = captureMove.score - selectedMove.score;
    const selectedLooksSoft =
      selectedMove.metrics.captured === 0 &&
      selectedMove.metrics.attackUrgencyBonus < 8 &&
      selectedMove.metrics.opponentAtariCount === 0 &&
      selectedMove.metrics.lifeDeathBonus <= captureMove.metrics.lifeDeathBonus + 2;

    if (selectedLooksSoft && scoreGap >= (emptyCount <= 30 ? 14 : 18)) {
      return captureMove;
    }
  }

  return null;
}

export function chooseStrategicMove(snapshot, color) {
  const rankedMoves = rankMovesStatic(snapshot, color);
  if (!rankedMoves.length) {
    return { type: "pass", explanation: "No legal move available, so pass." };
  }

  const depth = getSearchDepth(snapshot);
  const searchCandidates = selectSearchCandidates(snapshot, rankedMoves, depth);
  const searchCache = new Map();
  const evaluatedMoves = new Map();
  let bestMove = null;

  for (const candidate of searchCandidates) {
    const nextSnapshot = createSnapshotAfterMove(snapshot, color, candidate.result, candidate.index);
    const searchScore =
      depth > 1
        ? searchPosition(nextSnapshot, otherColor(color), color, depth - 1, -Infinity, Infinity, searchCache)
        : evaluateBoard(nextSnapshot, color);
    const combinedScore = searchScore + candidate.score * 0.08;
    const evaluatedCandidate = { ...candidate, combinedScore, searchScore };
    evaluatedMoves.set(candidate.index, evaluatedCandidate);
    if (!bestMove || combinedScore > bestMove.combinedScore || (combinedScore === bestMove.combinedScore && candidate.score > bestMove.score)) {
      bestMove = evaluatedCandidate;
    }
  }

  const emptyCount = countEmptyPoints(snapshot);
  const fallbackMove = bestMove || rankedMoves[0];
  const tacticalOverride = findTacticalOverrideMove(rankedMoves, fallbackMove, emptyCount);
  const resolvedMove =
    tacticalOverride && tacticalOverride.index !== fallbackMove.index
      ? evaluatedMoves.get(tacticalOverride.index) || tacticalOverride
      : fallbackMove;
  const lifeSummary = summarizeLifeAndDeath(snapshot);
  if (
    snapshot.consecutivePasses === 1 &&
    emptyCount <= 20 &&
    lifeSummary.unresolvedGroups === 0 &&
    resolvedMove.metrics.boardDelta < 2.5 &&
    resolvedMove.metrics.lifeDeathBonus < 5 &&
    resolvedMove.metrics.eyeBonus < 3.5 &&
    resolvedMove.metrics.captured === 0
  ) {
    return {
      type: "pass",
      explanation: "The board looks settled enough to pass.",
      metrics: { ...resolvedMove.metrics, searchScore: resolvedMove.searchScore },
    };
  }

  const reasons = describeMoveReasons(resolvedMove.metrics);
  const coord = indexToCoord(resolvedMove.index, snapshot.size);
  return {
    type: "move",
    index: resolvedMove.index,
    coord,
    explanation: reasons.length ? `Prefer ${coord} because it ${reasons.join(" and ")}.` : `Prefer ${coord} after deeper reading.`,
    metrics: { ...resolvedMove.metrics, searchScore: resolvedMove.searchScore },
  };
}

export function getMoveSequenceForApi(snapshot) {
  return Array.isArray(snapshot.moveLog)
    ? snapshot.moveLog.map((move) => [move.color === "black" ? "B" : "W", move.isPass ? "pass" : move.coord])
    : [];
}

export function getBoardRows(snapshot) {
  const rows = [];
  for (let row = 0; row < snapshot.size; row += 1) {
    let line = "";
    for (let col = 0; col < snapshot.size; col += 1) {
      const stone = snapshot.board[row * snapshot.size + col];
      line += stone === "black" ? "B" : stone === "white" ? "W" : ".";
    }
    rows.push(`${snapshot.size - row}: ${line}`);
  }
  return rows;
}

export function resolveChoiceIndex(choice, size = BOARD_SIZE) {
  if (!choice || typeof choice !== "object") return null;
  if (choice.type === "pass") return null;
  if (typeof choice.index === "number") return choice.index;
  if (typeof choice.coord === "string") return coordToIndex(choice.coord, size);
  return null;
}

export function applyChoice(snapshot, color, choice) {
  const index = resolveChoiceIndex(choice, snapshot.size);
  const simulation = simulateMove(snapshot.board, snapshot.size, index, color, snapshot.previousBoardHash);
  if (!simulation.legal) throw new Error(`Illegal choice: ${simulation.reason}`);
  const nextSnapshot = createSnapshotAfterMove(snapshot, color, simulation, index);
  const coord = simulation.isPass ? "pass" : indexToCoord(index, snapshot.size);
  return {
    simulation,
    snapshot: {
      ...nextSnapshot,
      moveLog: snapshot.moveLog.concat({ color, isPass: simulation.isPass, coord }),
    },
  };
}

export function findRankedMove(rankedMoves, choice, size = BOARD_SIZE) {
  const index = resolveChoiceIndex(choice, size);
  if (index === null) return null;
  return rankedMoves.find((move) => move.index === index) || null;
}
