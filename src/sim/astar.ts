// 8-connected A* over the occupancy grid, with an octile heuristic, no diagonal
// corner-cutting, and line-of-sight (string-pulling) smoothing on the result.
// Returns WORLD-coordinate waypoints, or null if unreachable.
import type { Vec2 } from '@/lib/types';
import type { OccupancyGrid } from './grid';

const SQRT2 = Math.SQRT2;

type Cell = { c: number; r: number };

/** Minimal binary min-heap keyed by f-score. */
class MinHeap {
  private heap: Array<{ key: number; f: number }> = [];
  get size(): number {
    return this.heap.length;
  }
  push(key: number, f: number): void {
    const h = this.heap;
    h.push({ key, f });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].f <= h[i].f) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  pop(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const rr = 2 * i + 2;
        let smallest = i;
        if (l < h.length && h[l].f < h[smallest].f) smallest = l;
        if (rr < h.length && h[rr].f < h[smallest].f) smallest = rr;
        if (smallest === i) break;
        [h[smallest], h[i]] = [h[i], h[smallest]];
        i = smallest;
      }
    }
    return top.key;
  }
}

export function findPath(
  grid: OccupancyGrid,
  from: Vec2,
  to: Vec2,
): Vec2[] | null {
  const { cols, rows, blocked } = grid;

  const isBlocked = (c: number, r: number): boolean =>
    c < 0 || r < 0 || c >= cols || r >= rows || blocked[r * cols + c] === 1;

  // Snap endpoints into free space if they landed on a blocked cell.
  const start = grid.isBlockedWorld(from) ? grid.nearestFree(from, 0.6) : from;
  const goal = grid.isBlockedWorld(to) ? grid.nearestFree(to, 0.6) : to;
  if (!start || !goal) return null;

  const s = grid.worldToCell(start);
  const g = grid.worldToCell(goal);
  if (isBlocked(s.c, s.r) || isBlocked(g.c, g.r)) return null;

  const startIdx = s.r * cols + s.c;
  const goalIdx = g.r * cols + g.c;
  if (startIdx === goalIdx) return [start, goal];

  const gScore = new Float64Array(cols * rows).fill(Infinity);
  const cameFrom = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);

  const heuristic = (c: number, r: number): number => {
    const dc = Math.abs(c - g.c);
    const dr = Math.abs(r - g.r);
    return dc + dr + (SQRT2 - 2) * Math.min(dc, dr); // octile
  };

  const open = new MinHeap();
  gScore[startIdx] = 0;
  open.push(startIdx, heuristic(s.c, s.r));

  // 8 neighbours; diagonals (|dc|+|dr|==2) require both orthogonal cells free.
  const NB: Array<[number, number, number]> = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2],
  ];

  let found = false;
  while (open.size > 0) {
    const current = open.pop();
    if (current === goalIdx) {
      found = true;
      break;
    }
    if (closed[current]) continue;
    closed[current] = 1;
    const cc = current % cols;
    const cr = (current - cc) / cols;

    for (const [dc, dr, cost] of NB) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (isBlocked(nc, nr)) continue;
      if (dc !== 0 && dr !== 0) {
        // Disallow cutting a corner: both shared orthogonal cells must be free.
        if (isBlocked(cc + dc, cr) || isBlocked(cc, cr + dr)) continue;
      }
      const nIdx = nr * cols + nc;
      if (closed[nIdx]) continue;
      const tentative = gScore[current] + cost;
      if (tentative < gScore[nIdx]) {
        gScore[nIdx] = tentative;
        cameFrom[nIdx] = current;
        open.push(nIdx, tentative + heuristic(nc, nr));
      }
    }
  }

  if (!found) return null;

  // Reconstruct the cell path (start -> goal).
  const cells: Cell[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    const c = cur % cols;
    const r = (cur - c) / cols;
    cells.push({ c, r });
    if (cur === startIdx) break;
    cur = cameFrom[cur];
  }
  cells.reverse();

  // String-pulling: keep a node only if the previous kept node cannot see the
  // next one (Bresenham line-of-sight over unblocked cells).
  const lineClear = (a: Cell, b: Cell): boolean => {
    let x0 = a.c;
    let y0 = a.r;
    const x1 = b.c;
    const y1 = b.r;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (isBlocked(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  const smoothed: Cell[] = [cells[0]];
  let anchor = 0;
  for (let i = 2; i < cells.length; i++) {
    if (!lineClear(cells[anchor], cells[i])) {
      smoothed.push(cells[i - 1]);
      anchor = i - 1;
    }
  }
  smoothed.push(cells[cells.length - 1]);

  // Emit world waypoints; pin the exact snapped start/goal at the ends.
  const pts: Vec2[] = smoothed.map((c) => grid.cellToWorld(c.c, c.r));
  pts[0] = start;
  pts[pts.length - 1] = goal;
  return pts;
}
