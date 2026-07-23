import express from "express";
import Anthropic, { BadRequestError } from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.FUSE_MODEL || "claude-fable-5";
const FALLBACK_MODEL = "claude-opus-4-8";
const FALLBACK_BETA = "server-side-fallback-2026-06-01";
const MAX_ITEMS = 5;

const client = new Anthropic();
const app = express();

app.use(express.json({ limit: "40mb" }));
app.use(express.static("public"));

const SYSTEM_PROMPT = `You are Fuse, a creative engine that blends "ingredients" into a single interactive HTML artifact.

You receive up to five ingredients — short text snippets and/or images — each with an influence weight (a percentage), plus a directive describing what to make (a report, a game, a quiz, a slide deck, a choose-your-own-adventure, or anything else).

How to blend:
- Treat the weights as how strongly each ingredient should shape the result. A dominant ingredient (45%+) sets the theme, subject, or mechanic. Supporting ingredients (20-44%) shape major sections or features. Accent ingredients (<20%) appear as flavor, easter eggs, or styling touches.
- Every ingredient must be recognizably present in the output. Nothing gets dropped.
- For image ingredients, blend what the image depicts — its subject, mood, palette, and style — into the artifact. Echo the image's color palette in your design.

Output contract (strict):
- Respond with exactly one complete, self-contained HTML document and nothing else. Start with <!doctype html>. No markdown fences, no commentary before or after.
- Inline all CSS and JavaScript. Zero external requests: no CDNs, no external fonts, no remote images. If you need graphics, draw them with inline SVG, CSS, or canvas.
- The page must work when loaded in a sandboxed iframe (scripts allowed, no network).
- Make it delightful: polished layout, a cohesive palette drawn from the ingredients, satisfying micro-interactions. For games/quizzes/adventures, the interactivity must genuinely work (state, scoring, branching). For slide decks, include keyboard and button navigation. For reports, invent plausible, clearly-illustrative content grounded in the ingredients.
- Keep it responsive and usable on both desktop and mobile widths.`;

function weightLabel(pct) {
  if (pct >= 45) return "dominant";
  if (pct >= 20) return "supporting";
  return "accent";
}

function buildUserContent(items, directive, outputType) {
  const content = [];
  const lines = [];
  lines.push(`Here are the ${items.length} ingredient(s) on the canvas:`);

  items.forEach((item, i) => {
    const n = i + 1;
    const pct = Math.round(item.weightPct);
    const label = weightLabel(pct);
    if (item.kind === "image") {
      lines.push(`INGREDIENT ${n} — image, ${pct}% influence (${label}): see attached image ${n}${item.name ? ` ("${item.name}")` : ""}.`);
    } else {
      lines.push(`INGREDIENT ${n} — text, ${pct}% influence (${label}): «${item.text}»`);
    }
  });

  lines.push("");
  const typeNote =
    outputType && outputType !== "auto"
      ? `The artifact must be a ${outputType}.`
      : "Choose the artifact format that best fits the directive and ingredients.";
  lines.push(`DIRECTIVE: ${directive || "Fuse these ingredients into something delightful."}`);
  lines.push(typeNote);
  lines.push("Remember the output contract: one self-contained HTML document, nothing else.");

  content.push({ type: "text", text: lines.join("\n") });

  items.forEach((item, i) => {
    if (item.kind === "image") {
      content.push({ type: "text", text: `Attached image ${i + 1}:` });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: item.mediaType,
          data: item.imageBase64,
        },
      });
    }
  });

  return content;
}

function send(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
}

app.post("/api/fuse", async (req, res) => {
  const { items, directive, outputType } = req.body || {};

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
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  const messages = [{ role: "user", content: buildUserContent(items, directive, outputType) }];
  const base = {
    model: MODEL,
    max_tokens: 64000,
    system: SYSTEM_PROMPT,
    messages,
  };

  let emittedText = false;
  const onText = (text) => {
    emittedText = true;
    send(res, { t: "delta", text });
  };

  try {
    let finalMessage;
    try {
      // Preferred path: Fable 5 with a server-side refusal fallback to Opus 4.8,
      // so a rare safety-classifier decline is re-served instead of erroring.
      const stream = client.beta.messages.stream({
        ...base,
        betas: [FALLBACK_BETA],
        fallbacks: [{ model: FALLBACK_MODEL }],
      });
      stream.on("text", onText);
      finalMessage = await stream.finalMessage();
    } catch (err) {
      // If the org/platform doesn't support the fallback beta, retry plain —
      // but only if nothing was streamed yet (otherwise we'd duplicate text).
      if (!emittedText && err instanceof BadRequestError && /fallback/i.test(String(err.message))) {
        const stream = client.messages.stream(base);
        stream.on("text", onText);
        finalMessage = await stream.finalMessage();
      } else {
        throw err;
      }
    }

    if (finalMessage.stop_reason === "refusal") {
      const category = finalMessage.stop_details?.category;
      send(res, {
        t: "err",
        error: `The model declined this request${category ? ` (${category})` : ""}. Try different ingredients or a different directive.`,
      });
    } else {
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
});
