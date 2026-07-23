/* 3D metaball stage — GPU-rendered glass goo via three.js MarchingCubes.
 *
 * Design: "3D visuals, 2D interaction model". Blobs stay logical 2D circles in
 * stage pixels (app.js owns drag/resize/weights); this module mirrors them as
 * metaballs on a plane facing an orthographic camera mapped 1:1 to CSS pixels,
 * so the goo sits exactly under the DOM overlay (labels, thumbnails, chips).
 *
 * The marching-cubes field cube is refitted each frame to the bounding box of
 * the balls, so surface resolution concentrates where the blobs are — smooth
 * merges when clustered, no wasted grid when spread out.
 *
 * If WebGL is unavailable this module quietly does nothing and app.js keeps
 * using the SVG-filter goo. */

import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const RESOLUTION = 64;
const SUBTRACT = 12;
const MARGIN = 60; // px of field space around the outermost ball
const VIS_BOOST = 1.12; // goo reads slightly larger than the logical circle
const WOBBLE_PX = 5;

const stage = document.getElementById("stage");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
} catch (err) {
  console.warn("stage3d: WebGL unavailable, keeping SVG goo.", err);
}

if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.id = "stage3d";
  stage.insertBefore(renderer.domElement, stage.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 8000);
  camera.position.set(0, 0, 2000);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-0.4, 1, 0.9);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a1650, 0.5));

  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.14,
    envMapIntensity: 0.9,
  });

  const mc = new MarchingCubes(RESOLUTION, material, false, true, 40000);
  mc.isolation = 80;
  mc.frustumCulled = false;
  scene.add(mc);

  // The isosurface sits where strength/d² − subtract = isolation, so a ball
  // with normalized radius rN needs strength = rN² · (isolation + subtract).
  const STRENGTH_SCALE = mc.isolation + SUBTRACT;

  let width = 0;
  let height = 0;
  function resize() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.left = 0;
    camera.right = width;
    camera.top = height;
    camera.bottom = 0;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  /* ---- ball state ---- */

  const balls = new Map(); // id -> {x, y, r, color, dx, dy, phase} (display pos)
  let logical = []; // latest list from app.js
  let collapseTo = null; // {x, y} while a fusion is running

  function setBlobs(list) {
    logical = list;
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      if (!balls.has(b.id)) {
        balls.set(b.id, {
          x: b.x,
          y: b.y,
          r: 0, // grow in from nothing — a little birth animation
          color: new THREE.Color(b.color),
          phase: Math.random() * Math.PI * 2,
        });
      } else {
        balls.get(b.id).color.set(b.color);
      }
    }
    for (const id of balls.keys()) if (!seen.has(id)) balls.delete(id);
  }

  function collapse(center) {
    collapseTo = center;
  }
  function release() {
    collapseTo = null;
  }

  /* ---- render loop ---- */

  const clock = new THREE.Clock();

  function frame() {
    requestAnimationFrame(frame);
    const t = clock.getElapsedTime();

    if (balls.size === 0) {
      mc.reset();
      mc.update();
      renderer.render(scene, camera);
      return;
    }

    // Advance display positions toward targets (logical pos, or collapse point)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const view = [];
    for (const b of logical) {
      const s = balls.get(b.id);
      if (!s) continue;
      const tx = collapseTo ? collapseTo.x : b.x;
      const ty = collapseTo ? collapseTo.y : b.y;
      const tr = collapseTo ? b.r * 0.82 : b.r;
      const k = collapseTo ? 0.045 : 0.16;
      s.x += (tx - s.x) * k;
      s.y += (ty - s.y) * k;
      s.r += (tr - s.r) * 0.12;

      const squish = collapseTo ? 0.35 : 1;
      const wx = s.x + Math.sin(t * 0.7 + s.phase) * WOBBLE_PX * squish;
      const wy = s.y + Math.cos(t * 0.9 + s.phase * 1.7) * WOBBLE_PX * squish;
      const wr = (s.r * VIS_BOOST + 8) * (1 + 0.05 * Math.sin(t * 1.4 + s.phase));
      const wz = 0.12 * Math.sin(t * 0.55 + s.phase * 2.3); // gentle depth bob, ±px added later

      view.push({ x: wx, y: wy, r: wr, z: wz, color: s.color });
      minX = Math.min(minX, wx - wr);
      maxX = Math.max(maxX, wx + wr);
      minY = Math.min(minY, wy - wr);
      maxY = Math.max(maxY, wy + wr);
    }

    // Fit the field cube snugly around the balls (square, with margin)
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const half = Math.max(maxX - minX, maxY - minY) / 2 + MARGIN;

    mc.position.set(cx, height - cy, 0);
    mc.scale.set(half, half, half);

    mc.reset();
    for (const v of view) {
      // ball coords are 0..1 across the cube (local -1..1 after scaling)
      const bx = (v.x - (cx - half)) / (2 * half);
      const by = (height - v.y - (height - cy - half)) / (2 * half);
      const bz = 0.5 + v.z;
      const rNorm = v.r / (2 * half);
      mc.addBall(bx, by, bz, STRENGTH_SCALE * rNorm * rNorm, SUBTRACT, v.color);
    }
    mc.update();

    renderer.render(scene, camera);
  }
  frame();

  window.Stage3D = { active: true, setBlobs, collapse, release };
  document.body.classList.add("mode-3d");
  window.dispatchEvent(new Event("stage3d-ready"));
}
