# Fuse — metaball ingredient mixer

A playful canvas where you drop up to **5 ingredients** — text snippets and images, in any mix — arrange them as gooey metaballs, size each one for how much **influence** it should have, add a short directive ("make this into a retro arcade game"), and fuse them with **Claude Fable 5** into a single self-contained **HTML artifact**: a report, a game, a quiz, a slide deck, a choose-your-own-adventure, or whatever fits.

The result streams in live and renders in a sandboxed iframe. Download it as a standalone `.html` file.

## Quick start

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or copy .env.example and use a loader
npm start
# → http://localhost:3000
```

## How it works

- **Frontend** (`public/`): vanilla JS. The goo effect is an SVG filter (blur + contrast threshold) over a layer of colored circles; labels and image thumbnails sit in an unfiltered layer above. Blob **area** maps to an influence percentage, shown live under each blob. Scroll on a blob (or use the ＋/－ toolbar) to change its weight; drag to arrange; drop image files anywhere.
- **Backend** (`server.js`): a small Express server that holds the API key and exposes `POST /api/fuse`. It sends text ingredients inline and images as vision blocks to `claude-fable-5` with a weighted-blend system prompt, streams the response back as NDJSON, and includes a server-side refusal fallback to `claude-opus-4-8` (with a graceful retry if the fallback beta isn't available to your org).
- **Output contract**: the model must return exactly one self-contained HTML document — inline CSS/JS, no external requests — so it renders safely in `<iframe sandbox="allow-scripts">`.

## Config

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Server-side API key (never shipped to the browser) |
| `PORT` | `3000` | HTTP port |
| `FUSE_MODEL` | `claude-fable-5` | Primary model |

## Ideas for later

- Proximity semantics: touching blobs = "fuse tightly", distant blob = "garnish"
- Feed a fused artifact back onto the canvas as a remixable ingredient
- True marching-squares metaballs on `<canvas>` for richer goo
- Optional image-generation backend for raster outputs
