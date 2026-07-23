import express from "express";
import { randomUUID } from "node:crypto";
import Anthropic, { BadRequestError } from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.FUSE_MODEL || "claude-fable-5";
const FALLBACK_MODEL = "claude-opus-4-8";
const FALLBACK_BETA = "server-side-fallback-2026-06-01";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-2";
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com";
const MAX_ITEMS = 5;
const ARTIFACT_CHAR_CAP = 40000;

const client = new Anthropic();
const app = express();

app.use(express.json({ limit: "40mb" }));
app.use(express.static("public"));

const HTML_SYSTEM = `You are Fuse, a creative engine that blends "ingredients" into a single interactive HTML artifact.

You receive up to five ingredients — short text snippets, images, and sometimes previously fused artifacts — each with an influence weight (a percentage), plus a directive describing what to make (a report, a game, a quiz, a slide deck, a choose-your-own-adventure, or anything else).

How to blend:
- Treat the weights as how strongly each ingredient should shape the result. A dominant ingredient (45%+) sets the theme, subject, or mechanic. Supporting ingredients (20-44%) shape major sections or features. Accent ingredients (<20%) appear as flavor, easter eggs, or styling touches.
- Every ingredient must be recognizably present in the output. Nothing gets dropped.
- For image ingredients, blend what the image depicts — its subject, mood, palette, and style — into the artifact. Echo the image's color palette in your design.
- For fused-artifact ingredients (HTML from a previous fusion), blend their themes, content, characters, and mechanics — remix them, don't just copy the markup.
- Respect the PROXIMITY notes if present: touching ingredients should merge into one tightly-integrated concept; a distant ingredient is a garnish that seasons the whole rather than a core element.

Output contract (strict):
- Respond with exactly one complete, self-contained HTML document and nothing else. Start with <!doctype html>. No markdown fences, no commentary before or after.
- Inline all CSS and JavaScript. Zero external requests: no CDNs, no external fonts, no remote images. If you need graphics, draw them with inline SVG, CSS, or canvas.
- The page must work when loaded in a sandboxed iframe (scripts allowed, no network).
- Make it delightful: polished layout, a cohesive palette drawn from the ingredients, satisfying micro-interactions. For games/quizzes/adventures, the interactivity must genuinely work (state, scoring, branching). For slide decks, include keyboard and button navigation. For reports, invent plausible, clearly-illustrative content grounded in the ingredients.
- Keep it responsive and usable on both desktop and mobile widths.`;

const IMAGE_PROMPT_SYSTEM = `You are Fuse, a creative engine that blends "ingredients" into a single picture.

You receive up to five ingredients — short text snippets, images, and sometimes previously fused artifacts — each with an influence weight (a percentage), plus an optional directive.

Write ONE vivid image-generation prompt that fuses them: the dominant ingredient (45%+) sets the subject and overall style; supporting ingredients (20-44%) shape major elements; accents (<20%) appear as small touches. Respect the PROXIMITY notes if present: touching ingredients merge into one integrated concept; a distant ingredient is a subtle garnish. Describe subject, composition, style, palette, lighting, and mood in concrete visual language.

If image ingredients are present, they will also be handed to the image generator directly as source images, in the same order they are numbered here. Write the prompt as transformation instructions: say how to combine, restyle, or recompose the source images and how to weave the other ingredients around them, referring to each source naturally (e.g. "the photo of the cat"). Weights still govern how prominent each source is.

Output contract (strict): respond with only the prompt text — plain prose, 60 to 150 words, no headings, no quotes, no commentary, no mention of weights or percentages.`;

/* ---------------- Prompt assembly ---------------- */

function weightLabel(pct) {
  if (pct >= 45) return "dominant";
  if (pct >= 20) return "supporting";
  return "accent";
}

function proximityLines(clusters, itemCount) {
  if (!Array.isArray(clusters) || itemCount < 2) return [];
  const valid = clusters.filter(
    (c) => Array.isArray(c) && c.every((n) => Number.isInteger(n) && n >= 1 && n <= itemCount)
  );
  const groups = valid.filter((c) => c.length >= 2);
  const solos = valid.filter((c) => c.length === 1).map((c) => c[0]);
  if (!groups.length) return [];
  const lines = ["PROXIMITY (how the ingredients sit on the canvas):"];
  for (const g of groups) {
    lines.push(
      `- Ingredients ${g.join(" + ")} are touching — fuse them into one tightly-integrated concept.`
    );
  }
  if (solos.length) {
    const s = solos.length > 1;
    lines.push(
      `- Ingredient${s ? "s" : ""} ${solos.join(", ")} sit${s ? "" : "s"} apart — use ${s ? "them" : "it"} as a garnish that seasons the whole rather than a core element.`
    );
  }
  return lines;
}

function buildUserContent({ items, directive, outputType, clusters, mode }) {
  const content = [];
  const lines = [];
  lines.push(`Here are the ${items.length} ingredient(s) on the canvas:`);

  items.forEach((item, i) => {
    const n = i + 1;
    const pct = Math.round(item.weightPct);
    const label = weightLabel(pct);
    if (item.kind === "image") {
      lines.push(
        `INGREDIENT ${n} — image, ${pct}% influence (${label}): see attached image ${n}${item.name ? ` ("${item.name}")` : ""}.`
      );
    } else if (item.kind === "artifact") {
      lines.push(
        `INGREDIENT ${n} — fused artifact from a previous creation${item.label ? ` ("${item.label}")` : ""}, ${pct}% influence (${label}): blend its themes, content, and mechanics. Its HTML source is attached below.`
      );
    } else {
      lines.push(`INGREDIENT ${n} — text, ${pct}% influence (${label}): «${item.text}»`);
    }
  });

  const prox = proximityLines(clusters, items.length);
  if (prox.length) {
    lines.push("");
    lines.push(...prox);
  }

  lines.push("");
  if (mode === "image") {
    lines.push(`DIRECTIVE: ${directive || "Fuse these ingredients into one striking picture."}`);
    if (items.some((it) => it.kind === "image")) {
      lines.push(
        "The image ingredients above will be handed to the image generator as source images (in the same order) — write the prompt as instructions for transforming and combining them."
      );
    }
    lines.push("Remember the output contract: only the image prompt text, nothing else.");
  } else {
    const typeNote =
      outputType && outputType !== "auto"
        ? `The artifact must be a ${outputType}.`
        : "Choose the artifact format that best fits the directive and ingredients.";
    lines.push(`DIRECTIVE: ${directive || "Fuse these ingredients into something delightful."}`);
    lines.push(typeNote);
    lines.push("Remember the output contract: one self-contained HTML document, nothing else.");
  }

  content.push({ type: "text", text: lines.join("\n") });

  items.forEach((item, i) => {
    if (item.kind === "image") {
      content.push({ type: "text", text: `Attached image ${i + 1}:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: item.mediaType, data: item.imageBase64 },
      });
    } else if (item.kind === "artifact") {
      const html = item.html.slice(0, ARTIFACT_CHAR_CAP);
      const truncated = item.html.length > ARTIFACT_CHAR_CAP ? " (truncated)" : "";
      content.push({
        type: "text",
        text: `Source of ingredient ${i + 1}${truncated}:\n${html}`,
      });
    }
  });

  return content;
}

/* ---------------- Claude streaming with refusal fallback ---------------- */

async function streamClaude({ system, messages, maxTokens, onText }) {
  const base = { model: MODEL, max_tokens: maxTokens, system, messages };
  let emitted = false;
  const wrap = (text) => {
    emitted = true;
    onText(text);
  };
  try {
    const stream = client.beta.messages.stream({
      ...base,
      betas: [FALLBACK_BETA],
      fallbacks: [{ model: FALLBACK_MODEL }],
    });
    stream.on("text", wrap);
    return await stream.finalMessage();
  } catch (err) {
    // If the org/platform doesn't support the fallback beta, retry plain —
    // but only if nothing was streamed yet (otherwise we'd duplicate text).
    if (!emitted && err instanceof BadRequestError && /fallback/i.test(String(err.message))) {
      const stream = client.messages.stream(base);
      stream.on("text", wrap);
      return await stream.finalMessage();
    }
    throw err;
  }
}

function refusalMessage(finalMessage) {
  if (finalMessage.stop_reason !== "refusal") return null;
  const category = finalMessage.stop_details?.category;
  return `The model declined this request${category ? ` (${category})` : ""}. Try different ingredients or a different directive.`;
}

/* ---------------- OpenAI image generation ---------------- */

async function generateImage(prompt, imageItems = []) {
  const auth = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  let r;
  if (imageItems.length) {
    // Source images go to the edits endpoint directly, so the generator blends
    // the actual pixels; the fused prompt acts as transformation instructions.
    const form = new FormData();
    form.append("model", IMAGE_MODEL);
    form.append("prompt", prompt);
    form.append("size", "1024x1024");
    imageItems.forEach((item, i) => {
      const buf = Buffer.from(item.imageBase64, "base64");
      const ext = item.mediaType === "image/png" ? "png" : "jpg";
      form.append("image[]", new Blob([buf], { type: item.mediaType }), `ingredient-${i + 1}.${ext}`);
    });
    r = await fetch(`${OPENAI_BASE}/v1/images/edits`, {
      method: "POST",
      headers: auth,
      body: form,
    });
  } else {
    r = await fetch(`${OPENAI_BASE}/v1/images/generations`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: "1024x1024" }),
    });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.error?.message || `Image generation failed (${r.status}).`);
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image API returned no image data.");
  return b64;
}

/* ---------------- Live HTML streaming ----------------
   Each HTML fusion is also exposed as a chunked text/html stream at
   /api/live/:id. The client points its sandboxed iframe there, and the
   browser's own streaming parser renders the page tag-by-tag as it arrives. */

const liveStreams = new Map(); // id -> {chunks: [], done: boolean, waiters: Set<res>}
const LIVE_TTL_MS = 10 * 60 * 1000;
const LIVE_HOLDBACK = 8; // keep a small tail so a trailing ``` fence never renders

function createLiveStream() {
  const id = randomUUID();
  const s = { chunks: [], done: false, waiters: new Set() };
  liveStreams.set(id, s);
  setTimeout(() => liveStreams.delete(id), LIVE_TTL_MS).unref?.();
  return { id, s };
}

function livePush(s, text) {
  if (!text) return;
  s.chunks.push(text);
  for (const w of s.waiters) w.write(text);
}

function liveEnd(s) {
  s.done = true;
  for (const w of s.waiters) w.end();
  s.waiters.clear();
}

// Feeds raw model deltas into a live stream, trimming any pre-document
// preamble (e.g. a ```html fence) and holding back a small tail so trailing
// junk can be stripped before the last flush.
function liveFeeder(s) {
  let raw = "";
  let started = false;
  let sentLen = 0;
  return {
    push(text) {
      raw += text;
      if (!started) {
        const at = raw.search(/<!doctype html|<html[\s>]/i);
        if (at >= 0) {
          started = true;
          sentLen = at;
        } else if (raw.length > 3000) {
          started = true; // no marker in sight — stream as-is
        } else {
          return;
        }
      }
      const avail = raw.length - LIVE_HOLDBACK;
      if (avail > sentLen) {
        livePush(s, raw.slice(sentLen, avail));
        sentLen = avail;
      }
    },
    finish() {
      if (started) {
        const tail = raw.slice(sentLen).replace(/```\s*$/, "");
        livePush(s, tail);
      }
      liveEnd(s);
    },
  };
}

app.get("/api/live/:id", (req, res) => {
  const s = liveStreams.get(req.params.id);
  if (!s) return res.status(404).send("This fusion's live stream has expired.");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.flushHeaders();
  for (const c of s.chunks) res.write(c);
  if (s.done) return res.end();
  s.waiters.add(res);
  req.on("close", () => s.waiters.delete(res));
});

/* ---------------- Route ---------------- */

function send(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
}

app.post("/api/fuse", async (req, res) => {
  const { items, directive, outputType, clusters } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Add at least one ingredient to the canvas." });
  }
  if (items.length > MAX_ITEMS) {
    return res.status(400).json({ error: `At most ${MAX_ITEMS} ingredients.` });
  }
  for (const item of items) {
    if (item.kind === "text" && !item.text?.trim()) {
      return res.status(400).json({ error: "A text ingredient is empty." });
    }
    if (item.kind === "image" && (!item.imageBase64 || !item.mediaType)) {
      return res.status(400).json({ error: "An image ingredient is missing data." });
    }
    if (item.kind === "artifact" && !item.html?.trim()) {
      return res.status(400).json({ error: "An artifact ingredient is missing its source." });
    }
  }

  const imageMode = outputType === "image";
  if (imageMode && !process.env.OPENAI_API_KEY) {
    return res
      .status(400)
      .json({ error: "Image output needs OPENAI_API_KEY set on the server." });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  let feeder = null;
  if (!imageMode) {
    const { id, s } = createLiveStream();
    feeder = liveFeeder(s);
    send(res, { t: "live", id });
  }

  const onText = (text) => {
    send(res, { t: "delta", text });
    feeder?.push(text);
  };

  try {
    const messages = [
      {
        role: "user",
        content: buildUserContent({
          items,
          directive,
          outputType,
          clusters,
          mode: imageMode ? "image" : "html",
        }),
      },
    ];

    const finalMessage = await streamClaude({
      system: imageMode ? IMAGE_PROMPT_SYSTEM : HTML_SYSTEM,
      messages,
      maxTokens: imageMode ? 2000 : 64000,
      onText,
    });

    const refused = refusalMessage(finalMessage);
    if (refused) {
      feeder?.finish();
      send(res, { t: "err", error: refused });
      return;
    }

    if (imageMode) {
      const prompt = finalMessage.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      const imageItems = items.filter((it) => it.kind === "image");
      send(res, {
        t: "phase",
        phase: "paint",
        imageModel: IMAGE_MODEL,
        sourceImages: imageItems.length,
      });
      const b64 = await generateImage(prompt, imageItems);
      send(res, { t: "image", b64, mediaType: "image/png" });
      send(res, {
        t: "done",
        model: finalMessage.model,
        imageModel: IMAGE_MODEL,
        stopReason: finalMessage.stop_reason,
        usage: {
          input: finalMessage.usage?.input_tokens,
          output: finalMessage.usage?.output_tokens,
        },
      });
    } else {
      feeder?.finish();
      send(res, {
        t: "done",
        model: finalMessage.model,
        stopReason: finalMessage.stop_reason,
        usage: {
          input: finalMessage.usage?.input_tokens,
          output: finalMessage.usage?.output_tokens,
        },
      });
    }
  } catch (err) {
    feeder?.finish();
    const detail =
      err?.status === 401 || /authentication method|apiKey or authToken/i.test(String(err?.message))
        ? "The server has no API credentials — set ANTHROPIC_API_KEY and restart."
        : err?.message || "Unexpected error.";
    console.error("fuse error:", err);
    send(res, { t: "err", error: detail });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Fuse is running → http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "Note: ANTHROPIC_API_KEY is not set. The UI will load, but fusing will fail unless the SDK finds credentials another way (e.g. an `ant auth login` profile)."
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn("Note: OPENAI_API_KEY is not set — the Image output type will be unavailable.");
  }
});
