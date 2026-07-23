"use strict";

/* ---------------- State ---------------- */

const MAX_ITEMS = 5;
const MIN_R = 40;
const MAX_R = 150;
const PALETTE = ["#ff7ac3", "#7ae0ff", "#ffd166", "#8bffb0", "#c9a2ff"];

let blobs = []; // {id, kind:'text'|'image', text?, dataUrl?, mediaType?, name?, x, y, r, color}
let nextId = 1;
let selectedId = null;
let fusing = false;

const stage = document.getElementById("stage");
const gooLayer = document.getElementById("goo-layer");
const contentLayer = document.getElementById("content-layer");
const emptyState = document.getElementById("empty-state");
const itemCount = document.getElementById("item-count");
const toolbar = document.getElementById("blob-toolbar");
const textEntry = document.getElementById("text-entry");
const textEntryInput = document.getElementById("text-entry-input");
const fuseBtn = document.getElementById("fuse-btn");
const directiveInput = document.getElementById("directive");
const fileInput = document.getElementById("file-input");

const resultPanel = document.getElementById("result-panel");
const resultStatus = document.getElementById("result-status");
const resultMeta = document.getElementById("result-meta");
const resultCode = document.getElementById("result-code");
const resultFrame = document.getElementById("result-frame");
const resultDownload = document.getElementById("result-download");
const resultRemix = document.getElementById("result-remix");
const resultImageWrap = document.getElementById("result-image-wrap");
const resultImage = document.getElementById("result-image");

let editingBlobId = null; // when the text entry is editing an existing blob
let lastArtifactHtml = "";
let lastImageDataUrl = "";
let resultKind = null; // 'html' | 'image'
let panelMode = "html"; // what this fuse run is producing: 'html' | 'image'
let liveAttached = false; // iframe is following the server's live HTML stream

/* ---------------- Rendering ---------------- */

function weights() {
  const total = blobs.reduce((s, b) => s + b.r * b.r, 0) || 1;
  const map = {};
  for (const b of blobs) map[b.id] = (100 * b.r * b.r) / total;
  return map;
}

function fontSizeFor(r) {
  return Math.max(11, Math.round(r / 4.4));
}

function render() {
  const w = weights();
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
    chip.style.cssText = `left:${b.x}px;top:${b.y + b.r + 8}px;`;
    chip.textContent = Math.round(w[b.id]) + "%";
    contentLayer.appendChild(chip);
  }

  emptyState.classList.toggle("hidden", blobs.length > 0);
  itemCount.textContent = blobs.length;
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
  toolbar.style.left = b.x + "px";
  toolbar.style.top = Math.max(4, b.y - b.r - 46) + "px";
  document.getElementById("tb-edit").style.display = b.kind === "text" ? "" : "none";
}

/* ---------------- Blob CRUD ---------------- */

function stageCenterSpot(r = 70) {
  // Sample candidate spots and keep the one farthest from existing blobs,
  // so new ingredients spread out instead of stacking at center.
  const rect = stage.getBoundingClientRect();
  const margin = r + 24;
  let best = { x: rect.width / 2, y: rect.height / 2 };
  let bestScore = -Infinity;
  for (let i = 0; i < 40; i++) {
    const x = margin + Math.random() * Math.max(1, rect.width - margin * 2);
    const y = margin + Math.random() * Math.max(1, rect.height - margin * 2);
    const nearest = blobs.length
      ? Math.min(...blobs.map((b) => Math.hypot(x - b.x, y - b.y) - b.r))
      : Infinity;
    // Prefer clear space, but don't wander into far corners when the stage is empty
    const centerPull = -0.25 * Math.hypot(x - rect.width / 2, y - rect.height / 2);
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
  const spot = partial.x != null ? { x: partial.x, y: partial.y } : stageCenterSpot(partial.r || 70);
  const b = {
    id: nextId++,
    r: 70,
    color: PALETTE[(nextId - 2) % PALETTE.length],
    ...partial,
    x: spot.x,
    y: spot.y,
  };
  blobs.push(b);
  selectedId = b.id;
  render();
  return b;
}

function removeBlob(id) {
  blobs = blobs.filter((b) => b.id !== id);
  if (selectedId === id) selectedId = null;
  render();
}

function resizeBlob(id, delta) {
  const b = blobs.find((x) => x.id === id);
  if (!b) return;
  b.r = Math.min(MAX_R, Math.max(MIN_R, b.r + delta));
  render();
}

function flashHint(msg) {
  const hint = document.getElementById("hint");
  const prev = hint.textContent;
  hint.textContent = msg;
  hint.style.color = "#ffd166";
  setTimeout(() => {
    hint.textContent = prev;
    hint.style.color = "";
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

document.getElementById("add-text").addEventListener("click", () => {
  if (blobs.length >= MAX_ITEMS) return flashHint(`Max ${MAX_ITEMS} ingredients.`);
  const rect = stage.getBoundingClientRect();
  openTextEntry(rect.width / 2, rect.height / 2, null);
});

/* ---------------- Images ---------------- */

document.getElementById("add-image").addEventListener("click", () => fileInput.click());
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
        r: 85,
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

/* ---------------- Pointer interactions ---------------- */

let dragState = null; // {id, offsetX, offsetY, moved}

contentLayer.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".blob");
  if (!el) return;
  const id = Number(el.dataset.id);
  const b = blobs.find((x) => x.id === id);
  if (!b) return;
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
    b.x = Math.min(rect.width - 20, Math.max(20, nx));
    b.y = Math.min(rect.height - 20, Math.max(20, ny));
    render();
  }
});

contentLayer.addEventListener("pointerup", (e) => {
  if (!dragState) return;
  const { id, moved } = dragState;
  dragState = null;
  if (!moved) {
    selectedId = selectedId === id ? null : id;
    render();
  }
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
    document.querySelectorAll(".otype").forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    outputType = btn.dataset.type;
  });
});

/* ---------------- Proximity clusters ---------------- */

function computeClusters() {
  // Union-find over blobs whose circles touch (goo-merged on screen).
  // Returns arrays of 1-based indices matching the INGREDIENT numbering.
  const parent = blobs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i], b = blobs[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= a.r + b.r + 14) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map();
  blobs.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i + 1);
  });
  return [...groups.values()];
}

/* ---------------- Fuse ---------------- */

fuseBtn.addEventListener("click", fuse);

async function fuse() {
  if (fusing || blobs.length === 0) return;
  fusing = true;
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
  const clusters = computeClusters();

  openResultPanel(outputType === "image" ? "image" : "html");
  let raw = "";

  try {
    const res = await fetch("/api/fuse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, directive: directiveInput.value.trim(), outputType, clusters }),
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
        } else if (msg.t === "phase" && msg.phase === "paint") {
          resultStatus.textContent = "Painting…";
          resultMeta.textContent = msg.sourceImages
            ? `blending ${msg.sourceImages} source image${msg.sourceImages > 1 ? "s" : ""} with ${msg.imageModel}`
            : `sending the fused prompt to ${msg.imageModel}`;
        } else if (msg.t === "image") {
          lastImageDataUrl = `data:${msg.mediaType};base64,${msg.b64}`;
        } else if (msg.t === "done") {
          finishResult(raw, msg);
        } else if (msg.t === "err") {
          throw new Error(msg.error);
        }
      }
    }
  } catch (err) {
    showResultPanel();
    resultStatus.textContent = "That didn't work";
    resultMeta.textContent = err.message;
    if (!raw) {
      resultFrame.classList.remove("visible");
      resultCode.classList.add("visible");
    }
  } finally {
    fusing = false;
    fuseBtn.classList.remove("busy");
    fuseBtn.textContent = "Fuse";
    window.Stage3D?.release();
    document.body.classList.remove("collapsing");
    render();
  }
}

/* ---------------- Result panel ---------------- */

let panelRevealTimer = null;

function showResultPanel() {
  clearTimeout(panelRevealTimer);
  panelRevealTimer = null;
  resultPanel.hidden = false;
}

function openResultPanel(mode) {
  panelMode = mode;
  clearTimeout(panelRevealTimer);
  if (window.Stage3D?.active) {
    // Let the collapse animation play before the panel covers the stage
    resultPanel.hidden = true;
    panelRevealTimer = setTimeout(showResultPanel, 1150);
  } else {
    resultPanel.hidden = false;
  }
  resultStatus.textContent = "Fusing…";
  resultMeta.textContent = "streaming from the model";
  resultCode.textContent = "";
  resultImageWrap.classList.remove("visible");
  resultImage.removeAttribute("src");
  resultDownload.hidden = true;
  resultRemix.hidden = true;
  lastArtifactHtml = "";
  lastImageDataUrl = "";
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

function finishResult(raw, meta) {
  showResultPanel();
  resultCode.classList.remove("visible");
  if (lastImageDataUrl) {
    resultKind = "image";
    resultImage.src = lastImageDataUrl;
    resultImageWrap.classList.add("visible");
  } else {
    resultKind = "html";
    lastArtifactHtml = extractHtml(raw);
    if (!liveAttached) {
      // Live streaming never engaged — load the finished document directly.
      resultFrame.srcdoc = lastArtifactHtml;
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
  resultDownload.textContent = resultKind === "image" ? "Download .png" : "Download .html";
  resultDownload.hidden = false;
  resultRemix.hidden = false;
}

resultDownload.addEventListener("click", () => {
  const a = document.createElement("a");
  if (resultKind === "image") {
    a.href = lastImageDataUrl;
    a.download = "fusion.png";
    a.click();
  } else {
    const blob = new Blob([lastArtifactHtml], { type: "text/html" });
    a.href = URL.createObjectURL(blob);
    a.download = "fusion.html";
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

resultRemix.addEventListener("click", () => {
  if (blobs.length >= MAX_ITEMS) return flashHint(`Max ${MAX_ITEMS} ingredients — remove one first.`);
  const label = (directiveInput.value.trim() || "fusion").slice(0, 40);
  if (resultKind === "image" && lastImageDataUrl) {
    addBlob({
      kind: "image",
      dataUrl: lastImageDataUrl,
      mediaType: "image/png",
      name: "fusion.png",
      r: 85,
    });
  } else if (resultKind === "html" && lastArtifactHtml) {
    addBlob({ kind: "artifact", html: lastArtifactHtml, label, r: 80 });
  }
  resultPanel.hidden = true;
  render();
});

document.getElementById("result-close").addEventListener("click", () => {
  resultPanel.hidden = true;
});

/* ---------------- Init ---------------- */

window.addEventListener("resize", render);
window.addEventListener("stage3d-ready", render);
render();
