// Generates public/sample-room.glb: a simple scanned-room stand-in so the whole
// pipeline (viewer -> label -> plan -> sim) has something to run against before a
// real Scaniverse .glb is uploaded. Run with `npm run gen:room`.
//
// Layout (world meters, XZ ground plane, Y up, origin centered):
//   floor 6m (x) x 4m (z), walls 2.5m high, 1m doorway gap in the SOUTH wall (+z),
//   a "table" at center, a "sofa" against the NORTH wall (-z).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Blob as NodeBlob } from 'node:buffer';

// --- Polyfill browser globals the GLTFExporter binary path needs in Node ------
if (typeof globalThis.Blob === 'undefined') globalThis.Blob = NodeBlob;
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = buf;
        this.onloadend?.();
      });
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        const b64 = Buffer.from(buf).toString('base64');
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
        this.onloadend?.();
      });
    }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '..', 'public', 'sample-room.glb');

const FLOOR_W = 6; // x
const FLOOR_D = 4; // z
const WALL_H = 2.5;
const WALL_T = 0.1;
const DOOR_W = 1; // doorway gap width in the south wall

const scene = new THREE.Scene();
scene.name = 'SampleRoom';

function box(w, h, d, color, name, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 }),
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  scene.add(mesh);
  return mesh;
}

// Floor: thin slab, top surface at y = 0.
box(FLOOR_W, WALL_T, FLOOR_D, 0x9aa0a6, 'floor', 0, -WALL_T / 2, 0);

const wallColor = 0xd9d4cc;
const halfW = FLOOR_W / 2; // 3
const halfD = FLOOR_D / 2; // 2

// North wall (-z), full width.
box(FLOOR_W, WALL_H, WALL_T, wallColor, 'wall_north', 0, WALL_H / 2, -halfD);
// East wall (+x).
box(WALL_T, WALL_H, FLOOR_D, wallColor, 'wall_east', halfW, WALL_H / 2, 0);
// West wall (-x).
box(WALL_T, WALL_H, FLOOR_D, wallColor, 'wall_west', -halfW, WALL_H / 2, 0);
// South wall (+z), split into two segments leaving a centered 1m doorway.
const segW = (FLOOR_W - DOOR_W) / 2; // 2.5
const segOffset = DOOR_W / 2 + segW / 2; // 1.75
box(segW, WALL_H, WALL_T, wallColor, 'wall_south_left', -segOffset, WALL_H / 2, halfD);
box(segW, WALL_H, WALL_T, wallColor, 'wall_south_right', segOffset, WALL_H / 2, halfD);

// Table (1.2 x 0.75 x 0.8 => w,h,d), centered.
box(1.2, 0.75, 0.8, 0x8a5a2b, 'table', 0, 0.75 / 2, 0);

// Sofa (2.0 x 0.8 x 0.9 => w,h,d), against north wall.
const sofaD = 0.9;
box(2.0, 0.8, sofaD, 0x3f7a8c, 'sofa', 0, 0.8 / 2, -halfD + WALL_T + sofaD / 2);

const exporter = new GLTFExporter();
exporter.parse(
  scene,
  (result) => {
    if (!(result instanceof ArrayBuffer)) {
      console.error('Expected ArrayBuffer from binary GLTFExporter, got', typeof result);
      process.exit(1);
    }
    mkdirSync(path.dirname(outPath), { recursive: true });
    const buf = Buffer.from(result);
    writeFileSync(outPath, buf);
    console.log(`Wrote ${outPath} (${buf.length} bytes)`);
  },
  (err) => {
    console.error('GLTF export failed:', err);
    process.exit(1);
  },
  { binary: true },
);
