# Fuse backlog

## Discover and viewer polish

### DISC-01 — Match Discover skeletons to the current card shape

**Priority:** P1

**Status:** Ready

The initial gallery loader still represents the previous card design. Update it to reserve the same geometry as a rendered Discover card.

#### DISC-01 acceptance criteria

- Each loading card uses the same responsive grid width and `4 / 3` preview ratio as a rendered card.
- Preview placeholders use the current 32px corner radius.
- Skeleton title and date rows appear below the preview in the same positions as card metadata.
- Replacing skeletons with loaded cards causes no visible grid or metadata layout shift.
- The loading treatment works at desktop and mobile breakpoints.

### DISC-02 — Skeleton HTML card titles until resolved

**Priority:** P1

**Status:** Ready

**Depends on:** DISC-01

HTML cards currently show the stored fallback title before the preview content is fetched and its real title is parsed. Keep the title area in a loading state until that lookup completes.

#### DISC-02 acceptance criteria

- HTML cards show a title-sized skeleton instead of the stored generic title while preview content loads.
- The skeleton reserves the final title area so resolving the title does not move surrounding content.
- The resolved title, iframe title, and card button accessible label update together.
- Image cards continue to show their available title immediately.
- If preview loading fails, the card exits the loading state and shows its stored fallback title.
- No card can remain in an indefinite title-loading state after success or failure.

### VIEW-01 — Make the viewer title pill content-sized

**Priority:** P1

**Status:** Ready

The result viewer title pill currently flexes across all available space. Size it to its content while retaining safe truncation for long titles.

#### VIEW-01 acceptance criteria

- Short and medium titles produce a pill that hugs the visible title and metadata content.
- The action pill remains aligned to the right edge of the viewer.
- Long titles truncate to one line before colliding with the action pill.
- The title pill stays within the viewport on narrow mobile layouts.
- Loading, generated-image, and saved-artifact title states all use the same sizing behavior.

### VIEW-02 — Increase viewer pill glass blur

**Priority:** P2

**Status:** Ready

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

**Status:** Ready

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

**Status:** Ready

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

**Status:** Ready

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
