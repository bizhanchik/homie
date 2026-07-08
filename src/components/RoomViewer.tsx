'use client';

// RoomViewer — Three.js scene wrapper for Homie.
// Owns the scanned-room GLB render plus everything the demo drives: robot pose,
// path polyline, click-to-place obstacles, floating labels, and the top-down
// orthographic capture that /api/label consumes.
//
// Coordinate convention (see docs/contracts.md + src/lib/types.ts):
//   world = meters, XZ ground plane, Y up. Vec2 = { x, z }.
//   After load the model is centered at the XZ origin; floor Y = model min Y.
//
// The imperative handle below is a hard contract other agents code against.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { nanoid } from 'nanoid';
import type { Vec2, Bounds, SceneObject } from '@/lib/types';

export type RoomViewerHandle = {
  loadGlb(buffer: ArrayBuffer): Promise<void>; // parse + add to scene, fit camera, compute floor Y + bounds
  renderTopDown(): { imageDataUrl: string; bounds: Bounds }; // orthographic top-down PNG + exact world bounds of the framed area
  // Multi-image top-down capture for exhaustive labeling: one high-res top-down
  // render, sliced into a full frame (index 0) + 4 overlapping zoomed quadrant
  // crops (indices 1-4). Each image carries its OWN world bounds (a sub-rect of
  // the overall frame) so imageToWorld() maps ITS normalized coords to world.
  renderTopDownTiles(): {
    bounds: Bounds; // overall framed world bounds (same as renderTopDown().bounds)
    images: { imageDataUrl: string; bounds: Bounds }[];
  };
  getRoomRoot(): unknown | null; // THREE.Object3D of the loaded room (for sim raycasts)
  getFloorY(): number;
  setRobotPose(pose: { position: Vec2; headingRad: number }): void; // capsule robot, y = floorY
  setPath(points: Vec2[]): void; // emerald polyline slightly above floor; [] clears
  addObstacle(at: Vec2): string; // red 0.4m box, returns id
  removeObstacle(id: string): void; // remove one obstacle box by id
  getObstacles(): { id: string; at: Vec2 }[];
  clearObstacles(): void; // remove all obstacle meshes + internal list (keeps room/robot/path)
  setLabels(objects: SceneObject[]): void; // floating label pins at object positions
  getRobotModelKind(): 'capsule' | 'glb'; // which robot is currently shown (dev/diagnostics)
  clearScene(): void;
};

export type RoomViewerProps = {
  onReady?: () => void;
  onFloorClick?: (at: Vec2) => void; // raycast click -> world XZ on floor
  obstacleMode?: boolean; // when true, floor clicks add an obstacle and fire onObstacleAdded
  obstacleRemoveMode?: boolean; // when true, clicking a red box removes it
  onObstacleAdded?: (at: Vec2, id: string) => void;
  onObstacleRemoved?: (id: string) => void;
  className?: string;
};

const EMERALD = 0x34d399; // tailwind emerald-400
const EMERALD_LIGHT = 0x6ee7b7; // emerald-300
const OBSTACLE_RED = 0xef4444; // tailwind red-500
const BG = 0x0a0a0a; // neutral-950

const ROBOT_RADIUS = 0.35;
const ROBOT_TOTAL_H = 0.9;
const OBSTACLE_SIZE = 0.4;
const TOPDOWN_PX = 1024;
// Single high-res top-down capture that renderTopDownTiles() crops into 5 images.
// Rendered ONCE, then only 2D-canvas cropping per tile (no extra WebGL passes).
const TOPDOWN_HQ_PX = 2048;
const CLICK_MOVE_THRESHOLD = 6; // px; larger => treated as an orbit drag, not a click
const LABEL_HEIGHT = 1.0; // meters above floor for label pins

// ---- Skinned robot model (public/low_poly_humanoid_robot.glb) --------------
// Optional GLB (skeleton + walk/idle clips, usually FBX->GLB) that replaces the
// capsule. A room (re)load picks it up. If absent or unparseable we silently
// keep the capsule.
//
// MANUAL-FIX KNOBS — tweak these first if the imported model looks wrong:
const ROBOT_GLB_URL = '/low_poly_humanoid_robot.glb';
const ROBOT_TARGET_HEIGHT = 1.5; // m; model is uniformly scaled so its bbox height == this
// Our heading convention is forward = local +X (see the capsule's cone). glTF
// characters usually face +Z, so we spin the model +90° about Y to map +Z->+X.
// If the robot faces sideways/backward in the demo, change this by ±Math.PI/2
// (a quarter turn) or Math.PI (a half turn) — nothing else needs to move.
const ROBOT_YAW_OFFSET = Math.PI / 2;
const ROBOT_WALK_REF_SPEED = 0.8; // m/s that plays the walk clip at timeScale 1
const ROBOT_MOVE_SPEED_THRESHOLD = 0.05; // m/s above which we crossfade to walk
const ROBOT_CROSSFADE_SEC = 0.25; // walk<->idle blend duration
const ROBOT_STOP_TIMEOUT_MS = 150; // no setRobotPose for this long => treat as stopped
const ROBOT_POSE_MAX_DT_MS = 200; // gaps larger than this are teleports, not motion

// Loaded skinned-robot model + its animation state (null => capsule fallback).
type RobotModel = {
  wrapper: THREE.Group; // holds the model; carries ROBOT_YAW_OFFSET
  mixer: THREE.AnimationMixer;
  walkAction: THREE.AnimationAction | null;
  idleAction: THREE.AnimationAction | null;
  walking: boolean;
};

type ViewerState = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  roomRoot: THREE.Group | null;
  robotGroup: THREE.Group;
  capsuleGroup: THREE.Group; // fallback capsule + heading cone; removed when a GLB loads
  robot: RobotModel | null; // the skinned model, once /robot.glb is loaded
  robotLoading: boolean; // a robot.glb load is in flight (dedupe concurrent room loads)
  robotInfoLogged: boolean; // console.info about the capsule fallback fired once
  lastPose: { x: number; z: number; t: number } | null; // for speed estimation
  robotSpeed: number; // m/s, estimated from setRobotPose deltas
  obstaclesGroup: THREE.Group;
  pathGroup: THREE.Group;
  floorY: number;
  bounds: Bounds;
  labels: { position: Vec2; el: HTMLDivElement }[];
  obstacles: Map<string, { mesh: THREE.Mesh; at: Vec2 }>;
};

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.());
    else mat?.dispose?.();
  });
}

// Capture a raw top-down orthographic RGBA buffer at an arbitrary square pixel
// size. Sets up the ortho camera (up=(0,0,-1) => screen-right=+X, screen-down=+Z,
// exactly what imageToWorld() assumes), hides non-room groups, renders to an
// offscreen target, reads pixels, and flips vertically (WebGL row 0 = bottom;
// canvas row 0 = top) so the returned buffer is canvas/PNG ready.
// `framed` is the square world rectangle the buffer covers (room + 5% margin).
// Shared by renderTopDown() (at TOPDOWN_PX) and renderTopDownTiles() (at HQ).
function captureTopDownRaw(
  S: ViewerState | null,
  px: number,
): { raw: Uint8ClampedArray; framed: Bounds } | null {
  if (!S) return null;
  const { renderer, scene, floorY, bounds } = S;

  // Square frame covering the room + 5% margin (keeps the PNG undistorted).
  const rawW = bounds.maxX - bounds.minX;
  const rawD = bounds.maxZ - bounds.minZ;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const half = (Math.max(rawW, rawD, 0.001) * 1.05) / 2;
  const framed: Bounds = {
    minX: cx - half,
    maxX: cx + half,
    minZ: cz - half,
    maxZ: cz + half,
  };

  // Top-down ortho camera. up=(0,0,-1) => screen-right maps to world +X and
  // screen-down maps to world +Z, exactly what imageToWorld() assumes.
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 20000);
  cam.up.set(0, 0, -1);
  cam.position.set(cx, floorY + 1000, cz);
  cam.lookAt(cx, floorY, cz);
  cam.updateProjectionMatrix();

  // Hide everything that isn't the room.
  const robotVis = S.robotGroup.visible;
  const obsVis = S.obstaclesGroup.visible;
  const pathVis = S.pathGroup.visible;
  S.robotGroup.visible = false;
  S.obstaclesGroup.visible = false;
  S.pathGroup.visible = false;

  const rt = new THREE.WebGLRenderTarget(px, px);
  rt.texture.colorSpace = THREE.SRGBColorSpace; // encode sRGB into the read buffer
  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, cam);
  const raw = new Uint8Array(px * px * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, px, px, raw);
  renderer.setRenderTarget(prevTarget);

  // Restore visibility + cleanup.
  S.robotGroup.visible = robotVis;
  S.obstaclesGroup.visible = obsVis;
  S.pathGroup.visible = pathVis;
  rt.dispose();

  // Flip vertically: WebGL row 0 = bottom; PNG/canvas row 0 = top.
  const out = new Uint8ClampedArray(px * px * 4);
  const rowBytes = px * 4;
  for (let y = 0; y < px; y++) {
    const src = (px - 1 - y) * rowBytes;
    out.set(raw.subarray(src, src + rowBytes), y * rowBytes);
  }
  return { raw: out, framed };
}

const RoomViewer = forwardRef<RoomViewerHandle, RoomViewerProps>(function RoomViewer(
  props,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ViewerState | null>(null);
  // Latest props, read by long-lived event handlers / the render loop.
  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- Scene setup (runs once on mount) ------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    container.insertBefore(renderer.domElement, overlay);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    camera.position.set(6, 6, 6);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 200;
    controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor
    controls.target.set(0, 0, 0);

    // Lighting: ambient + hemisphere fill + one key directional.
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202024, 0.6);
    hemi.position.set(0, 10, 0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.25);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    const robotGroup = new THREE.Group();
    robotGroup.name = 'robot';
    robotGroup.visible = false;
    // Fallback capsule + cone live in their own group so a loaded GLB can cheaply
    // remove/dispose them without touching the robotGroup transform (= heading).
    const capsuleGroup = new THREE.Group();
    capsuleGroup.name = 'robotCapsule';
    // Capsule body (radially symmetric; heading shown by the cone).
    const capsule = new THREE.Mesh(
      new THREE.CapsuleGeometry(ROBOT_RADIUS, ROBOT_TOTAL_H - 2 * ROBOT_RADIUS, 8, 16),
      new THREE.MeshStandardMaterial({
        color: EMERALD,
        roughness: 0.35,
        metalness: 0.1,
        emissive: EMERALD,
        emissiveIntensity: 0.15,
      }),
    );
    capsule.position.y = ROBOT_TOTAL_H / 2; // sit on the floor plane (group origin = floor)
    capsuleGroup.add(capsule);
    // Heading indicator: cone pointing local +X (forward).
    const coneGeo = new THREE.ConeGeometry(0.13, 0.4, 16);
    coneGeo.rotateZ(-Math.PI / 2); // apex +Y -> +X
    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshStandardMaterial({
        color: EMERALD_LIGHT,
        emissive: EMERALD_LIGHT,
        emissiveIntensity: 0.4,
      }),
    );
    cone.position.set(ROBOT_RADIUS + 0.18, ROBOT_TOTAL_H / 2, 0);
    capsuleGroup.add(cone);
    robotGroup.add(capsuleGroup);
    scene.add(robotGroup);

    const obstaclesGroup = new THREE.Group();
    obstaclesGroup.name = 'obstacles';
    scene.add(obstaclesGroup);

    const pathGroup = new THREE.Group();
    pathGroup.name = 'path';
    scene.add(pathGroup);

    const state: ViewerState = {
      renderer,
      scene,
      camera,
      controls,
      raycaster: new THREE.Raycaster(),
      roomRoot: null,
      robotGroup,
      capsuleGroup,
      robot: null,
      robotLoading: false,
      robotInfoLogged: false,
      lastPose: null,
      robotSpeed: 0,
      obstaclesGroup,
      pathGroup,
      floorY: 0,
      bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
      labels: [],
      obstacles: new Map(),
    };
    stateRef.current = state;

    // ---- Label projection (DOM overlay, updated every frame) ---------------
    const projected = new THREE.Vector3();
    function updateLabels() {
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      for (const label of state.labels) {
        projected.set(label.position.x, state.floorY + LABEL_HEIGHT, label.position.z);
        projected.project(camera);
        // z > 1 => behind the camera / beyond far plane.
        const visible = projected.z <= 1;
        if (!visible) {
          label.el.style.display = 'none';
          continue;
        }
        label.el.style.display = 'block';
        const x = (projected.x * 0.5 + 0.5) * w;
        const y = (-projected.y * 0.5 + 0.5) * h;
        label.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      }
    }

    // ---- Render loop -------------------------------------------------------
    // Manual dt (avoids the deprecated THREE.Clock); clamped so a backgrounded
    // tab can't feed the mixer a huge delta on resume.
    let lastFrameT = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - lastFrameT) / 1000, 0.1);
      lastFrameT = now;
      controls.update();
      updateLabels();
      updateRobotLocomotion(state, dt);
      renderer.render(scene, camera);
    });

    // ---- Resize ------------------------------------------------------------
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(container);

    // ---- Click vs drag: floor raycast --------------------------------------
    let downX = 0;
    let downY = 0;
    let downButton = -1;
    const onPointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      downButton = e.button;
    };
    const floorPlane = new THREE.Plane();
    const floorHit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    const onPointerUp = (e: PointerEvent) => {
      if (downButton !== 0 || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > CLICK_MOVE_THRESHOLD) return; // it was an orbit drag
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -(((e.clientY - rect.top) / rect.height) * 2 - 1),
      );
      state.raycaster.setFromCamera(ndc, camera);
      // Plane y = floorY, normal +Y: normal·p + constant = 0 => constant = -floorY.
      floorPlane.set(new THREE.Vector3(0, 1, 0), -state.floorY);
      if (!state.raycaster.ray.intersectPlane(floorPlane, floorHit)) return;
      const at: Vec2 = { x: floorHit.x, z: floorHit.z };
      const p = propsRef.current;
      if (p.obstacleRemoveMode) {
        // Raycast against obstacle meshes to find which one was clicked.
        state.raycaster.setFromCamera(ndc, camera);
        const hits = state.raycaster.intersectObjects(
          Array.from(state.obstacles.values()).map((o) => o.mesh),
        );
        if (hits.length > 0) {
          const clicked = hits[0].object as THREE.Mesh;
          for (const [id, { mesh }] of state.obstacles) {
            if (mesh === clicked) {
              state.obstaclesGroup.remove(mesh);
              disposeObject(mesh);
              state.obstacles.delete(id);
              p.onObstacleRemoved?.(id);
              break;
            }
          }
        }
      } else if (p.obstacleMode) {
        const id = addObstacleInternal(state, at);
        p.onObstacleAdded?.(at, id);
      }
      p.onFloorClick?.(at);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    propsRef.current.onReady?.();

    // ---- Teardown ----------------------------------------------------------
    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      for (const label of state.labels) label.el.remove();
      state.labels = [];
      if (state.roomRoot) disposeObject(state.roomRoot);
      state.robot?.mixer.stopAllAction();
      disposeObject(robotGroup);
      disposeObject(obstaclesGroup);
      disposeObject(pathGroup);
      renderer.dispose();
      renderer.domElement.remove();
      stateRef.current = null;
    };
    // Mount-only: props are read live via propsRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Imperative handle ---------------------------------------------------
  useImperativeHandle(
    ref,
    (): RoomViewerHandle => ({
      loadGlb(buffer: ArrayBuffer) {
        return new Promise<void>((resolve, reject) => {
          const S = stateRef.current;
          if (!S) {
            reject(new Error('RoomViewer not ready'));
            return;
          }
          const loader = new GLTFLoader();
          loader.parse(
            buffer,
            '',
            async (gltf: GLTF) => {
              try {
                if (S.roomRoot) {
                  S.scene.remove(S.roomRoot);
                  disposeObject(S.roomRoot);
                  S.roomRoot = null;
                }
                const root = new THREE.Group();
                root.name = 'roomRoot';
                root.add(gltf.scene);

                // Bounding box before recentering (Scaniverse GLBs are Y-up meters).
                const box0 = new THREE.Box3().setFromObject(root);
                const center0 = box0.getCenter(new THREE.Vector3());
                const size = box0.getSize(new THREE.Vector3());

                // Center in XZ; leave Y so min Y stays the floor.
                root.position.x = -center0.x;
                root.position.z = -center0.z;
                S.scene.add(root);
                S.roomRoot = root;
                S.floorY = box0.min.y;
                S.bounds = {
                  minX: -size.x / 2,
                  maxX: size.x / 2,
                  minZ: -size.z / 2,
                  maxZ: size.z / 2,
                };

                // Fit camera to the recentered model.
                const box = new THREE.Box3().setFromObject(root);
                const bc = box.getCenter(new THREE.Vector3());
                const bs = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(bs.x, bs.y, bs.z) || 1;
                const fov = (S.camera.fov * Math.PI) / 180;
                const dist = ((maxDim / 2) / Math.tan(fov / 2)) * 1.5;
                const viewDir = new THREE.Vector3(0.75, 0.85, 0.75).normalize();
                S.camera.position.copy(bc).add(viewDir.multiplyScalar(dist));
                S.camera.near = Math.max(dist / 1000, 0.01);
                S.camera.far = dist * 1000;
                S.camera.updateProjectionMatrix();
                S.controls.target.copy(bc);
                S.controls.maxDistance = dist * 4;
                S.controls.update();
                // Optionally swap the capsule for public/robot.glb. Never blocks
                // or fails the room load: it catches everything internally.
                await ensureRobotModel(S);
                resolve();
              } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
              }
            },
            (err: unknown) => {
              const msg =
                err && typeof err === 'object' && 'message' in err
                  ? String((err as { message: unknown }).message)
                  : 'GLB parse failed';
              reject(new Error(msg));
            },
          );
        });
      },

      renderTopDown() {
        const cap = captureTopDownRaw(stateRef.current, TOPDOWN_PX);
        if (!cap) return { imageDataUrl: '', bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } };
        const { raw, framed } = cap;
        const canvas = document.createElement('canvas');
        canvas.width = TOPDOWN_PX;
        canvas.height = TOPDOWN_PX;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { imageDataUrl: '', bounds: framed };
        ctx.putImageData(new ImageData(new Uint8ClampedArray(raw), TOPDOWN_PX, TOPDOWN_PX), 0, 0);
        return { imageDataUrl: canvas.toDataURL('image/png'), bounds: framed };
      },

      renderTopDownTiles() {
        const emptyBounds: Bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
        // ONE high-res top-down render; the 5 outputs are pure 2D-canvas crops.
        const cap = captureTopDownRaw(stateRef.current, TOPDOWN_HQ_PX);
        if (!cap) return { bounds: emptyBounds, images: [] };
        const { raw, framed } = cap;

        // Offscreen source canvas holding the full high-res capture.
        const source = document.createElement('canvas');
        source.width = TOPDOWN_HQ_PX;
        source.height = TOPDOWN_HQ_PX;
        const sctx = source.getContext('2d');
        if (!sctx) return { bounds: framed, images: [] };
        sctx.putImageData(new ImageData(new Uint8ClampedArray(raw), TOPDOWN_HQ_PX, TOPDOWN_HQ_PX), 0, 0);

        // Fractions of the framed square, x-right / z-down (imageToWorld convention).
        // [0] = full frame (global context); [1..4] = 4 overlapping quadrants each
        // spanning 60% per axis (20% overlap on shared edges), so an object near a
        // tile boundary is captured whole in a neighbor rather than split by both.
        const fracRects = [
          { x0: 0, x1: 1, z0: 0, z1: 1 }, // full room
          { x0: 0, x1: 0.6, z0: 0, z1: 0.6 }, // top-left
          { x0: 0.4, x1: 1, z0: 0, z1: 0.6 }, // top-right
          { x0: 0, x1: 0.6, z0: 0.4, z1: 1 }, // bottom-left
          { x0: 0.4, x1: 1, z0: 0.4, z1: 1 }, // bottom-right
        ];

        const fw = framed.maxX - framed.minX;
        const fd = framed.maxZ - framed.minZ;

        const images = fracRects.map((r) => {
          // World sub-rectangle for this tile (interpolate into framed).
          const tileBounds: Bounds = {
            minX: framed.minX + r.x0 * fw,
            maxX: framed.minX + r.x1 * fw,
            minZ: framed.minZ + r.z0 * fd,
            maxZ: framed.minZ + r.z1 * fd,
          };
          // Source pixel rect, drawn (and upscaled for crops) onto a TOPDOWN_PX tile.
          const sx = r.x0 * TOPDOWN_HQ_PX;
          const sy = r.z0 * TOPDOWN_HQ_PX;
          const sw = (r.x1 - r.x0) * TOPDOWN_HQ_PX;
          const sh = (r.z1 - r.z0) * TOPDOWN_HQ_PX;

          const canvas = document.createElement('canvas');
          canvas.width = TOPDOWN_PX;
          canvas.height = TOPDOWN_PX;
          const ctx = canvas.getContext('2d');
          if (!ctx) return { imageDataUrl: '', bounds: tileBounds };
          ctx.drawImage(source, sx, sy, sw, sh, 0, 0, TOPDOWN_PX, TOPDOWN_PX);
          return { imageDataUrl: canvas.toDataURL('image/png'), bounds: tileBounds };
        });

        return { bounds: framed, images };
      },

      getRoomRoot() {
        return stateRef.current?.roomRoot ?? null;
      },

      getFloorY() {
        return stateRef.current?.floorY ?? 0;
      },

      setRobotPose(pose) {
        const S = stateRef.current;
        if (!S) return;
        S.robotGroup.visible = true;
        // Estimate speed from consecutive poses to drive walk<->idle. A large gap
        // (first sample / teleport / paused tab) is not motion => speed 0.
        const now = performance.now();
        const prev = S.lastPose;
        if (prev && now > prev.t && now - prev.t < ROBOT_POSE_MAX_DT_MS) {
          const dist = Math.hypot(pose.position.x - prev.x, pose.position.z - prev.z);
          S.robotSpeed = dist / ((now - prev.t) / 1000);
        } else {
          S.robotSpeed = 0;
        }
        S.lastPose = { x: pose.position.x, z: pose.position.z, t: now };
        S.robotGroup.position.set(pose.position.x, S.floorY, pose.position.z);
        // Forward cone models local +X; rotation.y = -heading maps +X to
        // (cos h, 0, sin h) = world travel direction for heading = atan2(dz, dx).
        S.robotGroup.rotation.set(0, -pose.headingRad, 0);
      },

      setPath(points) {
        const S = stateRef.current;
        if (!S) return;
        // Clear previous.
        for (let i = S.pathGroup.children.length - 1; i >= 0; i--) {
          const child = S.pathGroup.children[i];
          S.pathGroup.remove(child);
          disposeObject(child);
        }
        if (!points.length) return;
        const y = S.floorY + 0.02;
        const verts = points.map((p) => new THREE.Vector3(p.x, y, p.z));
        const geo = new THREE.BufferGeometry().setFromPoints(verts);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: EMERALD }),
        );
        S.pathGroup.add(line);
        // Waypoint dots (a 1px line is easy to lose at demo distance).
        const dotGeo = new THREE.SphereGeometry(0.06, 12, 12);
        const dotMat = new THREE.MeshBasicMaterial({ color: EMERALD });
        for (const p of points) {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          dot.position.set(p.x, y, p.z);
          S.pathGroup.add(dot);
        }
      },

      addObstacle(at) {
        const S = stateRef.current;
        if (!S) return '';
        return addObstacleInternal(S, at);
      },

      removeObstacle(id) {
        const S = stateRef.current;
        if (!S) return;
        const entry = S.obstacles.get(id);
        if (!entry) return;
        S.obstaclesGroup.remove(entry.mesh);
        disposeObject(entry.mesh);
        S.obstacles.delete(id);
      },

      getObstacles() {
        const S = stateRef.current;
        if (!S) return [];
        return Array.from(S.obstacles.entries()).map(([id, o]) => ({ id, at: o.at }));
      },

      clearObstacles() {
        const S = stateRef.current;
        if (!S) return;
        for (const { mesh } of S.obstacles.values()) {
          S.obstaclesGroup.remove(mesh);
          disposeObject(mesh);
        }
        S.obstacles.clear();
      },

      getRobotModelKind() {
        return stateRef.current?.robot ? 'glb' : 'capsule';
      },

      setLabels(objects: SceneObject[]) {
        const S = stateRef.current;
        const overlay = overlayRef.current;
        if (!S || !overlay) return;
        for (const label of S.labels) label.el.remove();
        S.labels = [];
        for (const obj of objects) {
          const el = document.createElement('div');
          el.textContent = obj.name;
          el.style.position = 'absolute';
          el.style.left = '0';
          el.style.top = '0';
          el.style.padding = '2px 8px';
          el.style.borderRadius = '9999px';
          el.style.fontSize = '12px';
          el.style.lineHeight = '18px';
          el.style.fontWeight = '500';
          el.style.whiteSpace = 'nowrap';
          el.style.color = '#ecfdf5';
          el.style.background = 'rgba(4, 47, 46, 0.82)';
          el.style.border = '1px solid rgba(52, 211, 153, 0.7)';
          el.style.boxShadow = '0 1px 6px rgba(0,0,0,0.4)';
          el.style.pointerEvents = 'none';
          el.style.willChange = 'transform';
          overlay.appendChild(el);
          S.labels.push({ position: obj.position, el });
        }
      },

      clearScene() {
        const S = stateRef.current;
        if (!S) return;
        if (S.roomRoot) {
          S.scene.remove(S.roomRoot);
          disposeObject(S.roomRoot);
          S.roomRoot = null;
        }
        // Obstacles.
        for (const { mesh } of S.obstacles.values()) {
          S.obstaclesGroup.remove(mesh);
          disposeObject(mesh);
        }
        S.obstacles.clear();
        // Path.
        for (let i = S.pathGroup.children.length - 1; i >= 0; i--) {
          const child = S.pathGroup.children[i];
          S.pathGroup.remove(child);
          disposeObject(child);
        }
        // Labels.
        for (const label of S.labels) label.el.remove();
        S.labels = [];
        // Robot (keep the loaded model/rig; just hide it and drop stale motion).
        S.robotGroup.visible = false;
        S.lastPose = null;
        S.robotSpeed = 0;
        S.floorY = 0;
        S.bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
      },
    }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className={props.className}
      style={{ position: 'relative', overflow: 'hidden' }}
    >
      <div
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
});

// ---- Skinned robot model ---------------------------------------------------

// Try to fetch + install public/robot.glb, replacing the capsule. Idempotent and
// total: once a model is loaded it's cached; a missing/broken file leaves the
// capsule and logs once. Never throws — the room load must not depend on this.
async function ensureRobotModel(S: ViewerState): Promise<void> {
  if (S.robot || S.robotLoading) return; // already have it / in flight
  S.robotLoading = true;
  try {
    const res = await fetch(ROBOT_GLB_URL);
    if (!res.ok) {
      if (!S.robotInfoLogged) {
        console.info(`[RoomViewer] no ${ROBOT_GLB_URL} (${res.status}) — using capsule robot`);
        S.robotInfoLogged = true;
      }
      return;
    }
    const buffer = await res.arrayBuffer();
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, (e) =>
        reject(e instanceof Error ? e : new Error('robot.glb parse failed')),
      );
    });

    const model = gltf.scene;
    // Skinned meshes are easily mis-culled; keep them always drawn.
    model.traverse((o) => {
      o.frustumCulled = false;
    });

    // Normalize: uniform scale to target height, recenter XZ, drop bbox bottom to 0.
    model.updateWorldMatrix(true, true);
    const box0 = new THREE.Box3().setFromObject(model);
    const size0 = box0.getSize(new THREE.Vector3());
    const scale = ROBOT_TARGET_HEIGHT / (size0.y || 1);
    model.scale.setScalar(scale);
    model.updateWorldMatrix(true, true);
    const box1 = new THREE.Box3().setFromObject(model);
    const c1 = box1.getCenter(new THREE.Vector3());
    model.position.x -= c1.x;
    model.position.z -= c1.z;
    model.position.y -= box1.min.y;

    const wrapper = new THREE.Group();
    wrapper.name = 'robotModel';
    wrapper.rotation.y = ROBOT_YAW_OFFSET; // map glTF forward (+Z) onto our +X heading
    wrapper.add(model);

    // Clip selection: name-match walk/idle; single clip => walk; else first != idle.
    const clips = gltf.animations ?? [];
    const idleClip = clips.find((c) => /idle|stand/i.test(c.name)) ?? null;
    let walkClip = clips.find((c) => /walk|run/i.test(c.name)) ?? null;
    if (!walkClip) {
      if (clips.length === 1) walkClip = clips[0];
      else walkClip = clips.find((c) => c !== idleClip) ?? clips[0] ?? null;
    }

    const mixer = new THREE.AnimationMixer(model);
    const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;

    // Start in the resting state: idle if we have it, else a frozen walk pose.
    if (idleAction) {
      idleAction.play();
    } else if (walkAction) {
      walkAction.play();
      walkAction.paused = true;
    }

    // Swap the capsule out for the model.
    S.robotGroup.remove(S.capsuleGroup);
    disposeObject(S.capsuleGroup);
    S.robotGroup.add(wrapper);
    S.robot = { wrapper, mixer, walkAction, idleAction, walking: false };
    console.info(
      `[RoomViewer] robot model loaded from ${ROBOT_GLB_URL} ` +
        `(walk=${walkClip?.name ?? 'none'}, idle=${idleClip?.name ?? 'none'})`,
    );
  } catch (err) {
    if (!S.robotInfoLogged) {
      console.info(
        `[RoomViewer] ${ROBOT_GLB_URL} unusable (${
          err instanceof Error ? err.message : String(err)
        }) — using capsule robot`,
      );
      S.robotInfoLogged = true;
    }
  } finally {
    S.robotLoading = false;
  }
}

// Per-frame: crossfade walk<->idle from the measured speed and advance the mixer.
function updateRobotLocomotion(S: ViewerState, dt: number): void {
  const r = S.robot;
  if (!r) return;
  // Poses stop arriving when the robot stops; time out to fall back to idle.
  const stopped = !S.lastPose || performance.now() - S.lastPose.t > ROBOT_STOP_TIMEOUT_MS;
  const speed = stopped ? 0 : S.robotSpeed;
  const walking = speed > ROBOT_MOVE_SPEED_THRESHOLD;

  if (walking !== r.walking) {
    r.walking = walking;
    if (r.walkAction && r.idleAction) {
      const from = walking ? r.idleAction : r.walkAction;
      const to = walking ? r.walkAction : r.idleAction;
      crossFade(from, to, ROBOT_CROSSFADE_SEC);
    } else if (r.walkAction) {
      // Single-clip model: freeze it when idle, run it when moving.
      r.walkAction.paused = !walking;
      if (walking) r.walkAction.play();
    }
  }
  if (walking && r.walkAction) {
    r.walkAction.timeScale = Math.min(
      Math.max(speed / ROBOT_WALK_REF_SPEED, 0.4),
      2.5,
    );
  }
  r.mixer.update(dt);
}

// Weight crossfade between two actions (both must belong to the same mixer).
function crossFade(
  from: THREE.AnimationAction,
  to: THREE.AnimationAction,
  duration: number,
): void {
  to.enabled = true;
  to.setEffectiveTimeScale(1);
  to.setEffectiveWeight(1);
  to.time = 0;
  to.play();
  if (from === to) return;
  from.crossFadeTo(to, duration, true);
}

// Shared obstacle creator used by both the click handler and addObstacle().
function addObstacleInternal(S: ViewerState, at: Vec2): string {
  const id = nanoid();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(OBSTACLE_SIZE, OBSTACLE_SIZE, OBSTACLE_SIZE),
    new THREE.MeshStandardMaterial({
      color: OBSTACLE_RED,
      roughness: 0.5,
      emissive: OBSTACLE_RED,
      emissiveIntensity: 0.2,
    }),
  );
  mesh.position.set(at.x, S.floorY + OBSTACLE_SIZE / 2, at.z);
  S.obstaclesGroup.add(mesh);
  S.obstacles.set(id, { mesh, at });
  return id;
}

export default RoomViewer;
