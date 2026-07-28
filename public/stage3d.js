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
const DEPTH_BOB_PX = 12;
const MAGNETIC_BREATH_AMOUNT = 0.018;
const MAGNETIC_BREATH_SPEED = 1.1;
const TRAIL_SPEED_THRESHOLD = 1;
const TRAIL_SPEED_SCALE = 7;
const TRAIL_MAX_FRAME_SPEED = 18;
const TRAIL_MAX_LENGTH_RATIO = 1.35;
const TRAIL_PRIMARY_REDUCTION = 0.16;
const TRAIL_SAMPLES = [
  { offset: 0.2, strength: 0.18 },
  { offset: 0.4, strength: 0.14 },
  { offset: 0.6, strength: 0.1 },
  { offset: 0.8, strength: 0.07 },
  { offset: 1, strength: 0.05 },
];

const stage = document.getElementById("stage");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
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

  const key = new THREE.DirectionalLight(0xfff8ef, 0.38);
  key.position.set(-0.6, 1, 1.2);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x34373d, 1.05));
  scene.add(new THREE.AmbientLight(0xffffff, 0.24));

  /* ---- surface material with per-ball color/texture blending ----
     Instead of vertex colors, a shader injection colors every fragment from
     the balls' field influence: text blobs contribute their flat color, image
     blobs contribute their photo projected as a camera-facing decal around
     the ball. Merged goo cross-fades between them in the neck. */

  const MAXB = 5;
  const placeholderTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  placeholderTex.needsUpdate = true;

  const ballUniforms = {
    uCount: { value: 0 },
    uPos: { value: Array.from({ length: MAXB }, () => new THREE.Vector3()) },
    uRad: { value: new Float32Array(MAXB).fill(1) },
    uBallCol: { value: Array.from({ length: MAXB }, () => new THREE.Color(1, 1, 1)) },
    uHasTex: { value: new Float32Array(MAXB) },
    uTexAspect: { value: new Float32Array(MAXB).fill(1) },
    uCollapse: { value: 0 },
  };
  for (let i = 0; i < MAXB; i++) ballUniforms[`uTex${i}`] = { value: placeholderTex };

  const material = new THREE.MeshPhysicalMaterial({
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.08,
    clearcoatRoughness: 0.72,
    specularIntensity: 0.22,
    ior: 1.32,
    envMapIntensity: 0.48,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ballUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBallWorld;")
      .replace(
        "#include <project_vertex>",
        "vBallWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#include <project_vertex>"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vBallWorld;
uniform int uCount;
uniform vec3 uPos[${MAXB}];
uniform float uRad[${MAXB}];
uniform vec3 uBallCol[${MAXB}];
uniform float uHasTex[${MAXB}];
uniform float uTexAspect[${MAXB}];
uniform float uCollapse;
uniform sampler2D uTex0; uniform sampler2D uTex1; uniform sampler2D uTex2; uniform sampler2D uTex3; uniform sampler2D uTex4;
vec4 fuseTexture(sampler2D image, vec2 uv, float blur) {
  vec2 offset = vec2(blur);
  return texture2D(image, uv) * 0.4
    + texture2D(image, clamp(uv + vec2(offset.x, 0.0), 0.001, 0.999)) * 0.15
    + texture2D(image, clamp(uv - vec2(offset.x, 0.0), 0.001, 0.999)) * 0.15
    + texture2D(image, clamp(uv + vec2(0.0, offset.y), 0.001, 0.999)) * 0.15
    + texture2D(image, clamp(uv - vec2(0.0, offset.y), 0.001, 0.999)) * 0.15;
}
vec2 fuseBallUv(vec3 p, int index) {
  vec2 center = uPos[index].xy;
  float radius = max(uRad[index], 1.0);
  vec2 local = (p.xy - center) / (2.3 * radius);
  float selfField = radius * radius / (dot(p.xy - center, p.xy - center) + 80.0);
  for (int j = 0; j < ${MAXB}; j++) {
    if (j >= uCount) break;
    if (j == index) continue;
    vec2 between = uPos[j].xy - center;
    float centerDistance = length(between);
    vec2 direction = between / max(centerDistance, 1.0);
    float reach = radius + uRad[j];
    float merge = 1.0 - smoothstep(0.78, 1.18, centerDistance / max(reach, 1.0));
    vec2 otherDelta = p.xy - uPos[j].xy;
    float otherField = uRad[j] * uRad[j] / (dot(otherDelta, otherDelta) + 80.0);
    float neck = smoothstep(0.12, 0.55, otherField / max(selfField + otherField, 0.0001));
    float along = dot(local, direction);
    local -= direction * along * merge * neck * 0.42;
    vec2 perpendicular = vec2(-direction.y, direction.x);
    local += perpendicular * sin(along * 5.0) * merge * neck * 0.025;
  }
  vec2 uv = local + 0.5;
  float aspect = max(uTexAspect[index], 0.001);
  if (aspect > 1.0) {
    uv.x = (uv.x - 0.5) / aspect + 0.5;
  } else {
    uv.y = (uv.y - 0.5) * aspect + 0.5;
  }
  return clamp(uv, 0.001, 0.999);
}`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float textureBlur = smoothstep(0.08, 1.0, uCollapse) * 0.024;
  vec4 t0 = fuseTexture(uTex0, fuseBallUv(vBallWorld, 0), textureBlur);
  vec4 t1 = fuseTexture(uTex1, fuseBallUv(vBallWorld, 1), textureBlur);
  vec4 t2 = fuseTexture(uTex2, fuseBallUv(vBallWorld, 2), textureBlur);
  vec4 t3 = fuseTexture(uTex3, fuseBallUv(vBallWorld, 3), textureBlur);
  vec4 t4 = fuseTexture(uTex4, fuseBallUv(vBallWorld, 4), textureBlur);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < ${MAXB}; i++) {
    if (i >= uCount) break;
    vec3 dp = vBallWorld - uPos[i];
    float w = pow(uRad[i] * uRad[i] / (dot(dp, dp) + 60.0), 2.6);
    vec4 t = (i == 0) ? t0 : (i == 1) ? t1 : (i == 2) ? t2 : (i == 3) ? t3 : t4;
    vec3 c = mix(uBallCol[i], t.rgb, t.a * uHasTex[i]);
    acc += c * w;
    wsum += w;
  }
  vec3 fusedColor = acc / max(wsum, 1e-4);
  float luminance = dot(fusedColor, vec3(0.2126, 0.7152, 0.0722));
  fusedColor = mix(fusedColor, vec3(luminance), uCollapse * 0.16);
  fusedColor = mix(vec3(0.5), fusedColor, 1.0 - uCollapse * 0.1);
  diffuseColor.rgb = fusedColor;
}`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  vec3 wrapDirection = normalize(vec3(-0.35, 0.5, 0.8));
  float wrapLight = smoothstep(-0.3, 1.0, dot(normal, wrapDirection));
  float facing = clamp(normal.z, 0.0, 1.0);
  diffuseColor.rgb *= mix(0.76, 1.04, wrapLight) * mix(0.9, 1.0, facing);
}`
      );
  };

  const mc = new MarchingCubes(RESOLUTION, material, false, false, 40000);
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

  const balls = new Map(); // id -> {x, y, r, colorLin, tex, phase} (display pos)
  const texLoader = new THREE.TextureLoader();
  let logical = []; // latest list from app.js
  let collapseTo = null; // {x, y} while a fusion is running
  let collapseAmount = 0;

  function loadBallTexture(state, dataUrl) {
    texLoader.load(dataUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      state.tex = tex;
      const image = tex.image || {};
      const imageWidth = image.naturalWidth || image.videoWidth || image.width || 1;
      const imageHeight = image.naturalHeight || image.videoHeight || image.height || 1;
      state.texAspect = imageWidth / imageHeight;
    });
  }

  function setBlobs(list) {
    logical = list;
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let s = balls.get(b.id);
      if (!s) {
        s = {
          x: b.x,
          y: b.y,
          r: 0, // grow in from nothing — a little birth animation
          colorLin: new THREE.Color(b.color).convertSRGBToLinear(),
          tex: null,
          texUrl: null,
          texAspect: 1,
          phase: Math.random() * Math.PI * 2,
          trailVx: 0,
          trailVy: 0,
        };
        balls.set(b.id, s);
      } else {
        s.colorLin.set(b.color).convertSRGBToLinear();
      }
      if (b.dataUrl && s.texUrl !== b.dataUrl) {
        s.texUrl = b.dataUrl;
        loadBallTexture(s, b.dataUrl);
      }
    }
    for (const [id, s] of balls) {
      if (!seen.has(id)) {
        s.tex?.dispose();
        balls.delete(id);
      }
    }
  }

  function collapse(center) {
    collapseTo = center;
    if (reducedMotionQuery.matches) collapseAmount = 1;
  }
  function release() {
    collapseTo = null;
    if (reducedMotionQuery.matches) collapseAmount = 0;
  }

  /* ---- render loop ---- */

  const clock = new THREE.Clock();

  function frame() {
    requestAnimationFrame(frame);
    const t = clock.getElapsedTime();
    const collapseTarget = collapseTo ? 1 : 0;
    collapseAmount += (collapseTarget - collapseAmount) * (collapseTo ? 0.035 : 0.09);
    if (Math.abs(collapseTarget - collapseAmount) < 0.001) collapseAmount = collapseTarget;
    ballUniforms.uCollapse.value = collapseAmount;

    let pulseX = 0;
    let pulseY = 0;
    let pulseWeight = 0;
    for (const blob of logical) {
      const weight = blob.r * blob.r;
      pulseX += blob.x * weight;
      pulseY += blob.y * weight;
      pulseWeight += weight;
    }
    pulseX /= Math.max(pulseWeight, 1);
    pulseY /= Math.max(pulseWeight, 1);
    const magneticBreathActive = (
      logical.length > 1
      && !collapseTo
      && !reducedMotionQuery.matches
      && !logical.some((blob) => blob.dragging)
    );
    const magneticScale = magneticBreathActive
      ? 1 + Math.sin(t * MAGNETIC_BREATH_SPEED) * MAGNETIC_BREATH_AMOUNT
      : 1;

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
      const tx = collapseTo ? collapseTo.x : pulseX + (b.x - pulseX) * magneticScale;
      const ty = collapseTo ? collapseTo.y : pulseY + (b.y - pulseY) * magneticScale;
      const tr = collapseTo ? b.r * 0.82 : b.r;
      const k = reducedMotionQuery.matches ? 1 : collapseTo ? 0.045 : b.dragging ? 1 : 0.16;
      const previousX = s.x;
      const previousY = s.y;
      s.x += (tx - s.x) * k;
      s.y += (ty - s.y) * k;
      s.r += (tr - s.r) * 0.12;

      const trailEase = b.dragging ? 0.3 : 0.14;
      const rawTrailVx = b.dragging ? s.x - previousX : 0;
      const rawTrailVy = b.dragging ? s.y - previousY : 0;
      const rawTrailSpeed = Math.hypot(rawTrailVx, rawTrailVy);
      const trailVelocityScale = rawTrailSpeed > TRAIL_MAX_FRAME_SPEED
        ? TRAIL_MAX_FRAME_SPEED / rawTrailSpeed
        : 1;
      const targetTrailVx = rawTrailVx * trailVelocityScale;
      const targetTrailVy = rawTrailVy * trailVelocityScale;
      s.trailVx += (targetTrailVx - s.trailVx) * trailEase;
      s.trailVy += (targetTrailVy - s.trailVy) * trailEase;
      const trailSpeed = Math.hypot(s.trailVx, s.trailVy);
      const maxTrailLength = s.r * TRAIL_MAX_LENGTH_RATIO;
      const trailLength = trailSpeed > TRAIL_SPEED_THRESHOLD
        ? Math.min(maxTrailLength, (trailSpeed - TRAIL_SPEED_THRESHOLD) * TRAIL_SPEED_SCALE)
        : 0;
      const trailAmount = maxTrailLength > 0 ? trailLength / maxTrailLength : 0;
      const trailX = trailSpeed > 0 ? (s.trailVx / trailSpeed) * trailLength : 0;
      const trailY = trailSpeed > 0 ? (s.trailVy / trailSpeed) * trailLength : 0;

      const squish = collapseTo ? 0.35 : 1;
      const wx = s.x + Math.sin(t * 0.7 + s.phase) * WOBBLE_PX * squish;
      const wy = s.y + Math.cos(t * 0.9 + s.phase * 1.7) * WOBBLE_PX * squish;
      const wr = (s.r * VIS_BOOST + 8) * (1 + 0.05 * Math.sin(t * 1.4 + s.phase));
      const wz = DEPTH_BOB_PX * Math.sin(t * 0.55 + s.phase * 2.3);

      view.push({
        x: wx,
        y: wy,
        r: wr,
        z: wz,
        trailX,
        trailY,
        trailAmount,
        colorLin: s.colorLin,
        tex: s.tex,
        texAspect: s.texAspect || 1,
      });
      minX = Math.min(minX, wx - wr);
      maxX = Math.max(maxX, wx + wr);
      minY = Math.min(minY, wy - wr);
      maxY = Math.max(maxY, wy + wr);
    }

    // Fit the field cube snugly around the balls. During collapse, overlapping
    // fields add together and create a surface larger than any one radius, so
    // reserve space from their root-sum-square instead of clipping the shell.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const baseHalf = Math.max(maxX - minX, maxY - minY) / 2 + MARGIN;
    const combinedHalf = Math.sqrt(view.reduce((sum, item) => sum + item.r * item.r, 0)) + MARGIN;
    const collapseHalf = THREE.MathUtils.lerp(baseHalf, Math.max(baseHalf, combinedHalf), collapseAmount);
    const half = collapseTo ? collapseHalf : baseHalf;

    mc.position.set(cx, height - cy, 0);
    mc.scale.set(half, half, half);

    ballUniforms.uCount.value = view.length;
    mc.reset();
    view.forEach((v, i) => {
      // ball coords are 0..1 across the cube (local -1..1 after scaling)
      const bx = (v.x - (cx - half)) / (2 * half);
      const by = (height - v.y - (height - cy - half)) / (2 * half);
      const bz = 0.5 + v.z / (2 * half);
      const rNorm = v.r / (2 * half);
      const primaryStrength = 1 - v.trailAmount * TRAIL_PRIMARY_REDUCTION;
      mc.addBall(bx, by, bz, STRENGTH_SCALE * rNorm * rNorm * primaryStrength, SUBTRACT);
      for (const sample of TRAIL_SAMPLES) {
        if (v.trailX === 0 && v.trailY === 0) break;
        const sampleX = v.x - v.trailX * sample.offset;
        const sampleY = v.y - v.trailY * sample.offset;
        const sampleBx = (sampleX - (cx - half)) / (2 * half);
        const sampleBy = (height - sampleY - (height - cy - half)) / (2 * half);
        mc.addBall(
          sampleBx,
          sampleBy,
          bz,
          STRENGTH_SCALE * rNorm * rNorm * sample.strength * v.trailAmount,
          SUBTRACT
        );
      }

      // Mirror into the surface shader (world coords, y up)
      ballUniforms.uPos.value[i].set(v.x, height - v.y, v.z);
      ballUniforms.uRad.value[i] = v.r;
      ballUniforms.uBallCol.value[i].copy(v.colorLin);
      ballUniforms.uHasTex.value[i] = v.tex ? 1 : 0;
      ballUniforms.uTexAspect.value[i] = v.tex ? v.texAspect : 1;
      ballUniforms[`uTex${i}`].value = v.tex || placeholderTex;
    });
    mc.update();

    renderer.render(scene, camera);
  }
  frame();

  window.Stage3D = { active: true, setBlobs, collapse, release };
  document.body.classList.add("mode-3d");
  window.dispatchEvent(new Event("stage3d-ready"));
}
