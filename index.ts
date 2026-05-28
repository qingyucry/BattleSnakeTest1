// Welcome to
// __________         __    __  .__                               __
// \______   \_____ _/  |__/  |_|  |   ____   ______ ____ _____  |  | __ ____
//  |    |  _/\__  \\   __\   __\  | _/ __ \ /  ___//    \\__  \ |  |/ // __ \
//  |    |   \ / __ \|  |  |  | |  |_\  ___/ \___ \|   |  \/ __ \|    <\  ___/
//  |________/(______/__|  |__| |____/\_____>______>___|__(______/__|__\\_____>
//
// This file can be a nice home for your Battlesnake logic and helper functions.

import runServer from './server';
import { Coord, GameState, Battlesnake, Board, InfoResponse, MoveResponse } from './types';

function info(): InfoResponse {
  console.log("INFO");
  return {
    apiversion: "1",
    author: "",
    color: "#888888",
    head: "default",
    tail: "default",
  };
}

function start(gameState: GameState): void {
  console.log("GAME START");
}

function end(gameState: GameState): void {
  console.log("GAME OVER\n");
}

// ─────────────────────────────────────────────
// Basic utilities
// ─────────────────────────────────────────────

function coordKey(c: Coord): string {
  return `${c.x},${c.y}`;
}

function applyDir(head: Coord, dir: string): Coord {
  switch (dir) {
    case "up":    return { x: head.x,     y: head.y + 1 };
    case "down":  return { x: head.x,     y: head.y - 1 };
    case "left":  return { x: head.x - 1, y: head.y     };
    case "right": return { x: head.x + 1, y: head.y     };
  }
  return head;
}

function inBounds(c: Coord, w: number, h: number): boolean {
  return c.x >= 0 && c.x < w && c.y >= 0 && c.y < h;
}

function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function sign(x: number): number {
  if (x > 0) return 1;
  if (x < 0) return -1;
  return 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ─────────────────────────────────────────────
// Step 1: Build lethal obstacle set
//   Lethal = all snake body segments EXCEPT each snake's last tail (moves away next turn)
// ─────────────────────────────────────────────
function buildLethalObstacles(board: Board): Set<string> {
  const obs = new Set<string>();
  for (const snake of board.snakes) {
    for (let i = 0; i < snake.body.length - 1; i++) {
      obs.add(coordKey(snake.body[i]));
    }
  }
  return obs;
}

// ─────────────────────────────────────────────
// Step 2: Single-step simulation
//   Returns a simulated board state snapshot needed for scoring
// ─────────────────────────────────────────────
interface SimResult {
  newHead: Coord;
  ateFood: boolean;
  newHealth: number;
  newLength: number;
  foodSet: Set<string>; // food remaining after eating
}

function simulate(me: Battlesnake, dir: string, board: Board): SimResult {
  const newHead = applyDir(me.head, dir);
  const foodKey = coordKey(newHead);
  const foodKeys = new Set(board.food.map(coordKey));
  const ateFood = foodKeys.has(foodKey);
  const newHealth = ateFood ? 100 : me.health - 1;
  const newLength = ateFood ? me.length + 1 : me.length;
  const remainingFood = new Set(foodKeys);
  if (ateFood) remainingFood.delete(foodKey);
  return { newHead, ateFood, newHealth, newLength, foodSet: remainingFood };
}

// ─────────────────────────────────────────────
// Step 3: Synchronous BFS territory calculation
//   Returns { myArea, enemyArea } as Sets of coordKeys
//   Also computes checkered-area discounted space
// ─────────────────────────────────────────────

interface TerritoryResult {
  myArea: Set<string>;          // cells reachable by me first
  enemyArea: Set<string>;       // cells reachable by any enemy first
  myFoodDist: number;           // BFS steps to nearest food in myArea (W if none)
  mySpace: number;              // checkered-discounted my area
  enemyMaxSpace: number;        // max checkered-discounted enemy area
}

function checkeredDiscount(area: Set<string>): number {
  let even = 0;
  let odd = 0;
  for (const key of area) {
    const [xs, ys] = key.split(",");
    const x = parseInt(xs, 10);
    const y = parseInt(ys, 10);
    if ((x + y) % 2 === 0) even++; else odd++;
  }
  const diff = Math.abs(even - odd);
  return even + odd - diff + Math.min(1, diff);
}

function bfsTerritory(
  myNewHead: Coord,
  enemies: Battlesnake[],
  lethalObs: Set<string>,
  board: Board,
  foodSet: Set<string>
): TerritoryResult {
  const W = board.width;
  const H = board.height;
  const DX = [0, 0, -1, 1];
  const DY = [1, -1, 0, 0];

  // owner: 0 = unclaimed, 1 = mine, 2 = enemy, 3 = tied
  const owner = new Map<string, number>();

  // Queue entries: { coord, owner(1=me, 2=enemy), dist }
  interface QEntry { x: number; y: number; ownerIdx: number; dist: number; }
  const queue: QEntry[] = [];

  const enqueue = (x: number, y: number, ownerIdx: number, dist: number) => {
    const k = `${x},${y}`;
    if (lethalObs.has(k)) return;
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    if (owner.has(k)) return;
    owner.set(k, ownerIdx);
    queue.push({ x, y, ownerIdx, dist });
  };

  enqueue(myNewHead.x, myNewHead.y, 1, 0);
  for (const e of enemies) {
    enqueue(e.head.x, e.head.y, 2, 0);
  }

  // BFS level by level
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DX[d];
      const ny = cur.y + DY[d];
      const nk = `${nx},${ny}`;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (lethalObs.has(nk)) continue;
      if (owner.has(nk)) {
        // Check tie: if different owner arrives at same step → mark tied
        const existEntry = queue.find(e => e.x === nx && e.y === ny);
        if (existEntry && existEntry.dist === cur.dist + 1 && existEntry.ownerIdx !== cur.ownerIdx) {
          owner.set(nk, 3);
        }
        continue;
      }
      enqueue(nx, ny, cur.ownerIdx, cur.dist + 1);
    }
  }

  const myArea = new Set<string>();
  const enemyArea = new Set<string>();
  for (const [k, o] of owner) {
    if (o === 1) myArea.add(k);
    else if (o === 2) enemyArea.add(k);
  }

  // BFS food distance in myArea
  let myFoodDist = W;
  if (foodSet.size > 0) {
    const foodBFS: Array<{ x: number; y: number; dist: number }> = [];
    const fbVisited = new Set<string>();
    const startKey = coordKey(myNewHead);
    fbVisited.add(startKey);
    foodBFS.push({ x: myNewHead.x, y: myNewHead.y, dist: 0 });
    let fi = 0;
    let found = false;
    while (fi < foodBFS.length && !found) {
      const cur = foodBFS[fi++];
      const ck = `${cur.x},${cur.y}`;
      if (foodSet.has(ck) && myArea.has(ck)) {
        myFoodDist = cur.dist;
        found = true;
        break;
      }
      for (let d = 0; d < 4; d++) {
        const nx = cur.x + DX[d];
        const ny = cur.y + DY[d];
        const nk = `${nx},${ny}`;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        if (lethalObs.has(nk)) continue;
        if (!myArea.has(nk)) continue;
        if (fbVisited.has(nk)) continue;
        fbVisited.add(nk);
        foodBFS.push({ x: nx, y: ny, dist: cur.dist + 1 });
      }
    }
  }

  const mySpace = checkeredDiscount(myArea);
  const enemyMaxSpace = checkeredDiscount(enemyArea); // single combined enemy area

  return { myArea, enemyArea, myFoodDist, mySpace, enemyMaxSpace };
}

// ─────────────────────────────────────────────
// Flood fill (reachable cell count from a position)
// ─────────────────────────────────────────────
function floodFillCount(start: Coord, lethalObs: Set<string>, board: Board): number {
  const W = board.width;
  const H = board.height;
  if (!inBounds(start, W, H)) return 0;
  const visited = new Set<string>();
  const queue: Coord[] = [start];
  visited.add(coordKey(start));
  const DX = [0, 0, -1, 1];
  const DY = [1, -1, 0, 0];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DX[d];
      const ny = cur.y + DY[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nk = `${nx},${ny}`;
      if (visited.has(nk) || lethalObs.has(nk)) continue;
      visited.add(nk);
      queue.push({ x: nx, y: ny });
    }
  }
  return visited.size;
}

// BFS distance from start to a set of targets (returns Infinity if unreachable)
function bfsDistToSet(start: Coord, targets: Set<string>, lethalObs: Set<string>, board: Board): number {
  const W = board.width;
  const H = board.height;
  if (targets.size === 0) return Infinity;
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number; dist: number }> = [{ x: start.x, y: start.y, dist: 0 }];
  visited.add(coordKey(start));
  const DX = [0, 0, -1, 1];
  const DY = [1, -1, 0, 0];
  let qi = 0;
  while (qi < queue.length) {
    const cur = queue[qi++];
    const k = `${cur.x},${cur.y}`;
    if (targets.has(k)) return cur.dist;
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DX[d];
      const ny = cur.y + DY[d];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nk = `${nx},${ny}`;
      if (visited.has(nk) || lethalObs.has(nk)) continue;
      visited.add(nk);
      queue.push({ x: nx, y: ny, dist: cur.dist + 1 });
    }
  }
  return Infinity;
}

// ─────────────────────────────────────────────
// Center distance
// ─────────────────────────────────────────────
function centerDist(pos: Coord, board: Board): number {
  const cx = (board.width - 1) / 2;
  const cy = (board.height - 1) / 2;
  return Math.abs(pos.x - cx) + Math.abs(pos.y - cy);
}

// ─────────────────────────────────────────────
// Main move function
// ─────────────────────────────────────────────
function move(gameState: GameState): MoveResponse {
  const me = gameState.you;
  const board = gameState.board;
  const turn = gameState.turn;
  const W = board.width;
  const H = board.height;

  const enemies = board.snakes.filter(s => s.id !== me.id);
  const aliveSnakeCount = board.snakes.length; // includes me
  const DIRS = ["up", "down", "left", "right"];

  // ─── Step 1: Eliminate lethal directions ──────────────
  const lethalObs = buildLethalObstacles(board);

  const nonLethal: string[] = [];
  for (const dir of DIRS) {
    const np = applyDir(me.head, dir);
    if (inBounds(np, W, H) && !lethalObs.has(coordKey(np))) {
      nonLethal.push(dir);
    }
  }

  // All directions lethal → fallback to any in-bounds direction
  if (nonLethal.length === 0) {
    for (const dir of DIRS) {
      const np = applyDir(me.head, dir);
      if (inBounds(np, W, H)) {
        console.log(`MOVE ${turn}: All lethal, forced ${dir}`);
        return { move: dir };
      }
    }
    console.log(`MOVE ${turn}: Truly stuck, going up`);
    return { move: "up" };
  }

  // Only one non-lethal direction → take it immediately
  if (nonLethal.length === 1) {
    console.log(`MOVE ${turn}: Only one safe dir: ${nonLethal[0]}`);
    return { move: nonLethal[0] };
  }

  // ─── Phase determination (Step 4) ────────────────────
  // Based on alive snake count first, then turn number
  const is1v1 = aliveSnakeCount <= 2;
  const isEndgame = is1v1;
  let phase: "early" | "mid" | "late";
  if (is1v1) {
    phase = "late";
  } else if (turn < 150) {
    phase = "early";
  } else if (turn < 400) {
    phase = "mid";
  } else {
    phase = "late";
  }

  // ─── Food BFS (for emergency food seeking) ───────────
  const foodKeys = new Set(board.food.map(coordKey));

  // Per-direction food BFS distance from current head (needed for health < 25 fallback)
  function bfsFoodDistFrom(pos: Coord): number {
    return bfsDistToSet(pos, foodKeys, lethalObs, board);
  }

  // Health < 25 emergency: find the non-lethal direction with smallest food BFS dist
  if (me.health < 25 && nonLethal.length > 1) {
    let bestFoodDir = nonLethal[0];
    let bestFoodDist = Infinity;
    for (const dir of nonLethal) {
      const np = applyDir(me.head, dir);
      const d = bfsFoodDistFrom(np);
      if (d < bestFoodDist) {
        bestFoodDist = d;
        bestFoodDir = dir;
      }
    }
    console.log(`MOVE ${turn}: Health emergency, seeking food dir=${bestFoodDir}`);
    return { move: bestFoodDir };
  }

  // ─── Score each non-lethal direction ─────────────────
  const scores: { dir: string; score: number; dangerous: boolean }[] = [];

  for (const dir of nonLethal) {
    // Step 2: simulate
    const sim = simulate(me, dir, board);
    const newHead = sim.newHead;

    // Step 3: BFS territory
    const territory = bfsTerritory(newHead, enemies, lethalObs, board, sim.foodSet);
    const { myArea, enemyArea, myFoodDist, mySpace, enemyMaxSpace } = territory;

    // Flood fill reachable from newHead (for enclosed space detection)
    const reachable = floodFillCount(newHead, lethalObs, board);

    // Dangerous: new pos adjacent to a longer-or-equal enemy head
    let dangerous = false;
    for (const e of enemies) {
      if (e.length >= me.length && manhattan(newHead, e.head) === 1) {
        dangerous = true;
        break;
      }
    }

    let score = 0;

    // ── Step 5: Endgame (1v1, turn >= 50) ──────────────
    if (isEndgame && turn >= 50 && enemies.length > 0) {
      const enemy = enemies[0];

      // My tail BFS distance
      const myTailSet = new Set([coordKey(me.body[me.body.length - 1])]);
      const myTailDist = bfsDistToSet(newHead, myTailSet, lethalObs, board);

      // Enemy tail BFS distance
      const eTailSet = new Set([coordKey(enemy.body[enemy.body.length - 1])]);
      const eTailDist = bfsDistToSet(enemy.head, eTailSet, lethalObs, board);

      // Enemy forced to lose: enemy_space < enemy_tail_dist && my health > enemy_space
      if (enemyMaxSpace < eTailDist && sim.newHealth > enemyMaxSpace) {
        score += 10000;
      }

      // I'm forced to lose: my_space < my_tail_dist && enemy health > my_space
      if (mySpace < myTailDist && enemy.health > mySpace) {
        score -= 10000;
      }

      // I'll starve before reaching nearest food
      if (sim.newHealth < myFoodDist) {
        score -= 10000;
      }
    }

    // ── Step 6 & 7: Feature values + weighted sum ───────
    const maxEnemyLen = enemies.length > 0 ? Math.max(...enemies.map(e => e.length)) : 0;
    const minEnemyHealth = enemies.length > 0 ? Math.min(...enemies.map(e => e.health)) : 0;

    // Feature 1: being_longer
    let beingLonger = 0;
    if (enemies.length > 0) {
      const diff = me.length - maxEnemyLen;
      const s = sign(diff);
      beingLonger = s * Math.floor(Math.log(Math.abs(W * diff) + 1) / Math.log(1.5)) * W;
    }

    // Feature 2: food_dist (negative weight — larger dist = worse)
    const foodDist = myFoodDist;

    // Feature 3: controlled_tail_diff
    let controlledTailDiff = 0;
    for (const snake of board.snakes) {
      const tailKey = coordKey(snake.body[snake.body.length - 1]);
      if (myArea.has(tailKey)) controlledTailDiff += 1;
      else if (enemyArea.has(tailKey)) controlledTailDiff -= 1;
    }

    // Feature 4: area_size_diff (checkered discounted)
    const areaSizeDiff = mySpace - enemyMaxSpace;

    // Feature 5: controlled_food_diff
    let myFoodCount = 0;
    let enemyFoodCount = 0;
    for (const f of board.food) {
      const fk = coordKey(f);
      if (myArea.has(fk)) myFoodCount++;
      else if (enemyArea.has(fk)) enemyFoodCount++;
    }
    const controlledFoodDiff = myFoodCount - enemyFoodCount;

    // Feature 6: me_health
    const meHealth = sim.newHealth;

    // Feature 7: lowest_enemy_health
    const lowestEnemyHealth = minEnemyHealth;

    // Weights (early / late)
    const earlyW = {
      beingLonger: 9,
      foodDist: -7,
      controlledTailDiff: 6,
      areaSizeDiff: 1,
      controlledFoodDiff: 0,
      meHealth: 1,
      lowestEnemyHealth: -2,
    };
    const lateW = {
      beingLonger: 0,
      foodDist: 0,
      controlledTailDiff: 20,
      areaSizeDiff: 7,
      controlledFoodDiff: 3,
      meHealth: 0,
      lowestEnemyHealth: 0,
    };

    const progress = clamp(turn / 632, 0, 1);
    const w = {
      beingLonger:        earlyW.beingLonger        * (1 - progress) + lateW.beingLonger        * progress,
      foodDist:           earlyW.foodDist            * (1 - progress) + lateW.foodDist            * progress,
      controlledTailDiff: earlyW.controlledTailDiff  * (1 - progress) + lateW.controlledTailDiff  * progress,
      areaSizeDiff:       earlyW.areaSizeDiff        * (1 - progress) + lateW.areaSizeDiff        * progress,
      controlledFoodDiff: earlyW.controlledFoodDiff  * (1 - progress) + lateW.controlledFoodDiff  * progress,
      meHealth:           earlyW.meHealth            * (1 - progress) + lateW.meHealth            * progress,
      lowestEnemyHealth:  earlyW.lowestEnemyHealth   * (1 - progress) + lateW.lowestEnemyHealth   * progress,
    };

    score +=
      w.beingLonger        * beingLonger +
      w.foodDist           * foodDist +
      w.controlledTailDiff * controlledTailDiff +
      w.areaSizeDiff       * areaSizeDiff +
      w.controlledFoodDiff * controlledFoodDiff +
      w.meHealth           * meHealth +
      w.lowestEnemyHealth  * lowestEnemyHealth;

    // ── Step 8: Universal bonuses/penalties ─────────────

    // Dangerous direction: possible head-on with longer/equal enemy
    if (dangerous) score -= 50;

    // Enclosed small space
    if (reachable < sim.newLength) score -= 100;
    else if (reachable <= 3) score -= 30;

    // Health < 25 emergency food bonus (extra on top of BFS tie-break above)
    if (me.health < 25) {
      // Handled by early return above; but add small nudge here too
      if (myFoodDist < W) score += 80;
    }

    // Early phase bonuses (turn < 150, alive snakes > 2)
    if (phase === "early" && aliveSnakeCount > 2) {
      // Ate food and thereby surpassed longest enemy
      if (sim.ateFood && maxEnemyLen > 0 && sim.newLength > maxEnemyLen) {
        score += 25;
      }
      // Moving toward a longer enemy head → penalty
      for (const e of enemies) {
        if (e.length >= me.length) {
          const prevDist = manhattan(me.head, e.head);
          const newDist  = manhattan(newHead, e.head);
          if (newDist < prevDist) score -= 15;
        }
      }
    }

    // Late/endgame phase bonuses
    if (isEndgame) {
      // Moving into a connected space larger than body length → bonus
      if (reachable > sim.newLength) score += 50;

      // Corner penalty
      if ((newHead.x <= 1 || newHead.x >= W - 2) && (newHead.y <= 1 || newHead.y >= H - 2)) {
        score -= 30;
      }

      // I'm longer → chase enemy head
      for (const e of enemies) {
        if (me.length > e.length) {
          const prevDist = manhattan(me.head, e.head);
          const newDist  = manhattan(newHead, e.head);
          if (newDist < prevDist) score += 20;
        }
      }
    }

    scores.push({ dir, score, dangerous });

    console.log(
      `MOVE ${turn}: dir=${dir} score=${score.toFixed(1)} ` +
      `space=${mySpace} enemySpace=${enemyMaxSpace} ` +
      `foodDist=${myFoodDist} dangerous=${dangerous} phase=${phase}`
    );
  }

  // ─── Step 9: Pick best direction ─────────────────────
  scores.sort((a, b) => b.score - a.score);
  const topScore = scores[0].score;

  // Collect tied directions
  const tied = scores.filter(s => Math.abs(s.score - topScore) < 0.001);

  let bestDir: string;
  if (tied.length === 1) {
    bestDir = tied[0].dir;
  } else {
    // Tie-break 1: prefer non-dangerous
    const safe = tied.filter(s => !s.dangerous);
    const candidates = safe.length > 0 ? safe : tied;

    // Tie-break 2: prefer closer to board center
    candidates.sort((a, b) => {
      const pa = applyDir(me.head, a.dir);
      const pb = applyDir(me.head, b.dir);
      return centerDist(pa, board) - centerDist(pb, board);
    });

    bestDir = candidates[0].dir;
  }

  console.log(`MOVE ${turn}: chosen=${bestDir}`);
  return { move: bestDir };
}

runServer({
  info: info,
  start: start,
  move: move,
  end: end
});
