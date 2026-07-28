# Fuse — metaball ingredient mixer

A playful canvas where you drop up to **5 ingredients** — text snippets and images, in any mix — arrange them as gooey metaballs, size each one for how much **influence** it should have, add a short directive ("make this into a retro arcade game"), and fuse them with **Claude Fable 5** into a single self-contained **HTML artifact**: a report, a game, a quiz, a slide deck, a choose-your-own-adventure, or whatever fits.

The result **renders live as it streams** — the server re-exposes each fusion as a chunked `text/html` stream (`/api/live/:id`) that the sandboxed iframe loads directly, so the browser's own streaming parser paints the page tag-by-tag while the model writes it. Download any result as a standalone file or save it to the shared **Discover** gallery.

## Quick start

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # or copy .env.example and use a loader
export OPENAI_API_KEY=sk-...          # optional — enables the "Image" output type
npm start
# → http://localhost:3000
```

## How it works

- **Frontend** (`public/`): vanilla JS. Each ingredient stores an explicit influence value; its normalized percentage drives blob **area** on a wide responsive size ramp. Scroll on a blob (or use the ＋/－ toolbar) to change its influence. Dragging reshapes the composition, then a damped magnetic layout settles every blob into a connected cluster around the new release direction. At rest, the shared neck breathes with a subtle synchronized magnetic pulse while remaining continuously connected; the pulse pauses during drag and fusion and is disabled for reduced motion.
- **3D metaball stage** (`public/stage3d.js`): GPU-rendered soft goo via three.js `MarchingCubes` + `MeshPhysicalMaterial`, using broad environment-style illumination, high diffuse roughness, and restrained specular response instead of a glossy clearcoat look. Blobs stay logical 2D circles — the orthographic camera maps 1:1 to stage pixels, so the DOM overlay (labels, thumbnails, weight chips) rides exactly on top and every interaction is unchanged. The marching-cubes field cube refits to the blobs' bounding box each frame, so resolution concentrates where the goo is; during multi-blob collapse, padding expands from the combined field strength so the summed surface cannot clip against the cube. Image blobs are **textured with the photo itself**: natural source dimensions drive a centered cover crop, preserving aspect ratio while filling the full blob. Neighboring metaball fields then bend each image's texture coordinates toward the shared neck and blend sources only through that transition zone rather than broadly double-exposing them. Normal-based wrap shading restores curvature and depth without hard highlights. Until the texture loads, the ball wears a saturation-weighted dominant color sampled from the photo. Blobs idle-wobble, and on **Fuse** they physically collapse into one mass while image textures progressively blur, soften, and lose contrast; ingredient labels, weights, selection outlines, and controls disappear through the result crossfade. If WebGL is unavailable, the original SVG-filter goo (blur + contrast threshold) takes over automatically.
- **Backend** (`server.js`): a small Express server that holds the API key and exposes `POST /api/fuse`. It sends text ingredients inline and images as vision blocks to `claude-fable-5` with a weighted-blend system prompt, streams the response back as NDJSON, and includes a server-side refusal fallback to `claude-opus-4-8` (with a graceful retry if the fallback beta isn't available to your org).
- **Output contract**: the model must return exactly one self-contained HTML document — inline CSS/JS, no external requests — so it renders safely in `<iframe sandbox="allow-scripts">`.
- **Illustrated artifacts**: when `OPENAI_API_KEY` is set, Claude embeds generated images *inside* HTML artifacts via `<img src="/api/genimage?prompt=…">` (optional `&size=wide|tall`) whenever they're the best visual option — hero art, scene illustrations, portraits, slide backdrops — reserving inline SVG for icons and charts. The server generates them on first load and caches them in memory. Downloading an artifact inlines these as data URIs so the `.html` stays self-contained.
- **Auto → image routing**: in Auto mode, if the directive plainly asks for a picture ("make a poster of…"), the model answers with an `IMAGE_PROMPT:` marker instead of HTML; the server detects it mid-stream and pivots to the image pipeline (source images attached as usual).
- **Image output**: pick the **Image** chip and the fusion runs in two phases — Claude fuses the weighted ingredients into one rich image prompt (streamed live), then the server calls OpenAI's image API (`gpt-image-2` by default, configurable via `IMAGE_MODEL`) and returns the picture. When the canvas has image ingredients they're attached **directly as source images** via the edits endpoint — the generator blends the actual pixels, with Claude's fused prompt as the transformation instructions; text-only canvases use the generations endpoint.
- **Remix loop**: any finished result has a **✦ Remix as ingredient** button. A generated image returns to the canvas as an image blob; an HTML artifact returns as a ✦ artifact blob whose source (capped at 40k chars) is fed back as an ingredient on the next fuse.
- **Discover gallery**: finished HTML artifacts and images can be saved from the result viewer. `/discover` shows responsive, sandboxed previews; saved outputs can be opened, downloaded, or remixed. With Azure configured, blobs stay private and are served through the app. Without Azure, development saves persist under ignored `data/discover/`.

## Config

| Env var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Server-side API key (never shipped to the browser) |
| `PORT` | `3000` | HTTP port |
| `FUSE_MODEL` | `claude-fable-5` | Primary model |
| `OPENAI_API_KEY` | — | Enables the Image output type |
| `IMAGE_MODEL` | `gpt-image-2` | OpenAI image model |
| `AZURE_STORAGE_CONNECTION_STRING` | — | Enables shared Azure Blob persistence for Discover |
| `AZURE_STORAGE_CONTAINER` | `fuse-discover` | Private blob container used by Discover |

## Discover storage

For a shared gallery, create an Azure Storage account and add its connection string to `.env`:

```sh
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=...
AZURE_STORAGE_CONTAINER=fuse-discover
```

The server creates the container if needed. Keep it private; gallery content is proxied through `/api/discover/:id/content` and saved HTML is rendered in an opaque sandbox with a restrictive content security policy.

The current prototype API is intentionally unauthenticated. Add application authentication and moderation before exposing public saves on an internet-facing deployment.

## Ideas for later

- True marching-squares metaballs on `<canvas>` for richer goo
