// RobotDriver: drives the viewer's capsule robot along a polyline with a
// requestAnimationFrame loop, constant ground speed, and smooth (rate-limited)
// turning. Heading convention matches the viewer: headingRad = atan2(dz, dx) so
// forward = (cos h, sin h) in world XZ. Per tick it consults `validate()`; when
// that returns false (the path now crosses a freshly-blocked cell) it resolves
// 'blocked'. cancel() resolves 'cancelled'.
import type { Vec2 } from '@/lib/types';
import type { RoomViewerHandle } from '@/components/RoomViewer';

export type DriveResult = 'arrived' | 'blocked' | 'cancelled';

export type DriveOpts = {
  speed?: number; // m/s, default 0.8
  onProgress?: (pos: Vec2) => void;
  validate?: () => boolean; // false => resolve 'blocked'
};

const MAX_TURN_RATE = 3; // rad/s

function angleDiff(target: number, current: number): number {
  let d = target - current;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export class RobotDriver {
  private viewer: RoomViewerHandle;
  private pos: Vec2;
  private heading: number;
  private raf: number | null = null;
  private resolveCurrent: ((r: DriveResult) => void) | null = null;

  constructor(viewer: RoomViewerHandle, startPos: Vec2, startHeading = 0) {
    this.viewer = viewer;
    this.pos = { ...startPos };
    this.heading = startHeading;
    this.viewer.setRobotPose({ position: this.pos, headingRad: this.heading });
  }

  get position(): Vec2 {
    return { ...this.pos };
  }

  get headingRad(): number {
    return this.heading;
  }

  /** Teleport the robot (used to seed a start pose). */
  setPose(pos: Vec2, heading = this.heading): void {
    this.pos = { ...pos };
    this.heading = heading;
    this.viewer.setRobotPose({ position: this.pos, headingRad: this.heading });
  }

  private finish(result: DriveResult): void {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    const resolve = this.resolveCurrent;
    this.resolveCurrent = null;
    resolve?.(result);
  }

  cancel(): void {
    if (this.resolveCurrent) this.finish('cancelled');
  }

  drive(path: Vec2[], opts: DriveOpts = {}): Promise<DriveResult> {
    // A new drive supersedes any in-flight one.
    if (this.resolveCurrent) this.finish('cancelled');

    const speed = opts.speed ?? 0.8;
    const { onProgress, validate } = opts;

    // Traverse from the robot's actual position through the path vertices.
    const pts: Vec2[] =
      path.length > 0 && Math.hypot(path[0].x - this.pos.x, path[0].z - this.pos.z) > 1e-3
        ? [this.position, ...path]
        : path.slice();

    return new Promise<DriveResult>((resolve) => {
      this.resolveCurrent = resolve;

      if (pts.length < 2) {
        // Nothing to traverse; still honour validate once.
        if (validate && !validate()) {
          this.finish('blocked');
          return;
        }
        if (pts.length === 1) this.setPose(pts[0]);
        this.finish('arrived');
        return;
      }

      const segs = pts.slice(1).map((p, i) => {
        const a = pts[i];
        const dx = p.x - a.x;
        const dz = p.z - a.z;
        const len = Math.hypot(dx, dz);
        return { a, b: p, len, heading: Math.atan2(dz, dx) };
      });
      const total = segs.reduce((acc, s) => acc + s.len, 0);

      let traveled = 0;
      let last = performance.now();

      const tick = (now: number): void => {
        if (this.resolveCurrent !== resolve) return; // superseded
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;

        if (validate && !validate()) {
          this.finish('blocked');
          return;
        }

        // Locate the active segment for the current arc-length.
        let d = traveled;
        let seg = segs[segs.length - 1];
        for (const sgm of segs) {
          if (d <= sgm.len || sgm === segs[segs.length - 1]) {
            seg = sgm;
            break;
          }
          d -= sgm.len;
        }

        // Turn toward the segment heading, capped by the max turn rate. Move
        // forward at a rate scaled by how well we're aligned (pivot first).
        const err = angleDiff(seg.heading, this.heading);
        const maxStep = MAX_TURN_RATE * dt;
        this.heading += Math.abs(err) <= maxStep ? err : Math.sign(err) * maxStep;
        const align = Math.max(0, Math.cos(err));

        traveled = Math.min(total, traveled + speed * align * dt);

        // Resolve world position at the current arc-length.
        let rem = traveled;
        let pos: Vec2 = { ...segs[segs.length - 1].b };
        for (const sgm of segs) {
          if (rem <= sgm.len) {
            const f = sgm.len > 0 ? rem / sgm.len : 0;
            pos = { x: sgm.a.x + (sgm.b.x - sgm.a.x) * f, z: sgm.a.z + (sgm.b.z - sgm.a.z) * f };
            break;
          }
          rem -= sgm.len;
        }
        this.pos = pos;
        this.viewer.setRobotPose({ position: this.pos, headingRad: this.heading });
        onProgress?.(this.position);

        if (traveled >= total - 1e-4) {
          this.finish('arrived');
          return;
        }
        this.raf = requestAnimationFrame(tick);
      };

      this.raf = requestAnimationFrame(tick);
    });
  }
}
