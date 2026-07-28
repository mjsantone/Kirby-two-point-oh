"use strict";

/* ---------------- State ---------------- */

const MAX_ITEMS = 5;
const DEFAULT_INFLUENCE = 100;
const MIN_INFLUENCE = 1;
const MAX_INFLUENCE = 100000;
const PALETTE = ["#ff7ac3", "#7ae0ff", "#ffd166", "#8bffb0", "#c9a2ff"];

let blobs = []; // {id, kind:'text'|'image', influence, text?, dataUrl?, mediaType?, name?, x, y, r, color}
let nextId = 1;
let selectedId = null;
let fusing = false;
let hintTimer = null;
let magneticFrame = null;
let lastMagneticAnchorId = null;

const stage = document.getElementById("stage");
const gooLayer = document.getElementById("goo-layer");
const contentLayer = document.getElementById("content-layer");
const emptyState = document.getElementById("empty-state");
const toolbar = document.getElementById("blob-toolbar");
const textEntry = document.getElementById("text-entry");
const textEntryInput = document.getElementById("text-entry-input");
const fuseBtn = document.getElementById("fuse-btn");
const directiveInput = document.getElementById("directive");
const fileInput = document.getElementById("file-input");
const addMenuTrigger = document.getElementById("add-menu-trigger");
const addMenu = document.getElementById("add-menu");
const typeMenuTrigger = document.getElementById("type-menu-trigger");
const typeMenu = document.getElementById("type-menu");
const selectedTypeLabel = document.getElementById("selected-type-label");

const resultPanel = document.getElementById("result-panel");
const resultStatus = document.getElementById("result-status");
const resultMeta = document.getElementById("result-meta");
const resultCode = document.getElementById("result-code");
const resultFrame = document.getElementById("result-frame");
const resultDownload = document.getElementById("result-download");
const resultRemix = document.getElementById("result-remix");
const resultSave = document.getElementById("result-save");
const resultShare = document.getElementById("result-share");
const resultImageWrap = document.getElementById("result-image-wrap");
const resultImage = document.getElementById("result-image");
const discoverPanel = document.getElementById("discover-panel");
const discoverGrid = document.getElementById("discover-grid");
const discoverLoading = document.getElementById("discover-loading");
const discoverEmpty = document.getElementById("discover-empty");
const discoverError = document.getElementById("discover-error");

let editingBlobId = null; // when the text entry is editing an existing blob
let lastArtifactHtml = "";
let lastImageDataUrl = "";
let resultKind = null; // 'html' | 'image'
let panelMode = "html"; // what this fuse run is producing: 'html' | 'image'
let liveAttached = false; // iframe is following the server's live HTML stream
let resultImageReady = null;
let activeDiscoverEntry = null;
let shareableDiscoverEntry = null;
let discoverItems = [];
const pendingDiscoverPreviews = new Map();
let discoverPreviewCheckQueued = false;

/* ---------------- Rendering ---------------- */

function weights() {
  const total = blobs.reduce((sum, blob) => sum + blob.influence, 0) || 1;
  const map = {};
  for (const blob of blobs) map[blob.id] = (100 * blob.influence) / total;
  return map;
}

function roundedWeights(weightMap) {
  const entries = blobs.map((blob, index) => {
    const exact = weightMap[blob.id];
    const floor = Math.floor(exact);
    return { id: blob.id, index, value: floor, remainder: exact - floor };
  });
  let remaining = 100 - entries.reduce((sum, entry) => sum + entry.value, 0);
  entries
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    .slice(0, remaining)
    .forEach((entry) => { entry.value += 1; });
  for (const entry of entries.filter((candidate) => candidate.value === 0)) {
    const donor = entries
      .filter((candidate) => candidate.value > 1)
      .sort((a, b) => b.value - a.value || b.remainder - a.remainder)[0];
    if (!donor) break;
    donor.value -= 1;
    entry.value = 1;
  }
  return Object.fromEntries(entries.map((entry) => [entry.id, entry.value]));
}

function visualRadiusRange() {
  const stageRect = stage.getBoundingClientRect();
  const topbarRect = document.querySelector(".topbar").getBoundingClientRect();
  const controlbarRect = document.querySelector(".controlbar").getBoundingClientRect();
  const usableHeight = Math.max(240, controlbarRect.top - topbarRect.bottom - 24);
  const min = Math.max(34, Math.min(48, stageRect.width * 0.09));
  const widthLimit = stageRect.width * (stageRect.width < 600 ? 0.42 : 0.2);
  const clusterLimit = stageRect.width < 600 && blobs.length >= 4
    ? stageRect.width * 0.31
    : Infinity;
  const max = Math.max(min + 1, Math.min(220, widthLimit, clusterLimit, usableHeight / 2));
  return { min, max };
}

function radiusForWeight(weight) {
  const { min, max } = visualRadiusRange();
  return Math.sqrt(min * min + (Math.max(0, Math.min(100, weight)) / 100) * (max * max - min * min));
}

function syncBlobRadii(weightMap = weights()) {
  for (const blob of blobs) {
    blob.r = radiusForWeight(weightMap[blob.id]);
    if (!Number.isFinite(blob.x) || !Number.isFinite(blob.y)) continue;
    const bounds = blobPositionBounds(blob.r);
    blob.x = Math.min(bounds.maxX, Math.max(bounds.minX, blob.x));
    blob.y = Math.min(bounds.maxY, Math.max(bounds.minY, blob.y));
  }
}

function magneticAnchor() {
  return [...blobs].sort((a, b) => b.influence - a.influence || a.id - b.id)[0] || null;
}

function normalizedAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function largestOpenMagneticAngle(excludedId = null) {
  const anchor = magneticAnchor();
  const occupied = blobs
    .filter((blob) => (
      blob.id !== excludedId
      && blob.id !== anchor?.id
      && Number.isFinite(blob.magneticAngle)
    ))
    .map((blob) => normalizedAngle(blob.magneticAngle))
    .sort((a, b) => a - b);
  if (!occupied.length) return -Math.PI / 2;
  let widestGap = -1;
  let angle = -Math.PI / 2;
  for (let index = 0; index < occupied.length; index++) {
    const start = occupied[index];
    const end = index === occupied.length - 1 ? occupied[0] + Math.PI * 2 : occupied[index + 1];
    if (end - start > widestGap) {
      widestGap = end - start;
      angle = normalizedAngle(start + widestGap / 2);
    }
  }
  return angle;
}

function spreadMagneticAngles(anchor = magneticAnchor()) {
  const satellites = blobs.filter((blob) => blob.id !== anchor?.id && Number.isFinite(blob.magneticAngle));
  if (satellites.length < 2) return;
  const minGap = Math.min(0.9, (Math.PI * 2 * 0.72) / satellites.length);
  for (let iteration = 0; iteration < 24; iteration++) {
    const ordered = [...satellites].sort(
      (a, b) => normalizedAngle(a.magneticAngle) - normalizedAngle(b.magneticAngle)
    );
    let adjusted = false;
    for (let index = 0; index < ordered.length; index++) {
      const current = ordered[index];
      const next = ordered[(index + 1) % ordered.length];
      const currentAngle = normalizedAngle(current.magneticAngle);
      const nextAngle = normalizedAngle(next.magneticAngle);
      const gap = normalizedAngle(nextAngle - currentAngle);
      if (gap >= minGap) continue;
      const correction = (minGap - gap) / 2;
      current.magneticAngle = normalizedAngle(currentAngle - correction);
      next.magneticAngle = normalizedAngle(nextAngle + correction);
      adjusted = true;
    }
    if (!adjusted) break;
  }
}

function magneticTargets() {
  const targets = new Map();
  if (!blobs.length) return targets;
  const stageRect = stage.getBoundingClientRect();
  const topbarRect = document.querySelector(".topbar").getBoundingClientRect();
  const controlbarRect = document.querySelector(".controlbar").getBoundingClientRect();
  const centerX = stageRect.width / 2;
  const centerY = (
    topbarRect.bottom - stageRect.top + controlbarRect.top - stageRect.top
  ) / 2;
  const anchor = magneticAnchor();
  if (lastMagneticAnchorId !== anchor.id) {
    for (const blob of blobs) {
      if (blob.id === anchor.id) continue;
      const dx = blob.x - anchor.x;
      const dy = blob.y - anchor.y;
      if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > 1) {
        blob.magneticAngle = Math.atan2(dy, dx);
      }
    }
    lastMagneticAnchorId = anchor.id;
    spreadMagneticAngles(anchor);
  }
  const anchorBounds = blobPositionBounds(anchor.r, stageRect);
  const anchorTarget = {
    x: Math.min(anchorBounds.maxX, Math.max(anchorBounds.minX, centerX)),
    y: Math.min(anchorBounds.maxY, Math.max(anchorBounds.minY, centerY)),
  };
  targets.set(anchor.id, anchorTarget);
  const satellites = blobs.filter((blob) => blob.id !== anchor.id);
  satellites.forEach((blob) => {
    if (!Number.isFinite(blob.magneticAngle)) {
      blob.magneticAngle = largestOpenMagneticAngle(blob.id);
    }
    const angle = blob.magneticAngle;
    const distance = (anchor.r + blob.r) * 0.96;
    const bounds = blobPositionBounds(blob.r, stageRect);
    targets.set(blob.id, {
      x: Math.min(bounds.maxX, Math.max(bounds.minX, anchorTarget.x + Math.cos(angle) * distance)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, anchorTarget.y + Math.sin(angle) * distance)),
    });
  });
  return targets;
}

function stopMagneticSettle() {
  if (magneticFrame) cancelAnimationFrame(magneticFrame);
  magneticFrame = null;
  for (const blob of blobs) {
    blob.vx = 0;
    blob.vy = 0;
  }
}

function scheduleMagneticSettle() {
  if (fusing || dragState || !blobs.length) return;
  stopMagneticSettle();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    const targets = magneticTargets();
    for (const blob of blobs) Object.assign(blob, targets.get(blob.id));
    render();
    return;
  }
  const step = () => {
    magneticFrame = null;
    const targets = magneticTargets();
    let moving = false;
    for (const blob of blobs) {
      const target = targets.get(blob.id);
      if (!target) continue;
      const dx = target.x - blob.x;
      const dy = target.y - blob.y;
      blob.vx = ((blob.vx || 0) + dx * 0.08) * 0.72;
      blob.vy = ((blob.vy || 0) + dy * 0.08) * 0.72;
      blob.x += blob.vx;
      blob.y += blob.vy;
      if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25 || Math.abs(blob.vx) > 0.1 || Math.abs(blob.vy) > 0.1) {
        moving = true;
      } else {
        blob.x = target.x;
        blob.y = target.y;
        blob.vx = 0;
        blob.vy = 0;
      }
    }
    render();
    if (moving) magneticFrame = requestAnimationFrame(step);
  };
  magneticFrame = requestAnimationFrame(step);
}

function fontSizeFor(r) {
  return Math.max(11, Math.round(r / 4.4));
}

function render() {
  const w = weights();
  syncBlobRadii(w);
  const displayWeights = roundedWeights(w);
  const anchor = blobs.length
    ? [...blobs].sort((a, b) => b.influence - a.influence || a.id - b.id)[0]
    : null;
  const stageRect = stage.getBoundingClientRect();
  const topbarRect = document.querySelector(".topbar").getBoundingClientRect();
  const controlbarRect = document.querySelector(".controlbar").getBoundingClientRect();
  const three = window.Stage3D?.active;
  gooLayer.innerHTML = "";
  contentLayer.innerHTML = "";

  if (three) {
    window.Stage3D.setBlobs(
      blobs.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        r: b.r,
        color: b.color,
        dataUrl: b.kind === "image" ? b.dataUrl : null,
        dragging: dragState?.id === b.id && dragState.moved,
      }))
    );
  }

  for (const b of blobs) {
    if (!three) {
      const goo = document.createElement("div");
      goo.className = "goo-blob";
      goo.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.r * 2}px;height:${b.r * 2}px;background:${b.color}`;
      gooLayer.appendChild(goo);
    }

    const el = document.createElement("div");
    el.className = "blob" + (b.id === selectedId ? " selected" : "");
    el.dataset.id = b.id;
    el.style.cssText = `left:${b.x}px;top:${b.y}px;width:${b.r * 2}px;height:${b.r * 2}px;`;
    if (three && b.kind !== "image") {
      // In 3D mode the goo is glassy — give labels a soft tinted backdrop
      el.style.background = `radial-gradient(circle, ${b.color}55 0%, ${b.color}22 62%, transparent 74%)`;
    }
    if (b.kind === "image") {
      if (!three) {
        // 2D fallback shows the thumbnail; in 3D the goo surface IS the image
        const img = document.createElement("img");
        img.src = b.dataUrl;
        img.alt = b.name || "ingredient image";
        img.draggable = false;
        el.appendChild(img);
      }
    } else if (b.kind === "artifact") {
      const span = document.createElement("span");
      span.className = "blob-text blob-artifact-label";
      span.style.fontSize = fontSizeFor(b.r) + "px";
      span.textContent = b.label || "fusion";
      el.appendChild(span);
    } else {
      const span = document.createElement("span");
      span.className = "blob-text";
      span.style.fontSize = fontSizeFor(b.r) + "px";
      span.textContent = b.text;
      el.appendChild(span);
    }
    contentLayer.appendChild(el);

    const chip = document.createElement("div");
    chip.className = "weight-chip";
    const dx = anchor && b.id !== anchor.id ? b.x - anchor.x : 0;
    const dy = anchor && b.id !== anchor.id ? b.y - anchor.y : 1;
    const distance = Math.hypot(dx, dy) || 1;
    const chipDistance = b.r + 18;
    const chipX = Math.min(stageRect.width - 30, Math.max(30, b.x + (dx / distance) * chipDistance));
    const chipY = Math.min(
      controlbarRect.top - stageRect.top - 16,
      Math.max(topbarRect.bottom - stageRect.top + 16, b.y + (dy / distance) * chipDistance)
    );
    chip.style.cssText = `left:${chipX}px;top:${chipY}px;`;
    chip.textContent = displayWeights[b.id] + "%";
    contentLayer.appendChild(chip);
  }

  emptyState.classList.toggle("hidden", blobs.length > 0);
  fuseBtn.disabled = blobs.length === 0 || fusing;
  positionToolbar();
}

function positionToolbar() {
  const b = blobs.find((x) => x.id === selectedId);
  if (!b) {
    toolbar.hidden = true;
    return;
  }
  toolbar.hidden = false;
  const stageRect = stage.getBoundingClientRect();
  const topbarRect = document.querySelector(".topbar").getBoundingClientRect();
  const safeTop = topbarRect.bottom - stageRect.top + 8;
  toolbar.style.left = b.x + "px";
  toolbar.style.top = Math.max(safeTop, b.y - b.r - 46) + "px";
  document.getElementById("tb-edit").style.display = b.kind === "text" ? "" : "none";
}

/* ---------------- Blob CRUD ---------------- */

function blobPositionBounds(r, stageRect = stage.getBoundingClientRect()) {
  const topbarRect = document.querySelector(".topbar").getBoundingClientRect();
  const controlbarRect = document.querySelector(".controlbar").getBoundingClientRect();
  const edge = 12;
  const minX = r + edge;
  const maxX = Math.max(minX, stageRect.width - r - edge);
  const minY = Math.max(r + edge, topbarRect.bottom - stageRect.top + r + edge);
  const maxY = Math.max(
    minY,
    Math.min(stageRect.height - r - edge, controlbarRect.top - stageRect.top - r - edge)
  );
  return { minX, maxX, minY, maxY };
}

function stageCenterSpot(r = 70) {
  // Sample candidate spots and keep the one farthest from existing blobs,
  // so new ingredients spread out instead of stacking at center.
  const rect = stage.getBoundingClientRect();
  const bounds = blobPositionBounds(r, rect);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  let best = { x: centerX, y: centerY };
  let bestScore = -Infinity;
  for (let i = 0; i < 40; i++) {
    const x = bounds.minX + Math.random() * Math.max(1, bounds.maxX - bounds.minX);
    const y = bounds.minY + Math.random() * Math.max(1, bounds.maxY - bounds.minY);
    const nearest = blobs.length
      ? Math.min(...blobs.map((b) => Math.hypot(x - b.x, y - b.y) - b.r))
      : Infinity;
    // Prefer clear space, but don't wander into far corners when the stage is empty
    const centerPull = -0.25 * Math.hypot(x - centerX, y - centerY);
    const score = Math.min(nearest, 260) + centerPull;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }
  return best;
}

function addBlob(partial) {
  if (blobs.length >= MAX_ITEMS) {
    flashHint(`Max ${MAX_ITEMS} ingredients — remove one first.`);
    return null;
  }
  const { r: _legacyRadius, influence: requestedInfluence, ...blobPartial } = partial;
  const influence = requestedInfluence || (blobs.length
    ? blobs.reduce((sum, blob) => sum + blob.influence, 0) / blobs.length
    : DEFAULT_INFLUENCE);
  const projectedTotal = blobs.reduce((sum, blob) => sum + blob.influence, 0) + influence;
  const radius = radiusForWeight((100 * influence) / projectedTotal);
  const requestedSpot = partial.x != null ? { x: partial.x, y: partial.y } : stageCenterSpot(radius);
  const bounds = blobPositionBounds(radius);
  const spot = {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, requestedSpot.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, requestedSpot.y)),
  };
  const b = {
    id: nextId++,
    influence,
    r: radius,
    magneticAngle: Number.isFinite(blobPartial.magneticAngle)
      ? blobPartial.magneticAngle
      : largestOpenMagneticAngle(),
    color: PALETTE[(nextId - 2) % PALETTE.length],
    ...blobPartial,
    x: spot.x,
    y: spot.y,
  };
  blobs.push(b);
  spreadMagneticAngles();
  selectedId = b.id;
  render();
  scheduleMagneticSettle();
  return b;
}

function removeBlob(id) {
  blobs = blobs.filter((b) => b.id !== id);
  if (selectedId === id) selectedId = null;
  render();
  scheduleMagneticSettle();
}

function resizeBlob(id, delta) {
  const b = blobs.find((x) => x.id === id);
  if (!b || blobs.length === 1) return;
  const factor = Math.pow(1.15, delta / 6);
  b.influence = Math.min(MAX_INFLUENCE, Math.max(MIN_INFLUENCE, b.influence * factor));
  render();
  scheduleMagneticSettle();
}

function flashHint(msg) {
  const hint = document.getElementById("hint");
  hint.textContent = msg;
  hint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hint.hidden = true;
    hint.textContent = "";
  }, 2600);
}

/* ---------------- Text entry ---------------- */

function openTextEntry(x, y, existingBlob) {
  editingBlobId = existingBlob ? existingBlob.id : null;
  textEntry.hidden = false;
  textEntry.style.left = x + "px";
  textEntry.style.top = y + "px";
  textEntryInput.value = existingBlob ? existingBlob.text : "";
  textEntryInput.focus();
}

function closeTextEntry() {
  textEntry.hidden = true;
  editingBlobId = null;
}

textEntry.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = textEntryInput.value.trim();
  if (value) {
    if (editingBlobId != null) {
      const b = blobs.find((x) => x.id === editingBlobId);
      if (b) b.text = value;
    } else {
      addBlob({ kind: "text", text: value });
    }
  }
  closeTextEntry();
  render();
});

textEntryInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTextEntry();
});
textEntryInput.addEventListener("blur", () => setTimeout(closeTextEntry, 150));

const composerMenus = [
  { trigger: addMenuTrigger, menu: addMenu },
  { trigger: typeMenuTrigger, menu: typeMenu },
];

function closeComposerMenus(exceptMenu = null) {
  for (const { trigger, menu } of composerMenus) {
    if (menu === exceptMenu) continue;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
}

function setComposerMenuOpen(trigger, menu, open, focusEdge = null) {
  if (open) closeComposerMenus(menu);
  menu.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  if (open && focusEdge) {
    const items = [...menu.querySelectorAll('[role^="menuitem"]')];
    items[focusEdge === "last" ? items.length - 1 : 0]?.focus();
  }
}

function setupComposerMenu(trigger, menu) {
  const menuItems = [...menu.querySelectorAll('[role^="menuitem"]')];
  menuItems.forEach((item) => { item.tabIndex = -1; });
  trigger.addEventListener("click", () => {
    setComposerMenuOpen(trigger, menu, menu.hidden);
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      e.preventDefault();
      setComposerMenuOpen(trigger, menu, false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    setComposerMenuOpen(trigger, menu, true, e.key === "ArrowUp" ? "last" : "first");
  });
  menu.addEventListener("keydown", (e) => {
    const index = menuItems.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setComposerMenuOpen(trigger, menu, false);
      trigger.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      menuItems[(index + step + menuItems.length) % menuItems.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      menuItems[e.key === "Home" ? 0 : menuItems.length - 1]?.focus();
    }
  });
  trigger.parentElement.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!trigger.parentElement.contains(document.activeElement)) {
        setComposerMenuOpen(trigger, menu, false);
      }
    }, 0);
  });
}

composerMenus.forEach(({ trigger, menu }) => setupComposerMenu(trigger, menu));
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".composer-menu-anchor")) closeComposerMenus();
});

document.getElementById("add-text").addEventListener("click", () => {
  closeComposerMenus();
  if (blobs.length >= MAX_ITEMS) return flashHint(`Max ${MAX_ITEMS} ingredients.`);
  const rect = stage.getBoundingClientRect();
  openTextEntry(rect.width / 2, rect.height / 2, null);
});

/* ---------------- Images ---------------- */

document.getElementById("add-image").addEventListener("click", () => {
  closeComposerMenus();
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  addImageFiles([...fileInput.files]);
  fileInput.value = "";
});

async function addImageFiles(files, dropX, dropY) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    if (blobs.length >= MAX_ITEMS) {
      flashHint(`Max ${MAX_ITEMS} ingredients.`);
      break;
    }
    try {
      const { dataUrl, mediaType, color } = await downscaleImage(file);
      addBlob({
        kind: "image",
        dataUrl,
        mediaType,
        color, // sampled dominant color — the goo inherits the photo's palette
        name: file.name,
        x: dropX,
        y: dropY,
      });
      dropX = dropY = undefined; // subsequent files scatter
    } catch (err) {
      console.error(err);
      flashHint("Couldn't read that image.");
    }
  }
}

function downscaleImage(file, maxDim = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const keepPng = file.type === "image/png" || file.type === "image/gif";
      const mediaType = keepPng ? "image/png" : "image/jpeg";
      const dataUrl = canvas.toDataURL(mediaType, 0.85);
      resolve({ dataUrl, mediaType, color: dominantColor(canvas) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

function dominantColor(canvas) {
  // Saturation-weighted average — favors the image's vivid hues over greys
  const s = 20;
  const tiny = document.createElement("canvas");
  tiny.width = tiny.height = s;
  const tctx = tiny.getContext("2d");
  tctx.drawImage(canvas, 0, 0, s, s);
  const d = tctx.getImageData(0, 0, s, s).data;
  let r = 0, g = 0, b = 0, wsum = 0, ar = 0, ag = 0, ab = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 100) continue;
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const sat = (mx - mn) / 255;
    const wt = sat * sat * (0.3 + (0.7 * mx) / 255) + 0.02;
    r += R * wt; g += G * wt; b += B * wt; wsum += wt;
    ar += R; ag += G; ab += B; n++;
  }
  if (!n) return PALETTE[0];
  if (wsum < 0.5) { r = ar; g = ag; b = ab; wsum = n; } // near-greyscale image
  const hex = (v) => Math.round(v / wsum).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/* Drag & drop files onto the stage */
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if ([...(e.dataTransfer?.types || [])].includes("Files")) {
    dragDepth++;
    stage.classList.add("dragging-file");
  }
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) stage.classList.remove("dragging-file");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  stage.classList.remove("dragging-file");
  const rect = stage.getBoundingClientRect();
  addImageFiles([...e.dataTransfer.files], e.clientX - rect.left, e.clientY - rect.top);
});

window.addEventListener("paste", (e) => {
  if (!resultPanel.hidden || !e.clipboardData) return;

  const clipboardItems = [...e.clipboardData.items];
  const itemImages = clipboardItems
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const imageFiles = itemImages.length
    ? itemImages
    : [...e.clipboardData.files].filter((file) => file.type.startsWith("image/"));

  if (imageFiles.length) {
    e.preventDefault();
    closeComposerMenus();
    addImageFiles(imageFiles);
    return;
  }

  const target = e.target;
  const isEditable = target instanceof Element && Boolean(
    target.closest('input, textarea, [contenteditable="true"]')
  );
  if (isEditable) return;

  const pastedText = e.clipboardData.getData("text/plain").trim();
  if (!pastedText) return;

  e.preventDefault();
  closeComposerMenus();
  if (blobs.length >= MAX_ITEMS) {
    flashHint(`Max ${MAX_ITEMS} ingredients.`);
    return;
  }

  addBlob({ kind: "text", text: pastedText.slice(0, 300) });
  if (pastedText.length > 300) flashHint("Pasted text was trimmed to 300 characters.");
});

/* ---------------- Pointer interactions ---------------- */

let dragState = null; // {id, offsetX, offsetY, moved}

contentLayer.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".blob");
  if (!el) return;
  const id = Number(el.dataset.id);
  const b = blobs.find((x) => x.id === id);
  if (!b) return;
  stopMagneticSettle();
  const rect = stage.getBoundingClientRect();
  dragState = {
    id,
    offsetX: e.clientX - rect.left - b.x,
    offsetY: e.clientY - rect.top - b.y,
    moved: false,
  };
  el.setPointerCapture(e.pointerId);
});

contentLayer.addEventListener("pointermove", (e) => {
  if (!dragState) return;
  const b = blobs.find((x) => x.id === dragState.id);
  if (!b) return;
  const rect = stage.getBoundingClientRect();
  const nx = e.clientX - rect.left - dragState.offsetX;
  const ny = e.clientY - rect.top - dragState.offsetY;
  if (!dragState.moved && Math.hypot(nx - b.x, ny - b.y) > 4) dragState.moved = true;
  if (dragState.moved) {
    const bounds = blobPositionBounds(b.r, rect);
    b.x = Math.min(bounds.maxX, Math.max(bounds.minX, nx));
    b.y = Math.min(bounds.maxY, Math.max(bounds.minY, ny));
    render();
  }
});

contentLayer.addEventListener("pointerup", (e) => {
  if (!dragState) return;
  const { id, moved } = dragState;
  dragState = null;
  if (!moved) {
    selectedId = selectedId === id ? null : id;
  } else {
    const blob = blobs.find((item) => item.id === id);
    const anchor = magneticAnchor();
    if (blob && anchor) {
      if (blob.id === anchor.id) {
        for (const satellite of blobs) {
          if (satellite.id === anchor.id) continue;
          satellite.magneticAngle = Math.atan2(satellite.y - blob.y, satellite.x - blob.x);
        }
      } else {
        blob.magneticAngle = Math.atan2(blob.y - anchor.y, blob.x - anchor.x);
      }
      spreadMagneticAngles(anchor);
    }
  }
  render();
  scheduleMagneticSettle();
});

/* Click empty stage clears selection */
stage.addEventListener("pointerdown", (e) => {
  if (e.target === stage || e.target === contentLayer || e.target.id === "empty-state") {
    selectedId = null;
    render();
  }
});

/* Double-click a text blob to edit it */
contentLayer.addEventListener("dblclick", (e) => {
  const el = e.target.closest(".blob");
  if (!el) return;
  const b = blobs.find((x) => x.id === Number(el.dataset.id));
  if (b && b.kind === "text") openTextEntry(b.x, b.y, b);
});

/* Scroll over a blob = influence */
stage.addEventListener(
  "wheel",
  (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".blob");
    if (!el) return;
    e.preventDefault();
    resizeBlob(Number(el.dataset.id), e.deltaY < 0 ? 6 : -6);
  },
  { passive: false }
);

/* Toolbar buttons */
document.getElementById("tb-grow").addEventListener("click", () => resizeBlob(selectedId, 12));
document.getElementById("tb-shrink").addEventListener("click", () => resizeBlob(selectedId, -12));
document.getElementById("tb-delete").addEventListener("click", () => removeBlob(selectedId));
document.getElementById("tb-edit").addEventListener("click", () => {
  const b = blobs.find((x) => x.id === selectedId);
  if (b) openTextEntry(b.x, b.y, b);
});

window.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId != null && textEntry.hidden) {
    const tag = document.activeElement?.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") removeBlob(selectedId);
  }
});

/* ---------------- Output type chips ---------------- */

let outputType = "auto";
document.querySelectorAll(".otype").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".otype").forEach((b) => {
      b.classList.remove("selected");
      b.setAttribute("aria-checked", "false");
    });
    btn.classList.add("selected");
    btn.setAttribute("aria-checked", "true");
    outputType = btn.dataset.type;
    const label = btn.firstChild.textContent.trim();
    selectedTypeLabel.textContent = label;
    typeMenuTrigger.setAttribute("aria-label", `Output type: ${label}`);
    closeComposerMenus();
    directiveInput.focus();
  });
});

/* ---------------- Discover ---------------- */

function formatDiscoverDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved output";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function discoverKindLabel(item) {
  if (item.kind === "image") return "Image";
  return item.outputType && item.outputType !== "auto" ? item.outputType : "Artifact";
}

function generatedDiscoverTitle(source, fallback = "Untitled artifact") {
  const documentNode = new DOMParser().parseFromString(source, "text/html");
  const candidates = [
    documentNode.querySelector("h1")?.textContent,
    documentNode.querySelector("title")?.textContent,
  ];
  return candidates
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .find((value) => value.length >= 3)
    ?.slice(0, 120) || fallback;
}

const ARTIFACT_VIEWER_INSET_STYLE = `<style data-fuse-viewer-inset>html>body{border-top:76px solid transparent!important}@media(max-width:480px){html>body{border-top-width:60px!important}}</style>`;
const ARTIFACT_FIRST_PAINT_SCRIPT = `<script data-fuse-first-paint>(()=>{let sent=false,queued=false;const meaningful=()=>{if(!document.body)return false;return[document.body,...document.body.querySelectorAll("*")].some((element)=>{if(/^(SCRIPT|STYLE|LINK|META|NOSCRIPT)$/.test(element.tagName))return false;const rect=element.getBoundingClientRect(),style=getComputedStyle(element);if(rect.width<8||rect.height<8||rect.bottom<=0||rect.right<=0||rect.top>=innerHeight||rect.left>=innerWidth||style.display==="none"||style.visibility==="hidden"||Number(style.opacity)===0)return false;if(element.matches("canvas,svg,video,button,input,select,textarea"))return true;if(element.tagName==="IMG"&&element.complete&&element.naturalWidth>0)return true;if(element!==document.body&&(element.textContent||"").trim())return true;return style.backgroundImage!=="none"||(style.backgroundColor!=="transparent"&&style.backgroundColor!=="rgba(0, 0, 0, 0)")})};const check=()=>{if(sent||queued)return;queued=true;requestAnimationFrame(()=>requestAnimationFrame(()=>{queued=false;if(sent||!meaningful())return;sent=true;observer.disconnect();parent.postMessage({type:"fuse:first-paint"},"*")}))};const observer=new MutationObserver(check);observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});addEventListener("DOMContentLoaded",check,{once:true});addEventListener("load",check,{once:true});check()})();</script>`;

function injectDocumentHead(source, content) {
  if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, `<head$1>${content}`);
  if (/<html[\s>]/i.test(source)) return source.replace(/<html([^>]*)>/i, `<html$1><head>${content}</head>`);
  return `<!doctype html><html><head>${content}</head><body>${source}</body></html>`;
}

function sandboxStoredHtml(source, { hideScrollbars = false, viewerInset = false } = {}) {
  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "media-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const previewStyle = hideScrollbars
    ? `<style data-fuse-preview>html,body{scrollbar-width:none}*::-webkit-scrollbar{display:none;width:0;height:0}</style>`
    : "";
  const headContent = meta + previewStyle + (viewerInset ? ARTIFACT_VIEWER_INSET_STYLE : "");
  return injectDocumentHead(source, headContent);
}

async function loadDiscoverPreview(frame, entry) {
  pendingDiscoverPreviews.delete(frame);
  try {
    const response = await fetch(entry.item.contentUrl);
    if (!response.ok) throw new Error("preview unavailable");
    const html = await response.text();
    const displayTitle = generatedDiscoverTitle(html, entry.item.title);
    entry.item.title = displayTitle;
    entry.onTitle(displayTitle);
    frame.srcdoc = sandboxStoredHtml(html, { hideScrollbars: true });
  } catch {
    frame.dataset.failed = "true";
    entry.onTitle(entry.item.title);
  }
}

function checkDiscoverPreviews() {
  discoverPreviewCheckQueued = false;
  for (const [frame, entry] of pendingDiscoverPreviews) {
    const rect = frame.getBoundingClientRect();
    if (rect.bottom >= -400 && rect.top <= innerHeight + 400) loadDiscoverPreview(frame, entry);
  }
}

function scheduleDiscoverPreviewCheck() {
  if (discoverPreviewCheckQueued) return;
  discoverPreviewCheckQueued = true;
  setTimeout(checkDiscoverPreviews, 0);
}

function observeDiscoverPreview(frame, item, onTitle) {
  frame.dataset.contentUrl = item.contentUrl;
  pendingDiscoverPreviews.set(frame, { item, onTitle });
  scheduleDiscoverPreviewCheck();
}

function discoverTileSize(index) {
  const position = index % 11;
  if (position === 0) return "feature";
  if (position === 3 || position === 6) return "wide";
  return "single";
}

function renderDiscoverItems() {
  pendingDiscoverPreviews.clear();
  discoverGrid.replaceChildren();
  discoverEmpty.hidden = discoverItems.length > 0;

  for (const [index, item] of discoverItems.entries()) {
    const card = document.createElement("article");
    card.className = `discover-card discover-card-${discoverTileSize(index)}`;
    card.style.animationDelay = `${Math.min(index, 8) * 30}ms`;

    const preview = document.createElement("div");
    preview.className = "discover-preview";
    let previewFrame = null;
    if (item.kind === "image") {
      const image = document.createElement("img");
      image.src = item.contentUrl;
      image.alt = "";
      image.loading = "lazy";
      preview.appendChild(image);
    } else {
      previewFrame = document.createElement("iframe");
      previewFrame.title = `Preview of ${item.title}`;
      previewFrame.tabIndex = -1;
      previewFrame.setAttribute("sandbox", "allow-scripts");
      preview.appendChild(previewFrame);
    }

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "discover-card-open";
    openButton.setAttribute("aria-label", `Open ${item.title}`);
    openButton.addEventListener("click", () => openDiscoverEntry(item));
    preview.appendChild(openButton);

    const metadata = document.createElement("div");
    metadata.className = "discover-card-meta";
    const title = document.createElement("h2");
    if (item.kind === "html") {
      title.className = "discover-title-loading";
      title.setAttribute("aria-hidden", "true");
      metadata.setAttribute("aria-busy", "true");
    } else {
      title.textContent = item.title;
    }
    const date = document.createElement("span");
    date.className = "discover-date";
    date.textContent = formatDiscoverDate(item.createdAt);
    metadata.append(title, date);

    preview.appendChild(metadata);
    card.appendChild(preview);
    discoverGrid.appendChild(card);
    if (item.kind === "html") {
      observeDiscoverPreview(previewFrame, item, (displayTitle) => {
        title.textContent = displayTitle;
        title.classList.remove("discover-title-loading");
        title.removeAttribute("aria-hidden");
        metadata.removeAttribute("aria-busy");
        previewFrame.title = `Preview of ${displayTitle}`;
        openButton.setAttribute("aria-label", `Open ${displayTitle}`);
      });
    }
  }
}

async function loadDiscover() {
  discoverLoading.hidden = false;
  discoverGrid.hidden = true;
  discoverEmpty.hidden = true;
  discoverError.hidden = true;
  try {
    const response = await fetch("/api/discover?limit=48", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Discover couldn't load.");
    discoverItems = Array.isArray(payload.items) ? payload.items : [];
    renderDiscoverItems();
    discoverGrid.hidden = false;
    scheduleDiscoverPreviewCheck();
  } catch (err) {
    console.error(err);
    discoverError.hidden = false;
  } finally {
    discoverLoading.hidden = true;
  }
}

function openDiscover({ pushHistory = true } = {}) {
  resetResultTransition();
  resultPanel.hidden = true;
  activeDiscoverEntry = null;
  shareableDiscoverEntry = null;
  closeComposerMenus();
  document.querySelector(".topbar").inert = true;
  stage.inert = true;
  document.querySelector(".controlbar").inert = true;
  discoverPanel.hidden = false;
  syncViewToggle("discover");
  document.title = "Discover — Fuse";
  if (pushHistory && location.pathname !== "/discover") {
    history.pushState({ view: "discover" }, "", "/discover");
  }
  loadDiscover();
}

function closeDiscover({ pushHistory = true } = {}) {
  discoverPanel.hidden = true;
  document.querySelector(".topbar").inert = false;
  stage.inert = false;
  document.querySelector(".controlbar").inert = false;
  syncViewToggle("canvas");
  document.title = "Fuse — metaball mixer";
  if (pushHistory && location.pathname === "/discover") {
    history.pushState({ view: "canvas" }, "", "/");
  }
}

function discoverEntryIdFromPath() {
  return location.pathname.match(/^\/discover\/([0-9a-f-]{36})\/?$/i)?.[1] || null;
}

function discoverEntryPath(item) {
  return `/discover/${encodeURIComponent(item.id)}`;
}

async function getDiscoverEntry(id) {
  const existing = discoverItems.find((item) => item.id === id);
  if (existing) return existing;
  const response = await fetch(`/api/discover/${encodeURIComponent(id)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Saved output not found.");
  return payload.item;
}

function syncViewToggle(view) {
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    const selected = button.dataset.viewTarget === view;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.viewTarget === "discover") openDiscover();
    else closeDiscover();
  });
});
document.getElementById("discover-retry").addEventListener("click", loadDiscover);
discoverPanel.addEventListener("scroll", scheduleDiscoverPreviewCheck, { passive: true });
async function syncViewFromLocation() {
  const entryId = discoverEntryIdFromPath();
  if (entryId) {
    openDiscover({ pushHistory: false });
    try {
      await openDiscoverEntry(await getDiscoverEntry(entryId), { pushHistory: false });
    } catch (err) {
      resultPanel.hidden = true;
      discoverError.hidden = false;
      discoverError.querySelector("strong").textContent = err.message;
    }
  } else if (location.pathname === "/discover") {
    resultPanel.hidden = true;
    activeDiscoverEntry = null;
    shareableDiscoverEntry = null;
    openDiscover({ pushHistory: false });
  } else {
    resetResultTransition();
    resultPanel.hidden = true;
    activeDiscoverEntry = null;
    shareableDiscoverEntry = null;
    closeDiscover({ pushHistory: false });
  }
}

window.addEventListener("popstate", syncViewFromLocation);

/* ---------------- Fuse ---------------- */

fuseBtn.addEventListener("click", fuse);

async function fuse() {
  if (fusing || blobs.length === 0) return;
  fusing = true;
  stopMagneticSettle();
  fuseBtn.classList.add("busy");
  fuseBtn.textContent = "Fusing…";
  render();

  if (window.Stage3D?.active) {
    // Pull all the goo into one mass at the weighted centroid while we fuse
    const cw = weights();
    let cx = 0, cy = 0, tw = 0;
    for (const b of blobs) {
      cx += b.x * cw[b.id];
      cy += b.y * cw[b.id];
      tw += cw[b.id];
    }
    if (tw > 0) window.Stage3D.collapse({ x: cx / tw, y: cy / tw });
    document.body.classList.add("collapsing");
  }

  const w = weights();
  const items = blobs.map((b) => {
    if (b.kind === "image") {
      const [meta, base64] = b.dataUrl.split(",");
      return {
        kind: "image",
        imageBase64: base64,
        mediaType: meta.match(/data:(.*?);/)[1],
        name: b.name,
        weightPct: w[b.id],
      };
    }
    if (b.kind === "artifact") {
      return { kind: "artifact", html: b.html, label: b.label, weightPct: w[b.id] };
    }
    return { kind: "text", text: b.text, weightPct: w[b.id] };
  });
  openResultPanel(outputType === "image" ? "image" : "html");
  let raw = "";

  try {
    const res = await fetch("/api/fuse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, directive: directiveInput.value.trim(), outputType }),
    });

    if (!res.ok && !res.headers.get("content-type")?.includes("ndjson")) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;

    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.t === "delta") {
          raw += msg.text;
          if (panelMode === "html") {
            resultMeta.textContent = `${raw.length.toLocaleString()} characters so far`;
          } else {
            streamToCode(raw);
          }
        } else if (msg.t === "live") {
          // The server exposes this fusion as a chunked HTML stream — point the
          // sandboxed iframe at it and the browser renders tags as they close.
          liveAttached = true;
          resultFrame.src = `/api/live/${msg.id}`;
        } else if (msg.t === "mode" && msg.kind === "image") {
          // Auto mode: the model chose an image over an HTML artifact
          panelMode = "image";
          liveAttached = false;
          resultFrame.classList.remove("visible");
          resultFrame.src = "about:blank";
          resultCode.classList.add("visible");
          resultMeta.textContent = "the model chose an image — fusing a prompt";
          if (raw) streamToCode(raw);
        } else if (msg.t === "phase" && msg.phase === "paint") {
          resultStatus.textContent = "Painting…";
          resultMeta.textContent = msg.sourceImages
            ? `blending ${msg.sourceImages} source image${msg.sourceImages > 1 ? "s" : ""} with ${msg.imageModel}`
            : `sending the fused prompt to ${msg.imageModel}`;
          showImagePaintLoader();
        } else if (msg.t === "image") {
          lastImageDataUrl = `data:${msg.mediaType};base64,${msg.b64}`;
          resultImageReady = prepareResultImage(lastImageDataUrl);
        } else if (msg.t === "done") {
          await finishResult(raw, msg);
        } else if (msg.t === "err") {
          throw new Error(msg.error);
        }
      }
    }
  } catch (err) {
    resultStatus.textContent = "That didn't work";
    resultMeta.textContent = err.message;
    resultImageWrap.classList.remove("visible", "loading");
    resultImageWrap.removeAttribute("aria-busy");
    resultImageWrap.removeAttribute("aria-label");
    if (!raw || panelMode === "image") {
      resultFrame.classList.remove("visible");
      resultCode.classList.add("visible");
    }
    showResultPanel();
  } finally {
    fusing = false;
    fuseBtn.classList.remove("busy");
    fuseBtn.textContent = "Fuse";
    render();
  }
}

/* ---------------- Result panel ---------------- */

const RESULT_REVEAL_TIMEOUT_MS = 60000;
let panelRevealTimer = null;
let panelTransitionTimer = null;

function resetResultTransition({ releaseStage = true } = {}) {
  clearTimeout(panelRevealTimer);
  clearTimeout(panelTransitionTimer);
  panelRevealTimer = null;
  panelTransitionTimer = null;
  resultPanel.classList.remove("waiting-for-result", "revealing-result");
  resultImageWrap.classList.remove("loading");
  resultImageWrap.removeAttribute("aria-busy");
  resultImageWrap.removeAttribute("aria-label");
  document.body.classList.remove("collapsing");
  document.body.classList.remove("result-revealing");
  if (releaseStage) window.Stage3D?.release();
}

function revealResultSurface() {
  clearTimeout(panelRevealTimer);
  panelRevealTimer = null;
  if (!resultPanel.classList.contains("waiting-for-result")) return;
  resultPanel.classList.add("revealing-result");
  document.body.classList.add("result-revealing");
  requestAnimationFrame(() => resultPanel.classList.remove("waiting-for-result"));
  clearTimeout(panelTransitionTimer);
  panelTransitionTimer = setTimeout(() => {
    resultPanel.classList.remove("revealing-result");
    document.body.classList.remove("result-revealing");
    panelTransitionTimer = null;
  }, 240);
  document.body.classList.remove("collapsing");
  window.Stage3D?.release();
}

function showResultPanel() {
  resultPanel.hidden = false;
  revealResultSurface();
}

function openResultPanel(mode) {
  activeDiscoverEntry = null;
  shareableDiscoverEntry = null;
  panelMode = mode;
  resetResultTransition({ releaseStage: false });
  resultPanel.hidden = false;
  resultPanel.classList.add("waiting-for-result");
  document.body.classList.add("collapsing");
  panelRevealTimer = setTimeout(revealResultSurface, RESULT_REVEAL_TIMEOUT_MS);
  resultStatus.textContent = "Fusing…";
  resultMeta.textContent = "streaming from the model";
  resultCode.textContent = "";
  resultImageWrap.classList.remove("visible");
  resultImage.removeAttribute("src");
  resultDownload.hidden = true;
  resultRemix.hidden = true;
  resultSave.hidden = true;
  resultShare.hidden = true;
  resultSave.disabled = false;
  setResultAction(resultSave, "Save to Discover", "＋");
  lastArtifactHtml = "";
  lastImageDataUrl = "";
  resultImageReady = null;
  resultKind = null;
  liveAttached = false;
  resultFrame.removeAttribute("srcdoc");
  resultFrame.src = "about:blank";
  if (mode === "html") {
    resultFrame.classList.add("visible");
    resultCode.classList.remove("visible");
  } else {
    resultFrame.classList.remove("visible");
    resultCode.classList.add("visible");
  }
}

window.addEventListener("message", (event) => {
  if (event.source !== resultFrame.contentWindow || event.data?.type !== "fuse:first-paint") return;
  revealResultSurface();
});

function showImagePaintLoader() {
  resultFrame.classList.remove("visible");
  resultCode.classList.remove("visible");
  resultImageWrap.classList.add("visible", "loading");
  resultImageWrap.setAttribute("aria-busy", "true");
  resultImageWrap.setAttribute("aria-label", "GPT is painting the image");
  revealResultSurface();
}

function prepareResultImage(source) {
  if (typeof resultImage.decode === "function") {
    resultImage.src = source;
    return resultImage.decode();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      resultImage.removeEventListener("load", handleLoad);
      resultImage.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("The generated image couldn't be displayed."));
    };
    resultImage.addEventListener("load", handleLoad);
    resultImage.addEventListener("error", handleError);
    resultImage.src = source;
    if (resultImage.complete && resultImage.naturalWidth > 0) handleLoad();
  });
}

function streamToCode(raw) {
  // Show a rolling tail of the generated code while streaming
  const tail = raw.length > 6000 ? "…" + raw.slice(-6000) : raw;
  resultCode.textContent = tail;
  resultCode.scrollTop = resultCode.scrollHeight;
  resultStatus.textContent = "Fusing…";
  resultMeta.textContent = `${raw.length.toLocaleString()} characters so far`;
}

function extractHtml(raw) {
  let s = raw.trim();
  // Strip accidental markdown fences
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) s = s.slice(start);
  return s;
}

async function finishResult(raw, meta) {
  resultCode.classList.remove("visible");
  if (lastImageDataUrl) {
    resultKind = "image";
    resultImageWrap.classList.add("visible");
    if (!resultImageReady) resultImageReady = prepareResultImage(lastImageDataUrl);
    await resultImageReady;
    resultImageWrap.classList.remove("loading");
    resultImageWrap.removeAttribute("aria-busy");
    resultImageWrap.removeAttribute("aria-label");
    revealResultSurface();
  } else {
    resultKind = "html";
    lastArtifactHtml = extractHtml(raw);
    if (!liveAttached) {
      // Live streaming never engaged — load the finished document directly.
      resultFrame.srcdoc = injectDocumentHead(
        lastArtifactHtml,
        ARTIFACT_VIEWER_INSET_STYLE + ARTIFACT_FIRST_PAINT_SCRIPT
      );
    }
    resultFrame.classList.add("visible");
  }
  resultStatus.textContent = "Fused ✦";
  const bits = [];
  if (meta.model) bits.push(meta.model);
  if (meta.imageModel) bits.push(`→ ${meta.imageModel}`);
  if (meta.usage?.output) bits.push(`${meta.usage.output.toLocaleString()} tokens out`);
  if (meta.stopReason === "max_tokens") bits.push("⚠ truncated at token limit");
  resultMeta.textContent = bits.join(" · ");
  setResultAction(resultDownload, resultKind === "image" ? "Download PNG" : "Download HTML", "↓");
  resultDownload.hidden = false;
  resultRemix.hidden = false;
  resultSave.hidden = false;
  resultShare.hidden = true;
  resultSave.disabled = false;
  setResultAction(resultSave, "Save to Discover", "＋");
}

function setResultAction(button, label, icon) {
  button.setAttribute("aria-label", label);
  button.title = label;
  button.querySelector(".result-action-icon").textContent = icon;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function materializeArtifactHtml(source) {
  let html = source;
  const urls = [...new Set(html.match(/\/api\/genimage\?[^"'\s)>]+/g) || [])];
  for (const url of urls.slice(0, 8)) {
    try {
      const response = await fetch(url.replace(/&amp;/g, "&"));
      if (!response.ok) continue;
      const dataUrl = await blobToDataUrl(await response.blob());
      html = html.split(url).join(dataUrl);
    } catch {
      /* Leave the endpoint URL in place when an illustration can't be materialized. */
    }
  }
  return html;
}

function discoverDownloadName(item) {
  const base = (item?.title || "fusion")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "fusion";
  return `${base}.${item?.kind === "image" ? "png" : "html"}`;
}

function downloadBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

async function openDiscoverEntry(item, { pushHistory = true } = {}) {
  resetResultTransition();
  activeDiscoverEntry = item;
  shareableDiscoverEntry = item;
  if (pushHistory && location.pathname !== discoverEntryPath(item)) {
    history.pushState({ view: "artifact", id: item.id }, "", discoverEntryPath(item));
  }
  resultPanel.hidden = false;
  document.title = `${item.title} — Fuse`;
  resultKind = item.kind;
  lastArtifactHtml = "";
  lastImageDataUrl = "";
  liveAttached = false;
  resultStatus.textContent = item.title;
  resultMeta.textContent = "";
  resultCode.classList.remove("visible");
  resultFrame.classList.remove("visible");
  resultImageWrap.classList.remove("visible");
  resultImageWrap.classList.remove("loading");
  resultImage.removeAttribute("src");
  resultFrame.removeAttribute("srcdoc");
  resultFrame.src = "about:blank";
  resultSave.hidden = true;
  resultShare.hidden = false;
  setResultAction(resultShare, "Copy link", "⧉");
  resultRemix.hidden = false;
  resultDownload.hidden = false;
  setResultAction(resultDownload, item.kind === "image" ? "Download PNG" : "Download HTML", "↓");
  if (item.kind === "image") {
    resultImage.src = item.contentUrl;
    resultImageWrap.classList.add("visible");
  } else {
    resultFrame.classList.add("visible");
    try {
      const response = await fetch(item.contentUrl);
      if (!response.ok) throw new Error("Saved output unavailable.");
      resultFrame.srcdoc = sandboxStoredHtml(await response.text(), { hideScrollbars: true, viewerInset: true });
    } catch (err) {
      resultFrame.classList.remove("visible");
      resultCode.textContent = err.message;
      resultCode.classList.add("visible");
    }
  }
}

resultSave.addEventListener("click", async () => {
  if (resultSave.disabled || !resultKind) return;
  resultSave.disabled = true;
  setResultAction(resultSave, "Saving to Discover", "…");
  try {
    const directive = directiveInput.value.trim();
    const content = resultKind === "image"
      ? lastImageDataUrl
      : await materializeArtifactHtml(lastArtifactHtml);
    const title = resultKind === "html"
      ? generatedDiscoverTitle(content, directive || "Untitled artifact")
      : directive || "Untitled image";
    const response = await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        kind: resultKind,
        directive,
        outputType,
        content,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Couldn't save this output.");
    discoverItems = [payload.item, ...discoverItems.filter((item) => item.id !== payload.item.id)];
    shareableDiscoverEntry = payload.item;
    resultShare.hidden = false;
    setResultAction(resultShare, "Copy link", "⧉");
    setResultAction(resultSave, "Saved to Discover", "✓");
  } catch (err) {
    resultSave.disabled = false;
    setResultAction(resultSave, "Save to Discover", "＋");
    resultMeta.textContent = err.message;
  }
});

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

resultShare.addEventListener("click", async () => {
  if (!shareableDiscoverEntry) return;
  const shareUrl = new URL(discoverEntryPath(shareableDiscoverEntry), location.origin).href;
  await copyTextToClipboard(shareUrl);
  setResultAction(resultShare, "Link copied", "✓");
  setTimeout(() => { setResultAction(resultShare, "Copy link", "⧉"); }, 1600);
});

resultDownload.addEventListener("click", async () => {
  if (activeDiscoverEntry) {
    const response = await fetch(activeDiscoverEntry.contentUrl);
    if (!response.ok) return;
    downloadBlob(await response.blob(), discoverDownloadName(activeDiscoverEntry));
  } else if (resultKind === "image") {
    downloadBlob(await fetch(lastImageDataUrl).then((response) => response.blob()), "fusion.png");
  } else {
    const html = await materializeArtifactHtml(lastArtifactHtml);
    downloadBlob(new Blob([html], { type: "text/html" }), "fusion.html");
  }
});

resultRemix.addEventListener("click", async () => {
  if (blobs.length >= MAX_ITEMS) return flashHint(`Max ${MAX_ITEMS} ingredients — remove one first.`);
  const label = (activeDiscoverEntry?.title || directiveInput.value.trim() || "fusion").slice(0, 40);
  if (activeDiscoverEntry) {
    const response = await fetch(activeDiscoverEntry.contentUrl);
    if (!response.ok) return;
    if (activeDiscoverEntry.kind === "image") {
      const imageBlob = await response.blob();
      addBlob({
        kind: "image",
        dataUrl: await blobToDataUrl(imageBlob),
        mediaType: imageBlob.type || "image/png",
        name: discoverDownloadName(activeDiscoverEntry),
      });
    } else {
      addBlob({ kind: "artifact", html: await response.text(), label });
    }
    activeDiscoverEntry = null;
    resetResultTransition();
    resultPanel.hidden = true;
    closeDiscover();
    render();
    return;
  }
  if (resultKind === "image" && lastImageDataUrl) {
    addBlob({
      kind: "image",
      dataUrl: lastImageDataUrl,
      mediaType: "image/png",
      name: "fusion.png",
    });
  } else if (resultKind === "html" && lastArtifactHtml) {
    addBlob({ kind: "artifact", html: lastArtifactHtml, label });
  }
  resultPanel.hidden = true;
  resetResultTransition();
  render();
});

document.getElementById("result-close").addEventListener("click", () => {
  const returningToDiscover = Boolean(activeDiscoverEntry);
  resetResultTransition();
  resultPanel.hidden = true;
  activeDiscoverEntry = null;
  shareableDiscoverEntry = null;
  if (returningToDiscover && discoverEntryIdFromPath()) {
    history.pushState({ view: "discover" }, "", "/discover");
  }
  document.title = returningToDiscover ? "Discover — Fuse" : "Fuse — metaball mixer";
});

/* ---------------- Init ---------------- */

window.addEventListener("resize", () => {
  render();
  scheduleMagneticSettle();
});
window.addEventListener("stage3d-ready", () => {
  render();
  scheduleMagneticSettle();
});
render();
syncViewFromLocation();
