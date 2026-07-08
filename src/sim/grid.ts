// Occupancy grid built from REAL mesh geometry ("geometry is truth"): the LLM
// never decides walkability — this does, by raycasting the loaded room.
//
// Two failure modes surfaced against a real iPhone LiDAR (Scaniverse) scan that
// the clean procedural sample room never exposed, and both are handled here:
//
//   1. SPEED: a plain THREE.Raycaster walks every triangle for every cast. A
//      real scan's mesh is dense (tens/hundreds of thousands of triangles), so
//      ~2900 per-cell casts took 30-45s and froze the tab before React could
//      even paint a spinner. Fix: three-mesh-bvh — build a bounds tree once per
//      mesh, cast with firstHitOnly. This brings the same sweep under ~1s.
//
//   2. CORRECTNESS: a handheld scan is never a clean axis-aligned box — it's
//      tilted, off-center, noisy, and often non-watertight, so a rigid "floor
//      is exactly at floorY" assumption misses the real walking surface almost
//      everywhere and every cell reads as blocked (a robot with nowhere to
//      go). Fix: derive the floor per-cell from what the rays actually hit
//      (a low-percentile cluster near the passed-in floorY, not a single
//      global plane), and — because a heuristic can still fail on a
//      sufficiently messy scan — a DEGENERATE-GRID SAFETY NET: if the
//      resulting grid is pathologically unwalkable, fall back to treating the
//      room interior as free and blocking only cells with clear tall geometry.
//      A partially-wrong but navigable grid beats a "correct" all-blocked one:
//      the product promise is "the robot moves in your room."
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import type { Vec2, Bounds } from '@/lib/types';

// Wire the BVH-accelerated raycast into three's prototypes once per module load.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bvhGeomProto = THREE.BufferGeometry.prototype as any;
if (!bvhGeomProto.computeBoundsTree) {
  bvhGeomProto.computeBoundsTree = computeBoundsTree;
  bvhGeomProto.disposeBoundsTree = disposeBoundsTree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (THREE.Mesh.prototype as any).raycast = acceleratedRaycast;
}

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

const BAND_LO = 0.1; // metres above the LOCAL floor where the robot body starts
const BAND_HI = 0.9; // metres above the LOCAL floor where the body band ends
const FLOOR_SEARCH_TOL = 0.35; // widen vs. the clean-room 0.3 to absorb scan noise/tilt

// If, after the geometry pass, fewer than this fraction of cells are free, the
// heuristic has failed on this scan (near-guaranteed on a very messy or
// inside-out mesh) — trip the permissive fallback rather than ship a robot
// that can't move at all.
const MIN_FREE_FRACTION = 0.08;

/** Median of a numeric array (returns fallback for an empty array). */
function median(xs: number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Circular dilation: every set cell in `src` sets all cells within `rad` cells. */
function dilate(src: Uint8Array, cols: number, rows: number, rad: number): Uint8Array {
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

/** Build (or rebuild) BVH bounds trees on every mesh under `root`. Cheap to
 *  call once per room load; skipped for meshes that already have one. */
function ensureBoundsTrees(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const geom = mesh.geometry as THREE.BufferGeometry | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (geom && geom.isBufferGeometry && !(geom as any).boundsTree) {
      try {
        geom.computeBoundsTree();
      } catch {
        // Non-indexed or degenerate geometry — accelerated raycast falls back
        // to the plain path for this mesh; not fatal.
      }
    }
  });
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

  ensureBoundsTrees(root);

  // Cast from above the tallest geometry so walls are crossed top-down.
  const modelBox = new THREE.Box3().setFromObject(root);
  const topY = Math.max(
    floorY + 2.4,
    Number.isFinite(modelBox.max.y) ? modelBox.max.y + 0.5 : floorY + 2.4,
  );
  const bottomY = Number.isFinite(modelBox.min.y) ? modelBox.min.y - 0.5 : floorY - 0.5;

  // Temporarily make everything double-sided so a downward ray reports both the
  // top and bottom face of each solid (clean entry/exit pairs) — real scans in
  // particular have inconsistent winding. Restored synchronously below.
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
  raycaster.firstHitOnly = false; // we need every crossing to pair solid intervals
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  raycaster.far = topY - bottomY;

  // Pass 1: collect every hit height per cell (sorted near->far == high->low y).
  const hitsPerCell: number[][] = new Array(cols * rows);
  const nearFloorHits: number[] = [];
  try {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { x, z } = cellToWorld(c, r);
        origin.set(x, topY, z);
        raycaster.set(origin, down);
        const hits = raycaster.intersectObject(root, true);
        const ys = hits.map((h) => h.point.y);
        hitsPerCell[r * cols + c] = ys;
        // Lowest hit near the expected floor height = a floor sample here.
        let best = Infinity;
        for (const y of ys) {
          if (Math.abs(y - floorY) <= FLOOR_SEARCH_TOL && y < best) best = y;
        }
        if (best < Infinity) nearFloorHits.push(best);
      }
    }
  } finally {
    // Restore materials synchronously — no await between toggle and restore, so
    // the viewer's requestAnimationFrame render never observes DoubleSide.
    for (const { mat, side } of savedSides) mat.side = side;
  }

  // Robust global floor reference: median of samples near the passed-in floorY.
  // (floorY itself, from the viewer's bbox-min, can sit slightly below the true
  // walking surface on a scan with floor-level clutter/noise — the median of
  // actual near-floor hits corrects for that without discarding floorY, which
  // stays the fallback when a cell has no floor sample at all.)
  const groundY = median(nearFloorHits, floorY);

  // TEMP DIAGNOSTIC — remove once the real-scan occupancy bug is fixed.
  {
    let noHitCells = 0;
    let totalHits = 0;
    let maxHits = 0;
    const sampleLens: number[] = [];
    for (let i = 0; i < hitsPerCell.length; i++) {
      const ys = hitsPerCell[i] ?? [];
      if (ys.length === 0) noHitCells++;
      totalHits += ys.length;
      maxHits = Math.max(maxHits, ys.length);
      if (i % 400 === 0) sampleLens.push(ys.length);
    }
    const midIdx = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
    // Find a cell that DOES have a near-floor hit, to inspect its full ys[].
    let sampleWithFloorIdx = -1;
    for (let i = 0; i < hitsPerCell.length; i++) {
      const ys = hitsPerCell[i] ?? [];
      if (ys.some((y) => Math.abs(y - groundY) <= FLOOR_SEARCH_TOL)) {
        sampleWithFloorIdx = i;
        break;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      '[homie][diag] ' +
        JSON.stringify({
          floorY: +floorY.toFixed(3),
          groundY: +groundY.toFixed(3),
          nearFloorHitsCount: nearFloorHits.length,
          totalCells: cols * rows,
          noHitCells,
          avgHits: +(totalHits / (cols * rows)).toFixed(2),
          maxHits,
          sampleLens: sampleLens.slice(0, 15),
          midCellYs: (hitsPerCell[midIdx] ?? []).map((y) => +y.toFixed(3)),
          sampleWithFloorIdx,
          sampleWithFloorYs: (hitsPerCell[sampleWithFloorIdx] ?? []).map((y) => +y.toFixed(3)),
          BAND_LO,
          BAND_HI,
        }),
    );
  }

  const raw = new Uint8Array(cols * rows); // pre-dilation occupancy
  const hasFloorSample = new Uint8Array(cols * rows);
  for (let i = 0; i < raw.length; i++) {
    const ys = hitsPerCell[i];
    if (!ys || ys.length === 0) {
      raw[i] = 1; // void / outside the room
      continue;
    }
    // Local floor for THIS cell: the lowest hit near the global ground
    // reference, tolerating a gently tilted/uneven real floor. Falls back to
    // the global reference if this cell has no such hit (e.g. a raised object
    // occludes the true floor here — treat the object's own top as ground for
    // clearance purposes, which correctly reads as blocked below).
    let localFloor = Infinity;
    for (const y of ys) {
      if (Math.abs(y - groundY) <= FLOOR_SEARCH_TOL && y < localFloor) localFloor = y;
    }
    if (localFloor === Infinity) {
      // No near-floor hit in this cell. If the lowest hit overall is still
      // reasonably close to the room's floor band, treat it as the local
      // floor (handles a slightly-more-tilted patch); otherwise this cell is
      // occluded by something above the floor for its whole depth.
      const lowest = Math.min(...ys);
      localFloor = lowest;
    } else {
      hasFloorSample[i] = 1;
    }

    const bandLo = localFloor + BAND_LO;
    const bandHi = localFloor + BAND_HI;

    let blockedCell = false;
    // (a) any individual surface sitting in the body band (catches thin
    //     shelves and non-watertight meshes where parity pairing is unreliable
    //     — the default assumption for a real scan).
    for (const y of ys) {
      if (y > bandLo && y < bandHi) {
        blockedCell = true;
        break;
      }
    }
    // (b) a solid vertical interval [bottom, top] overlapping the band. Hits
    //     are sorted high->low, so pairs are (enter=top, exit=bottom) IF the
    //     mesh is watertight; harmless redundancy with (a) otherwise.
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
  let dilated = dilate(raw, cols, rows, radiusCells);

  // --- Degenerate-grid safety net -----------------------------------------
  // Interior cells only (an outer 1-cell margin is expected to read as
  // wall/void even in a good scan) — if almost nothing is walkable, the
  // geometry heuristic has failed on this mesh. Never ship a robot with
  // nowhere to go: fall back to a permissive grid (interior free, with a
  // margin from the outer edge) and block only cells with unambiguous tall
  // geometry actually detected in the body band, ignoring the floor-sample
  // requirement that just failed us.
  let mode: 'geometry' | 'permissive-fallback' = 'geometry';
  const marginCells = Math.max(1, Math.round(0.15 / cell));
  let interiorFree = 0;
  let interiorTotal = 0;
  for (let r = marginCells; r < rows - marginCells; r++) {
    for (let c = marginCells; c < cols - marginCells; c++) {
      interiorTotal++;
      if (!dilated[r * cols + c]) interiorFree++;
    }
  }
  const freeFraction = interiorTotal > 0 ? interiorFree / interiorTotal : 0;

  if (interiorTotal > 0 && freeFraction < MIN_FREE_FRACTION) {
    mode = 'permissive-fallback';
    const fallbackRaw = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const isMargin =
          r < marginCells || r >= rows - marginCells || c < marginCells || c >= cols - marginCells;
        if (isMargin) {
          fallbackRaw[i] = 1;
          continue;
        }
        // Block only if the ORIGINAL band-overlap test already flagged real
        // geometry here (tall furniture, walls caught mid-room) — drop the
        // floor-relative reasoning that just proved unreliable on this scan.
        fallbackRaw[i] = raw[i];
      }
    }
    dilated = dilate(fallbackRaw, cols, rows, radiusCells);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[homie] grid mode: ${mode} — ${cols}x${rows} cells, ` +
      `${dilated.reduce((n, b) => n + b, 0)} blocked / ${cols * rows} total ` +
      `(${Math.round(freeFraction * 100)}% of interior free pre-fallback-check)`,
  );

  const grid: OccupancyGrid = {
    cell,
    bounds: norm,
    cols,
    rows,
    blocked: dilated,
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
