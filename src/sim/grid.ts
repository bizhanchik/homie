// Occupancy grid built from REAL mesh geometry ("geometry is truth"): the LLM
// never decides walkability — this does, by raycasting the loaded room.
//
// Method (robust to the sample room's thick floor + tall walls + a possible
// ceiling): for each cell centre we cast a ray straight DOWN through the room and
// read every surface it crosses. To get clean entry/exit pairs for solid boxes we
// temporarily force every material to DoubleSide during the pass (restored before
// we return, synchronously, so the viewer's render loop never sees it). A cell is
// blocked when a solid vertical interval overlaps the robot's body band
// (ground+0.06 .. ground+1.0), OR when the ray hits nothing at all (void / outside
// the room). The floor slab (top at/near ground) and any ceiling (above the band)
// are excluded automatically. Blocked cells are then dilated by the robot radius.
import * as THREE from 'three';
import type { Vec2, Bounds } from '@/lib/types';

export type OccupancyGrid = {
  cell: number;
  bounds: Bounds;
  cols: number;
  rows: number;
  blocked: Uint8Array; // dilated: 1 = a robot centre here would collide
  isBlockedWorld(v: Vec2): boolean;
  worldToCell(v: Vec2): { c: number; r: number };
  cellToWorld(c: number, r: number): Vec2;
  addObstacleFootprint(at: Vec2, size?: number): void;
  nearestFree(v: Vec2, maxRadius?: number): Vec2 | null;
};

export type BuildGridOpts = { cell?: number; robotRadius?: number };

const BAND_LO = 0.06; // metres above ground where the robot body starts
const BAND_HI = 1.0; // metres above ground where the body band ends
const FLOOR_TOL = 0.3; // a hit within this of floorY is treated as ground

/** Median of a numeric array (returns fallback for an empty array). */
function median(xs: number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Circular dilation: every set cell in `src` sets all cells within `rad` cells. */
function dilate(
  src: Uint8Array,
  cols: number,
  rows: number,
  rad: number,
): Uint8Array {
  const out = new Uint8Array(src.length);
  if (rad <= 0) {
    out.set(src);
    return out;
  }
  const offs: Array<[number, number]> = [];
  const r2 = rad * rad;
  for (let dr = -rad; dr <= rad; dr++) {
    for (let dc = -rad; dc <= rad; dc++) {
      if (dc * dc + dr * dr <= r2) offs.push([dc, dr]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!src[r * cols + c]) continue;
      for (const [dc, dr] of offs) {
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        out[nr * cols + nc] = 1;
      }
    }
  }
  return out;
}

export function buildGrid(
  root: THREE.Object3D,
  bounds: Bounds,
  floorY: number,
  opts?: BuildGridOpts,
): OccupancyGrid {
  const cell = opts?.cell ?? 0.12;
  const robotRadius = opts?.robotRadius ?? 0.35;

  const minX = Math.min(bounds.minX, bounds.maxX);
  const maxX = Math.max(bounds.minX, bounds.maxX);
  const minZ = Math.min(bounds.minZ, bounds.maxZ);
  const maxZ = Math.max(bounds.minZ, bounds.maxZ);
  const norm: Bounds = { minX, maxX, minZ, maxZ };

  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));

  const cellToWorld = (c: number, r: number): Vec2 => ({
    x: minX + (c + 0.5) * cell,
    z: minZ + (r + 0.5) * cell,
  });
  const worldToCell = (v: Vec2): { c: number; r: number } => ({
    c: Math.min(cols - 1, Math.max(0, Math.floor((v.x - minX) / cell))),
    r: Math.min(rows - 1, Math.max(0, Math.floor((v.z - minZ) / cell))),
  });

  // Cast from above the tallest geometry so walls (2.5 m) are crossed top-down.
  const modelBox = new THREE.Box3().setFromObject(root);
  const topY = Math.max(
    floorY + 2.2,
    Number.isFinite(modelBox.max.y) ? modelBox.max.y + 0.5 : floorY + 2.2,
  );

  // Temporarily make everything double-sided so a downward ray reports both the
  // top and bottom face of each solid (clean entry/exit pairs). Restored below.
  const savedSides: Array<{ mat: THREE.Material; side: THREE.Side }> = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (m && typeof (m as THREE.Material).side === 'number') {
        savedSides.push({ mat: m, side: m.side });
        m.side = THREE.DoubleSide;
      }
    }
  });

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  raycaster.far = topY - (floorY - 5);

  // Pass 1: collect every hit height per cell (sorted near->far == high->low y).
  const hitsPerCell: number[][] = new Array(cols * rows);
  const floorTops: number[] = [];
  try {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { x, z } = cellToWorld(c, r);
        origin.set(x, topY, z);
        raycaster.set(origin, down);
        const hits = raycaster.intersectObject(root, true);
        const ys = hits.map((h) => h.point.y);
        hitsPerCell[r * cols + c] = ys;
        // Highest hit that is still near the floor = the walking surface here.
        let best = -Infinity;
        for (const y of ys) {
          if (y <= floorY + FLOOR_TOL && y > best) best = y;
        }
        if (best > -Infinity) floorTops.push(best);
      }
    }
  } finally {
    // Restore materials synchronously — no await between toggle and restore, so
    // the viewer's requestAnimationFrame render never observes DoubleSide.
    for (const { mat, side } of savedSides) mat.side = side;
  }

  const groundY = median(floorTops, floorY);
  const bandLo = groundY + BAND_LO;
  const bandHi = groundY + BAND_HI;

  const raw = new Uint8Array(cols * rows); // pre-dilation occupancy
  for (let i = 0; i < raw.length; i++) {
    const ys = hitsPerCell[i];
    if (!ys || ys.length === 0) {
      raw[i] = 1; // void / outside the room
      continue;
    }
    let blockedCell = false;
    // (a) any individual surface sitting in the body band (catches thin shelves
    //     and non-watertight meshes where parity pairing is unreliable).
    for (const y of ys) {
      if (y > bandLo && y < bandHi) {
        blockedCell = true;
        break;
      }
    }
    // (b) a solid vertical interval [bottom, top] overlapping the band. Hits are
    //     sorted high->low, so pairs are (enter=top, exit=bottom).
    if (!blockedCell) {
      for (let k = 0; k + 1 < ys.length; k += 2) {
        const top = ys[k];
        const bot = ys[k + 1];
        if (top > bandLo && bot < bandHi) {
          blockedCell = true;
          break;
        }
      }
    }
    raw[i] = blockedCell ? 1 : 0;
  }

  const radiusCells = Math.ceil(robotRadius / cell);

  const grid: OccupancyGrid = {
    cell,
    bounds: norm,
    cols,
    rows,
    blocked: dilate(raw, cols, rows, radiusCells),
    worldToCell,
    cellToWorld,
    isBlockedWorld(v: Vec2): boolean {
      if (v.x < minX || v.x > maxX || v.z < minZ || v.z > maxZ) return true;
      const { c, r } = worldToCell(v);
      return grid.blocked[r * cols + c] === 1;
    },
    addObstacleFootprint(at: Vec2, size = 0.4): void {
      const half = size / 2;
      const c0 = Math.max(0, Math.floor((at.x - half - minX) / cell));
      const c1 = Math.min(cols - 1, Math.floor((at.x + half - minX) / cell));
      const r0 = Math.max(0, Math.floor((at.z - half - minZ) / cell));
      const r1 = Math.min(rows - 1, Math.floor((at.z + half - minZ) / cell));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) raw[r * cols + c] = 1;
      }
      // Re-dilate so the new footprint gets the same robot-radius padding.
      grid.blocked = dilate(raw, cols, rows, radiusCells);
    },
    nearestFree(v: Vec2, maxRadius = 0.6): Vec2 | null {
      if (!grid.isBlockedWorld(v)) return v;
      const { c: cc, r: rc } = worldToCell(v);
      const maxK = Math.max(1, Math.ceil(maxRadius / cell));
      for (let k = 1; k <= maxK; k++) {
        let best: Vec2 | null = null;
        let bestD = Infinity;
        for (let dr = -k; dr <= k; dr++) {
          for (let dc = -k; dc <= k; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== k) continue; // ring only
            const nc = cc + dc;
            const nr = rc + dr;
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            if (grid.blocked[nr * cols + nc]) continue;
            const w = cellToWorld(nc, nr);
            const d = Math.hypot(w.x - v.x, w.z - v.z);
            if (d < bestD) {
              bestD = d;
              best = w;
            }
          }
        }
        if (best) return best;
      }
      return null;
    },
  };

  return grid;
}
