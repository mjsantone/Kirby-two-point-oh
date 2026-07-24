import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import PImage from "pureimage";
import Anthropic, { BadRequestError } from "@anthropic-ai/sdk";
import {
  discoverStorageMode,
  getDiscoverContent,
  listDiscoverItems,
  saveDiscoverItem,
} from "./discover-store.js";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.FUSE_MODEL || "claude-fable-5";
const FALLBACK_MODEL = "claude-opus-4-8";
const FALLBACK_BETA = "server-side-fallback-2026-06-01";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-2";
const OPENAI_BASE = process.env.OPENAI_BASE_URL || "https://api.openai.com";
const MAX_ITEMS = 5;
const ARTIFACT_CHAR_CAP = 40000;
const INDEX_PATH = fileURLToPath(new URL("./public/index.html", import.meta.url));
const indexTemplatePromise = readFile(INDEX_PATH, "utf8");

const client = new Anthropic();
const app = express();

app.use(express.json({ limit: "40mb" }));
app.use(express.static("public"));
app.use("/vendor/three", express.static("node_modules/three"));
app.get("/discover", (_req, res) => {
  res.sendFile(INDEX_PATH);
});
app.get("/discover/:id", async (req, res) => {
  const id = discoverId(req.params.id);
  if (!id) return res.status(404).send("Saved output not found.");
  try {
    const stored = await getDiscoverContent(id);
    if (!stored?.item) return res.status(404).send("Saved output not found.");
    const item = { ...stored.item };
    let generatedDescription = "";
    if (stored.contentType.startsWith("text/html")) {
      const html = stored.content.toString("utf8");
      item.title = generatedHtmlTitle(html) || item.title;
      generatedDescription = generatedHtmlDescription(html);
    }
    const forwardedProtocol = String(req.get("x-forwarded-proto") || req.protocol).split(",")[0];
    const origin = `${forwardedProtocol}://${req.get("host")}`;
    const pageUrl = `${origin}/discover/${id}`;
    const imageUrl = `${origin}/api/discover/${id}/share-card.png`;
    const description = generatedDescription || (item.directive
      ? item.directive.slice(0, 180)
      : `A saved ${item.kind === "image" ? "image" : "interactive artifact"} created with Fuse.`);
    const social = [
      `<meta name="description" content="${escapeMarkup(description)}">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="Fuse">`,
      `<meta property="og:title" content="${escapeMarkup(item.title)}">`,
      `<meta property="og:description" content="${escapeMarkup(description)}">`,
      `<meta property="og:url" content="${escapeMarkup(pageUrl)}">`,
      `<meta property="og:image" content="${escapeMarkup(imageUrl)}">`,
      `<meta property="og:image:secure_url" content="${escapeMarkup(imageUrl)}">`,
      `<meta property="og:image:type" content="image/png">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="Preview card for ${escapeMarkup(item.title)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${escapeMarkup(item.title)}">`,
      `<meta name="twitter:description" content="${escapeMarkup(description)}">`,
      `<meta name="twitter:image" content="${escapeMarkup(imageUrl)}">`,
      `<link rel="canonical" href="${escapeMarkup(pageUrl)}">`,
    ].join("\n  ");
    const template = await indexTemplatePromise;
    const page = template
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeMarkup(item.title)} — Fuse</title>`)
      .replace("</head>", `  ${social}\n</head>`);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("html").send(page);
  } catch (err) {
    console.error("discover share page error:", err);
    res.status(500).send("Couldn't load this saved output.");
  }
});

/* ---------------- Discover gallery ---------------- */

const DISCOVER_CONTENT_LIMIT = 35 * 1024 * 1024;
const shareCardCache = new Map();
const DISCOVER_HTML_CSP = [
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

function discoverId(value) {
  const id = String(value || "");
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function escapeMarkup(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shareTitleLines(title, maxChars = 25, maxLines = 3) {
  const words = String(title || "Untitled fusion").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= maxChars || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").split(/\s+/).length;
  if (consumed < words.length) lines[lines.length - 1] = `${lines.at(-1).replace(/[.,;:!?-]*$/, "")}…`;
  return lines;
}

function shareAccent(id) {
  const palette = ["#ff7ac3", "#7ae0ff", "#ffd166", "#8bffb0", "#c9a2ff"];
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

let shareFonts;

function firstExisting(paths) {
  return paths.find((candidate) => existsSync(candidate));
}

function getShareFonts() {
  if (shareFonts !== undefined) return shareFonts;
  const regularPath = firstExisting([
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  ]);
  const boldPath = firstExisting([
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
  ]);
  const serifPath = firstExisting([
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
  ]);
  if (!regularPath) {
    shareFonts = null;
    return shareFonts;
  }
  try {
    PImage.registerFont(regularPath, "ShareSans").loadSync();
    PImage.registerFont(boldPath || regularPath, "ShareBold").loadSync();
    PImage.registerFont(serifPath || regularPath, "ShareSerif").loadSync();
    shareFonts = { regular: "ShareSans", bold: "ShareBold", serif: "ShareSerif" };
  } catch (err) {
    console.warn("Share-card fonts unavailable:", err.message);
    shareFonts = null;
  }
  return shareFonts;
}

function fillCircle(context, x, y, radius, color) {
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

function fillRoundedRect(context, x, y, width, height, radius, color) {
  context.fillStyle = color;
  context.fillRect(x + radius, y, width - radius * 2, height);
  context.fillRect(x, y + radius, width, height - radius * 2);
  fillCircle(context, x + radius, y + radius, radius, color);
  fillCircle(context, x + width - radius, y + radius, radius, color);
  fillCircle(context, x + radius, y + height - radius, radius, color);
  fillCircle(context, x + width - radius, y + height - radius, radius, color);
}

async function encodeSharePng(image) {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (chunk) => chunks.push(chunk));
  const ended = new Promise((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  await PImage.encodePNGToStream(image, stream);
  await ended;
  return Buffer.concat(chunks);
}

async function renderShareCard(item) {
  const lines = shareTitleLines(item.title);
  const accent = shareAccent(item.id);
  const kind = item.kind === "image" ? "IMAGE" : "INTERACTIVE ARTIFACT";
  const image = PImage.make(1200, 630);
  const context = image.getContext("2d");

  context.fillStyle = "#151718";
  context.fillRect(0, 0, 1200, 630);
  context.strokeStyle = "#292b2d";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x <= 1200; x += 48) { context.moveTo(x, 0); context.lineTo(x, 630); }
  for (let y = 0; y <= 630; y += 48) { context.moveTo(0, y); context.lineTo(1200, y); }
  context.stroke();
  fillRoundedRect(context, 39, 39, 1122, 552, 45, "#3d3f41");
  fillRoundedRect(context, 40, 40, 1120, 550, 44, "#171819");
  fillCircle(context, 84, 86, 14, "#ff7ac3");
  fillCircle(context, 101, 86, 14, "#7ae0ff");
  fillCircle(context, 118, 86, 14, "#ffd166");
  fillRoundedRect(context, 80, 158, 64, 8, 4, accent);

  const fonts = getShareFonts();
  if (fonts) {
    context.fillStyle = "#f5f5f5";
    context.font = `34px ${fonts.bold}`;
    context.fillText("Fuse", 148, 98);
    context.font = `72px ${fonts.serif}`;
    lines.forEach((line, index) => context.fillText(line, 80, 270 + index * 82));
    context.fillStyle = "#a9abad";
    context.font = `20px ${fonts.bold}`;
    context.fillText(kind, 80, 548);
    context.fillStyle = accent;
    context.font = `22px ${fonts.bold}`;
    context.textAlign = "right";
    context.fillText("Open in Fuse →", 1120, 548);
    context.textAlign = "start";
  } else {
    fillRoundedRect(context, 148, 72, 78, 24, 12, "#f5f5f5");
    lines.forEach((_line, index) => {
      fillRoundedRect(context, 80, 218 + index * 82, 760 - index * 70, 54, 12, "#f5f5f5");
    });
    fillRoundedRect(context, 80, 526, 250, 20, 10, "#a9abad");
    fillRoundedRect(context, 910, 526, 210, 20, 10, accent);
  }

  return encodeSharePng(image);
}

function decodeHtmlText(value) {
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  };
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ndash|mdash|hellip|lsquo|rsquo|ldquo|rdquo);/gi, (_match, entity) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] || "";
      const hex = entity[1].toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function generatedHtmlTitle(html) {
  const candidates = [
    html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  ];
  return candidates.map(decodeHtmlText).find((value) => value.length >= 3)?.slice(0, 120) || "";
}

function generatedHtmlDescription(html) {
  const metaTag = html.match(/<meta\s+[^>]*name=["']description["'][^>]*>/i)?.[0];
  const metaDescription = metaTag?.match(/content=["']([^"']+)["']/i)?.[1];
  const candidates = [
    metaDescription,
    ...[...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].slice(0, 4).map((match) => match[1]),
  ];
  const description = candidates
    .map(decodeHtmlText)
    .find((value) => value.length >= 40);
  return description ? clipText(description, 180) : "";
}

function clipText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength - 1);
  const boundary = Math.max(clipped.lastIndexOf(" "), clipped.lastIndexOf("—"));
  return `${clipped.slice(0, boundary > maxLength * 0.7 ? boundary : clipped.length).trim()}…`;
}

app.get("/api/discover", async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(96, Math.max(1, requestedLimit)) : 48;
    res.json({ items: await listDiscoverItems(limit), storage: discoverStorageMode() });
  } catch (err) {
    console.error("discover list error:", err);
    res.status(500).json({ error: "Couldn't load Discover right now." });
  }
});

app.post("/api/discover", async (req, res) => {
  try {
    const kind = req.body?.kind;
    const requestedTitle = String(req.body?.title || "Untitled fusion").trim().slice(0, 120) || "Untitled fusion";
    const directive = String(req.body?.directive || "").trim().slice(0, 500);
    const outputType = String(req.body?.outputType || "auto").trim().slice(0, 80);
    const rawContent = String(req.body?.content || "");

    let content;
    let contentType;
    if (kind === "html") {
      if (!/<html[\s>]|<!doctype html/i.test(rawContent)) {
        return res.status(400).json({ error: "The artifact is missing a complete HTML document." });
      }
      content = Buffer.from(rawContent, "utf8");
      contentType = "text/html; charset=utf-8";
    } else if (kind === "image") {
      const match = rawContent.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i);
      if (!match) return res.status(400).json({ error: "The saved image format isn't supported." });
      content = Buffer.from(match[2], "base64");
      contentType = match[1].toLowerCase();
    } else {
      return res.status(400).json({ error: "Discover accepts HTML artifacts and images." });
    }

    if (!content.length) return res.status(400).json({ error: "The saved output is empty." });
    if (content.length > DISCOVER_CONTENT_LIMIT) {
      return res.status(413).json({ error: "This output is too large to save to Discover." });
    }

    const id = randomUUID();
    const title = kind === "html" ? generatedHtmlTitle(rawContent) || requestedTitle : requestedTitle;
    const item = await saveDiscoverItem(
      {
        id,
        title,
        kind,
        directive,
        outputType,
        createdAt: new Date().toISOString(),
        contentType,
      },
      content
    );
    res.status(201).json({ item, storage: discoverStorageMode() });
  } catch (err) {
    console.error("discover save error:", err);
    res.status(500).json({ error: "Couldn't save this output to Discover." });
  }
});

app.get("/api/discover/:id", async (req, res) => {
  const id = discoverId(req.params.id);
  if (!id) return res.status(404).json({ error: "Saved output not found." });
  try {
    const stored = await getDiscoverContent(id);
    if (!stored?.item) return res.status(404).json({ error: "Saved output not found." });
    const item = { ...stored.item };
    if (stored.contentType.startsWith("text/html")) {
      item.title = generatedHtmlTitle(stored.content.toString("utf8")) || item.title;
    }
    res.json({ item });
  } catch (err) {
    console.error("discover item error:", err);
    res.status(500).json({ error: "Couldn't load this saved output." });
  }
});

app.get("/api/discover/:id/share-card.png", async (req, res) => {
  const id = discoverId(req.params.id);
  if (!id) return res.status(404).send("Saved output not found.");
  try {
    let png = shareCardCache.get(id);
    if (!png) {
      const stored = await getDiscoverContent(id);
      if (!stored?.item) return res.status(404).send("Saved output not found.");
      const item = { ...stored.item };
      if (stored.contentType.startsWith("text/html")) {
        item.title = generatedHtmlTitle(stored.content.toString("utf8")) || item.title;
      }
      png = await renderShareCard(item);
      shareCardCache.set(id, png);
      if (shareCardCache.size > 100) shareCardCache.delete(shareCardCache.keys().next().value);
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(png);
  } catch (err) {
    console.error("discover share card error:", err);
    res.status(500).send("Couldn't render this share card.");
  }
});

app.get("/api/discover/:id/content", async (req, res) => {
  const id = discoverId(req.params.id);
  if (!id) return res.status(404).send("Saved output not found.");
  try {
    const stored = await getDiscoverContent(id);
    if (!stored) return res.status(404).send("Saved output not found.");
    res.setHeader("Content-Type", stored.contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (stored.contentType.startsWith("text/html")) {
      res.setHeader("Content-Security-Policy", DISCOVER_HTML_CSP);
    }
    res.send(stored.content);
  } catch (err) {
    console.error("discover content error:", err);
    res.status(500).send("Couldn't load this saved output.");
  }
});

const HTML_SYSTEM_BASE = `You are Fuse, a creative engine that blends "ingredients" into a single interactive HTML artifact.

You receive up to five ingredients — short text snippets, images, and sometimes previously fused artifacts — each with an influence weight (a percentage), plus a directive describing what to make (a report, a game, a quiz, a slide deck, a choose-your-own-adventure, or anything else).

How to blend:
- Treat the weights as how strongly each ingredient should shape the result. A dominant ingredient (45%+) sets the theme, subject, or mechanic. Supporting ingredients (20-44%) shape major sections or features. Accent ingredients (<20%) appear as flavor, easter eggs, or styling touches.
- Every ingredient must be recognizably present in the output. Nothing gets dropped.
- For image ingredients, blend what the image depicts — its subject, mood, palette, and style — into the artifact. Echo the image's color palette in your design.
- For fused-artifact ingredients (HTML from a previous fusion), blend their themes, content, characters, and mechanics — remix them, don't just copy the markup.
- Respect the PROXIMITY notes if present: touching ingredients should merge into one tightly-integrated concept; a distant ingredient is a garnish that seasons the whole rather than a core element.

Visual direction — editorial Microsoft, interpreted at a high level:
- Combine magazine-grade editorial hierarchy with structured document rigor. Let typography, reading rhythm, and information architecture carry the design before decoration does.
- Pair an expressive serif voice for major editorial headlines, meaningful numerical values, and rare italic emphasis with a clean sans-serif voice for body copy, labels, controls, tables, and functional UI. Body copy is always sans-serif. Functional artifacts may remain sans-led throughout.
- Build on a disciplined grid and readable text measure. Keep sustained reading comfortably narrow; let only genuine hero moments break the grid, deliberately and sparingly.
- Use a restrained neutral foundation with paired-tone accents. When colored elements carry text, combine a light tone with its dark counterpart; use middle tones only as standalone fills. Keep headings and body text neutral. Color clarifies hierarchy, category, and relationships — never mere decoration.
- Compose information as a small narrative: frame data with context and a takeaway, create visual punctuation in longer pieces, and vary density to support the content.
- Favor generous negative space, hairline rules, crisp geometry, accessible contrast, restrained imagery, and a few intentional expressive moments. Adapt the balance to the format: reports can feel editorial; games and tools should remain functional and interaction-first.
- Treat this as design guidance, not a component library. Do not mention or reproduce named patterns, component specifications, class names, fixed dimensions, source templates, or external font requirements. Invent a fit-for-purpose composition using only self-contained HTML, CSS, and available system fonts.

Avoid generic generated-interface tells:
- Do not wrap every section in a rounded card, nest cards, or default to uniform bento and three-column grids. Use a container only when it expresses a meaningful grouping or interaction.
- Reserve pills and chips for tags, filters, statuses, and compact controls. Do not use them for ordinary headings, labels, or decorative metadata, and do not repeat tiny tracked all-caps eyebrow labels above every heading.
- Do not use gradient text, glowing orbs, aurora washes, purple-blue gradients, gratuitous glass panels, or heavy shadows as generic decoration. Establish a restrained radius and elevation hierarchy instead of giving every surface the same oversized rounding and floating treatment.
- Let the requested artifact determine the composition. Do not force reports, tools, games, or documents into a marketing landing-page sequence or generic dashboard structure.
- Do not add fake navigation, inactive controls, decorative filters, unsupported metrics, invented progress bars, or purposeless charts. Every apparent control must work and every data display must communicate something grounded in the artifact.
- Do not use left-edge borders, accent rails, or vertical bars as a decorative or hierarchy device on any element — including blockquotes, pull quotes, callouts, alerts, cards, panels, labels, and controls. Do not recreate the treatment with pseudo-elements. Use spacing, typography, full-width rules, or tonal surfaces instead.
- Use motion only to communicate state, causality, progress, or spatial change. Do not animate every section on entry or add perpetual floating, pulsing, shimmer, or hover movement as decoration; honor prefers-reduced-motion.

Output contract (strict):
- Respond with exactly one complete, self-contained HTML document and nothing else. Start with <!doctype html>. No markdown fences, no commentary before or after.
- Give the document a concise, distinctive <title> that reads like a memorable headline (roughly 3–9 words). Do not use a generic format label such as "Report" or "Infographic," and do not simply copy the directive.
- Inline all CSS and JavaScript. Zero external requests: no CDNs, no external fonts, no remote images. If you need graphics, draw them with inline SVG, CSS, or canvas.
- The page must work when loaded in a sandboxed iframe (scripts allowed, no network).
- Make it delightful: polished layout, a cohesive palette drawn from the ingredients, satisfying micro-interactions. For games/quizzes/adventures, the interactivity must genuinely work (state, scoring, branching). For slide decks, include keyboard and button navigation. For reports, invent plausible, clearly-illustrative content grounded in the ingredients.
- Keep it responsive and usable on both desktop and mobile widths.`;

const ILLUSTRATIONS_ADDENDUM = `

Illustrations (available): you can embed AI-generated images inside the artifact. Write an <img> tag whose src is exactly "/api/genimage?prompt=" followed by a URL-encoded, richly detailed visual description (subject, style, palette, lighting — consistent with the artifact's design). Optionally append "&size=wide" or "&size=tall" for banners and portraits. This same-origin endpoint is the one exception to the no-external-requests rule.

Reach for generated images whenever they are the best visual option: hero art, scene illustrations for adventure passages, character portraits, quiz-question visuals, slide backdrops, report figures with a photographic or painterly quality. Prefer them over laboriously hand-drawing complex imagery in SVG — save inline SVG/CSS for icons, charts, and geometric decoration where it excels. Give each image a distinct, specific prompt in a consistent art style so the artifact feels art-directed rather than clip-arted.

Each image takes several seconds to generate on first load: always set explicit dimensions or CSS sizing plus a background-color placeholder so layout holds, give every image alt text, and design the page to work even if they never load.`;

const IMAGE_SWITCH_ADDENDUM = `

Output switch: if the directive plainly asks for a single image, picture, photo, poster, or illustration as the deliverable itself (not an interactive page), do not write HTML. Instead respond with exactly:
IMAGE_PROMPT: <one richly detailed 60-150 word image prompt fusing the weighted ingredients>
and nothing else.`;

function buildHtmlSystem({ allowIllustrations, allowImageSwitch }) {
  let s = HTML_SYSTEM_BASE;
  if (allowIllustrations) s += ILLUSTRATIONS_ADDENDUM;
  if (allowImageSwitch) s += IMAGE_SWITCH_ADDENDUM;
  return s;
}

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

const CREDITS_EXHAUSTED_MESSAGE =
  "You've spent all of Matthew's AI money. Message him to buy more credits — or ask him for his Zelle.";

function isCreditsExhausted(err) {
  const code = [err?.code, err?.type, err?.error?.code, err?.error?.type]
    .filter(Boolean)
    .join(" ");
  const message = String(err?.message || err?.error?.message || "");
  return /insufficient_quota|billing_hard_limit_reached|billing_not_active/i.test(code)
    || /credit balance is too low|insufficient credits?|not enough credits?|purchase (?:more )?credits/i.test(message)
    || /exceeded your current quota[\s\S]*billing/i.test(message);
}

function publicGenerationError(err) {
  if (isCreditsExhausted(err)) return CREDITS_EXHAUSTED_MESSAGE;
  if (err?.status === 401 || /authentication method|apiKey or authToken/i.test(String(err?.message))) {
    return err?.provider === "openai"
      ? "The server's OpenAI credentials aren't working — check OPENAI_API_KEY."
      : "The server has no API credentials — set ANTHROPIC_API_KEY and restart.";
  }
  return err?.message || "Unexpected error.";
}

/* ---------------- OpenAI image generation ---------------- */

async function generateImage(prompt, imageItems = [], size = "1024x1024") {
  const auth = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
  let r;
  if (imageItems.length) {
    // Source images go to the edits endpoint directly, so the generator blends
    // the actual pixels; the fused prompt acts as transformation instructions.
    const form = new FormData();
    form.append("model", IMAGE_MODEL);
    form.append("prompt", prompt);
    form.append("size", size);
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
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size }),
    });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data?.error || {};
    const error = new Error(detail.message || `Image generation failed (${r.status}).`);
    error.status = r.status;
    error.code = detail.code;
    error.type = detail.type;
    error.provider = "openai";
    throw error;
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image API returned no image data.");
  return b64;
}

/* ---------------- On-demand artifact illustrations ----------------
   Artifacts may embed <img src="/api/genimage?prompt=..."> — generated on
   first load, cached in memory, and served as PNG. */

const GEN_SIZES = { square: "1024x1024", wide: "1536x1024", tall: "1024x1536" };
const genImageCache = new Map(); // "size|prompt" -> Promise<Buffer>

function genImageCached(prompt, size) {
  const key = `${size}|${prompt}`;
  let p = genImageCache.get(key);
  if (!p) {
    p = generateImage(prompt, [], size).then((b64) => Buffer.from(b64, "base64"));
    p.catch(() => genImageCache.delete(key)); // don't cache failures
    genImageCache.set(key, p);
    if (genImageCache.size > 60) genImageCache.delete(genImageCache.keys().next().value);
  }
  return p;
}

const GEN_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#241b45"/><text x="256" y="248" fill="#8f83c9" font-family="sans-serif" font-size="22" text-anchor="middle">image unavailable</text><text x="256" y="282" fill="#5d5390" font-family="sans-serif" font-size="15" text-anchor="middle">generation failed</text></svg>`;
const GEN_CREDITS_PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#171819"/><circle cx="226" cy="166" r="25" fill="#ff7ac3"/><circle cx="256" cy="166" r="25" fill="#7ae0ff"/><circle cx="286" cy="166" r="25" fill="#ffd166"/><text x="256" y="246" fill="#f5f5f5" font-family="sans-serif" font-size="23" font-weight="700" text-anchor="middle">Matthew's AI money is gone.</text><text x="256" y="285" fill="#c7c7c7" font-family="sans-serif" font-size="17" text-anchor="middle">Message him for more credits</text><text x="256" y="312" fill="#c7c7c7" font-family="sans-serif" font-size="17" text-anchor="middle">or ask him for his Zelle.</text></svg>`;

app.get("/api/genimage", async (req, res) => {
  const prompt = String(req.query.prompt || "").slice(0, 2000).trim();
  const size = GEN_SIZES[req.query.size] || GEN_SIZES.square;
  if (!prompt) return res.status(400).send("missing prompt");
  if (!process.env.OPENAI_API_KEY) return res.status(503).send("image generation unavailable");
  try {
    const buf = await genImageCached(prompt, size);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (err) {
    console.error("genimage error:", err.message);
    res.status(200); // non-2xx would render as a broken image inside artifacts
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "no-store");
    res.send(isCreditsExhausted(err) ? GEN_CREDITS_PLACEHOLDER_SVG : GEN_PLACEHOLDER_SVG);
  }
});

/* ---------------- Live HTML streaming ----------------
   Each HTML fusion is also exposed as a chunked text/html stream at
   /api/live/:id. The client points its sandboxed iframe there, and the
   browser's own streaming parser renders the page tag-by-tag as it arrives. */

const liveStreams = new Map(); // id -> {chunks: [], done: boolean, waiters: Set<res>}
const LIVE_TTL_MS = 10 * 60 * 1000;
const LIVE_HOLDBACK = 8; // keep a small tail so a trailing ``` fence never renders
const ARTIFACT_VIEWER_INSET_STYLE = `<style data-fuse-viewer-inset>html>body{border-top:76px solid transparent!important}@media(max-width:480px){html>body{border-top-width:60px!important}}</style>`;

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
        const marker = raw.match(/<!doctype html[^>]*>|<html(?:\s[^>]*)?>/i);
        if (marker) {
          started = true;
          sentLen = marker.index + marker[0].length;
          livePush(s, raw.slice(marker.index, sentLen) + ARTIFACT_VIEWER_INSET_STYLE);
        } else if (raw.length > 3000) {
          started = true; // no marker in sight — stream as-is
          livePush(s, ARTIFACT_VIEWER_INSET_STYLE);
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

  // In Auto mode the model may answer "IMAGE_PROMPT: ..." instead of HTML —
  // sniff the first characters of the stream and pivot to image generation.
  const MARKER = "IMAGE_PROMPT:";
  const genAvailable = !!process.env.OPENAI_API_KEY;
  let rawAcc = "";
  let autoMarker = null; // null = undecided, true = image pivot, false = html

  const onText = (text) => {
    send(res, { t: "delta", text });
    rawAcc += text;
    if (!imageMode && autoMarker === null) {
      const lead = rawAcc.trimStart();
      if (lead.length >= MARKER.length) autoMarker = lead.startsWith(MARKER);
      else if (!MARKER.startsWith(lead)) autoMarker = false;
      if (autoMarker === true) {
        send(res, { t: "mode", kind: "image" });
        feeder?.finish(); // close the (empty) live stream; the client flips views
        feeder = null;
      }
    }
    if (autoMarker !== true) feeder?.push(text);
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
      system: imageMode
        ? IMAGE_PROMPT_SYSTEM
        : buildHtmlSystem({
            allowIllustrations: genAvailable,
            allowImageSwitch: genAvailable && (!outputType || outputType === "auto"),
          }),
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
    } else if (autoMarker === true) {
      // The model chose an image — run the fused prompt through the generator
      const prompt = rawAcc.trimStart().slice(MARKER.length).trim();
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
    const detail = publicGenerationError(err);
    console.error("fuse error:", err);
    send(res, { t: "err", error: detail });
  } finally {
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Fuse is running → http://localhost:${PORT}`);
  console.log(`Discover storage → ${discoverStorageMode()}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "Note: ANTHROPIC_API_KEY is not set. The UI will load, but fusing will fail unless the SDK finds credentials another way (e.g. an `ant auth login` profile)."
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn("Note: OPENAI_API_KEY is not set — the Image output type will be unavailable.");
  }
});
