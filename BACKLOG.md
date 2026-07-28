# Fuse backlog

## Canvas interaction

### CANVAS-01 — Pull ingredients into one magnetic cluster

**Priority:** P1

**Status:** Done

Replace persistent free placement with a damped magnetic layout. Users can still drag a metaball as a playful transient interaction, but after release every ingredient returns to one connected fused cluster, so distance and overlap no longer imply hidden prompt semantics.

#### CANVAS-01 acceptance criteria

- Adding, resizing, or releasing an ingredient causes all metaballs to settle into one visibly connected cluster.
- The highest-influence ingredient acts as the cluster's visual anchor while smaller ingredients settle around it; absolute left, right, top, and bottom positions carry no meaning.
- The active metaball follows the pointer directly while dragging. Magnetic forces resume only after release, without fighting the gesture.
- Release direction reshapes the cluster instead of returning ingredients to fixed compass slots; dragging the anchor reshapes the surrounding composition while remaining purely visual.
- A damped spring or magnetic equilibrium creates controlled partial overlap without runaway collapse, perpetual orbiting, jitter, or long oscillation.
- Ingredient labels, thumbnails, selection targets, and weight controls remain legible and independently operable after the cluster settles.
- The cluster remains inside responsive canvas bounds with one to five ingredients and recomputes cleanly after viewport changes.
- DOM overlays, hit targets, the Three.js surface, and the non-WebGL fallback use the same settled positions.
- Spatial clusters and `PROXIMITY` notes are removed from generation requests, system prompts, and documentation; the model receives influence but no inferred intent from temporary placement.
- Error, reset, remix, and fuse-collapse flows do not leave magnetic animation or stale velocities running.
- `prefers-reduced-motion` uses an immediate or minimally eased stable layout.

### CANVAS-02 — Expand the visual influence size ramp

**Priority:** P1

**Status:** Done

**Related:** CANVAS-01

The current percentage is calculated from arbitrary circle radii, so a lone ingredient can read `100%` while remaining at the default `70px` radius. Store influence independently, normalize it to percentages, and derive visual size from that percentage so `100%` consistently appears dominant.

#### CANVAS-02 acceptance criteria

- Each ingredient stores an explicit influence value independent of its rendered radius.
- Display percentages are normalized from influence values, and rendered area is derived from the normalized percentage rather than using radius as the source of truth.
- A lone `100%` ingredient renders at the responsive maximum size; it is substantially larger than today's default `140px` diameter on desktop without clipping on smaller canvases.
- Equal ingredients render at equal sizes and percentages: two at `50%`, three near `33%`, four at `25%`, and five at `20%`.
- The visual steps at approximately `10%`, `25%`, `50%`, `75%`, and `100%` are clearly distinguishable while low-influence ingredients remain selectable and readable.
- The area mapping remains perceptually honest, using a square-root radius relationship or an equivalent tested mapping with a responsive minimum and maximum.
- Grow, shrink, wheel, keyboard, add, remove, and remix actions update influence first, then smoothly recompute every ingredient's percentage, size, and magnetic equilibrium.
- Rebalancing never produces negative, zero-area, `NaN`, or totals other than `100%` after display rounding.
- Stage bounds, toolbar placement, label sizing, image textures, hit targets, and the Three.js field remain correct at the expanded maximum size on desktop and mobile.
- Documentation and any visible guidance describe influence as the control and area as its visual encoding.

## Discover and viewer polish

### DISC-01 — Match Discover skeletons to the current card shape

**Priority:** P1

**Status:** Done

The initial gallery loader still represents the previous card design. Update it to reserve the same geometry as a rendered Discover card.

#### DISC-01 acceptance criteria

- Each loading card uses the same responsive grid width and `4 / 3` preview ratio as a rendered card.
- Preview placeholders use the current 32px corner radius.
- Skeleton title and date rows appear below the preview in the same positions as card metadata.
- Replacing skeletons with loaded cards causes no visible grid or metadata layout shift.
- The loading treatment works at desktop and mobile breakpoints.

### DISC-02 — Skeleton HTML card titles until resolved

**Priority:** P1

**Status:** Done

**Depends on:** DISC-01

HTML cards currently show the stored fallback title before the preview content is fetched and its real title is parsed. Keep the title area in a loading state until that lookup completes.

#### DISC-02 acceptance criteria

- HTML cards show a title-sized skeleton instead of the stored generic title while preview content loads.
- The skeleton reserves the final title area so resolving the title does not move surrounding content.
- The resolved title, iframe title, and card button accessible label update together.
- Image cards continue to show their available title immediately.
- If preview loading fails, the card exits the loading state and shows its stored fallback title.
- No card can remain in an indefinite title-loading state after success or failure.

### DISC-03 — Add editorial gallery tile sizes and metadata overlays

**Priority:** P1

**Status:** Done

**Related:** DISC-01, DISC-02

Replace the uniform Discover grid with a restrained editorial rhythm using three tile sizes: the current `1×1` single, a `2×1` wide tile, and a sparse `2×2` feature tile. Move title and date metadata into the preview so the gallery reads as a cleaner visual field.

#### DISC-03 acceptance criteria

- Desktop layouts support `1×1` single, `2×1` wide, and `2×2` feature tiles on a shared grid unit; a feature tile occupies exactly two columns and two rows including grid gaps.
- Feature and wide tiles are used sparingly among predominantly single tiles, with a deterministic cadence that preserves DOM order and does not leave accidental holes.
- Tile assignment remains stable during preview-title resolution and lazy loading; resolving content does not change a card's size or move neighboring cards.
- Breakpoints simplify the pattern intentionally: constrained layouts remove unsupported spans, and mobile presents a coherent single-column gallery without clipping or horizontal overflow.
- Each preview fills its tile without distortion. Images use an intentional crop, while HTML previews receive the actual tile viewport and remain non-interactive until opened.
- Title and date move into a bottom-aligned overlay within the preview and do not reserve space below the card.
- On fine-pointer devices, metadata is visually hidden at rest and revealed on card hover or keyboard focus without shifting layout.
- On touch and other non-hover devices, essential metadata remains visible without requiring a first tap that interferes with opening the artifact.
- Card titles remain available to assistive technology and in the open button's accessible name regardless of the overlay's visual state.
- The overlay maintains readable contrast over light, dark, and visually busy previews without obscuring more of the artifact than necessary.
- Reveal motion is subtle and disabled under `prefers-reduced-motion`.
- `DISC-01` skeletons reproduce the same tile cadence and overlay footprint so loading and loaded gallery compositions match.

### VIEW-01 — Make the viewer title pill content-sized

**Priority:** P1

**Status:** Done

The result viewer title pill currently flexes across all available space. Size it to its content while retaining safe truncation for long titles.

#### VIEW-01 acceptance criteria

- Short and medium titles produce a pill that hugs the visible title and metadata content.
- The action pill remains aligned to the right edge of the viewer.
- Long titles truncate to one line before colliding with the action pill.
- The title pill stays within the viewport on narrow mobile layouts.
- Loading, generated-image, and saved-artifact title states all use the same sizing behavior.

### VIEW-02 — Increase viewer pill glass blur

**Priority:** P2

**Status:** Done

Strengthen the frosted-glass treatment on the viewer title and action pills so artifact content behind them is more diffused while controls remain legible.

#### VIEW-02 acceptance criteria

- Both viewer pills share the same stronger blur, translucency, border, and shadow treatment.
- Busy light, dark, and high-contrast artifact backgrounds are visibly diffused behind the pills.
- Text and icons retain sufficient contrast over those backgrounds.
- The CSS keeps the existing WebKit-prefixed backdrop-filter fallback.
- The treatment does not introduce clipping, overlap, or a meaningful interaction regression on desktop or mobile.

## Sharing

### SHARE-01 — Fix unreadable production share images

**Priority:** P1

**Status:** Implemented; production verification pending

Social metadata and the `1200×630` PNG endpoint are healthy, but Azure cannot find any of the renderer's expected system fonts. Production therefore emits the bar-only fallback graphic, which appears as a broken or meaningless thumbnail in Microsoft Teams.

**Reproduction:** Share `/discover/c37aace0-3fe4-45a9-ab6d-2f8fb8cc7417` in Teams. The title is “Sniffin' KITSUNE,” but its social image contains placeholder bars instead of readable text.

#### SHARE-01 acceptance criteria

- Share-card rendering does not depend on fonts being preinstalled by the App Service host; required font assets are portable and available in local and Azure environments.
- The production PNG visibly renders the artifact title, Fuse branding, artifact kind, and call to action instead of placeholder bars.
- Font initialization failure is observable and never silently produces a bar-only social image.
- Long titles, punctuation, apostrophes, and supported Unicode characters render without clipping or replacement artifacts.
- Essential branding and title content remain legible in both the full `1.91:1` card and compact previews that crop or reduce the image.
- Open Graph and Twitter metadata continue to reference an absolute HTTPS image URL returning `200`, `image/png`, and `1200×630` dimensions.
- The image URL or cache policy is versioned so Teams and other crawlers do not retain the known-bad PNG after the renderer is fixed.
- The repaired preview is verified in Microsoft Teams and at least one independent Open Graph debugger or crawler.

## Generation experience

### GEN-01 — Show an image-generation shimmer while GPT paints

**Priority:** P1

**Status:** Done

The viewer currently remains on the streamed prompt after image generation begins, leaving the image surface empty until GPT returns the finished asset. Replace that gap with a clear loading treatment in the image canvas.

#### GEN-01 acceptance criteria

- When the generation stream enters the `paint` phase, the viewer switches from the prompt output to a visible image-sized loading surface.
- The loading surface uses a restrained shimmer or equivalent progress treatment and retains the existing “Painting…” status and model details.
- The placeholder occupies stable responsive bounds so the completed image does not cause a jarring layout shift.
- The loading state remains visible until the returned image has decoded and is ready to display, then transitions cleanly to the image.
- Image-generation errors clear the loading state and expose the existing error message and recovery path.
- A non-animated fallback is provided for `prefers-reduced-motion`.
- The loading surface communicates its busy state to assistive technology without repeatedly announcing visual animation.
- HTML generation and previously saved Discover images are unaffected.

### GEN-02 — Carry the fused metaball through first artifact paint

**Priority:** P1

**Status:** Done

**Related:** GEN-01

Ingredients already collapse into one gently moving metaball when fusion starts, but a fixed `1.15s` timer replaces it with the result panel whether or not streamed HTML has painted. Keep the fused mass as the branded loading state until the artifact has meaningful visual content to reveal.

#### GEN-02 acceptance criteria

- Fusing collapses the ingredient metaballs into one mass and keeps that mass visible and alive while the result initializes.
- Result status and cancel/close chrome can appear during the wait without covering the metaball with a blank code, white, or black surface.
- The handoff is driven by an explicit first-meaningful-paint signal from the sandboxed streamed document, not the current fixed timer and not the stream-complete `iframe.load` event.
- “Meaningful paint” requires visible artifact content; receiving the live-stream URL or an empty document shell does not end the loader.
- The artifact crossfades or reveals cleanly over the metaball without a background-color flash, layout jump, or moment where both experiences compete visually.
- A bounded timeout exits the metaball state if a document never reports first paint, and request errors expose the existing error UI.
- Closing the result or starting a new fusion cancels pending first-paint listeners and timers.
- Auto mode hands image-bound generations from the metaball state into the `GEN-01` painting shimmer without an intermediate blank state.
- WebGL-unavailable and `prefers-reduced-motion` users receive a stable, non-animated fallback with the same lifecycle.
- The transition is verified on desktop and mobile without creating a second render loop or retaining the Stage3D loading state after handoff.
