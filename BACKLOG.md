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

**Status:** Done

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

## Input expansion

### INPUT-00 — Define a universal ingredient capsule

**Priority:** P0

**Status:** Ready

Normalize every new source into one model-facing contract instead of adding provider-specific branches throughout the client and prompt builder.

#### INPUT-00 acceptance criteria

- Every source adapter produces a capsule with `title`, `sourceType`, `role`, `summary`, `content`, `assets`, `provenance`, `freshness`, `permissions`, and `tokenEstimate`.
- Capsules preserve useful structure rather than flattening everything into prose; headings, records, files, decisions, and components remain addressable.
- The canvas renders all capsules through a shared ingredient UI with a source icon, label, influence, role, loading state, and inspection affordance.
- The server composes model content from capsules through one budgeted path while retaining native image blocks for visual assets.
- Per-source token and asset limits are explicit, deterministic, and visible before fusion.
- Extraction failures remain local to the affected ingredient and never block editing or removing other ingredients.

### INPUT-01 — Add ingredient roles alongside influence

**Priority:** P0

**Status:** Done

Influence answers “how much?” Roles answer “in what way?” Support `Content`, `Style`, `Behavior`, `Evidence`, and `Constraint` without turning the canvas into prompt configuration.

#### INPUT-01 acceptance criteria

- Every ingredient has one optional role with a useful source-specific default.
- Role is editable from a compact menu and remains visible without competing with the influence percentage.
- The orchestration prompt explains role and influence independently and resolves conflicts predictably: constraints cannot be diluted by low influence, while style cannot override factual evidence.
- Auto-role suggestions are inspectable and never silently change after the user edits them.
- Role semantics are tested across text, image, artifact, and every new capsule source.

### INPUT-02 — Build the connected-source permission boundary

**Priority:** P0

**Status:** Ready

Connected sources introduce authorization, freshness, and data-boundary concerns that local uploads do not. Establish the shared trust layer before shipping Graph, GitHub, Figma, or live APIs.

#### INPUT-02 acceptance criteria

- Users explicitly authorize each connector and can see which identity, tenant, organization, repository, or workspace is active.
- Fuse requests the minimum scopes required and never persists raw credentials in the browser or Discover artifacts.
- Every capsule shows source provenance, retrieval time, and whether it is a snapshot or live reference.
- Revoked or expired access degrades to a clear reconnect state without leaking previously inaccessible content.
- Server logs, analytics, social cards, and generated artifacts never expose secrets or private source URLs.
- Enterprise sources honor tenant boundaries, retention, audit, and sensitivity labels.

### INPUT-03 — Ingest PDFs and Office documents

**Priority:** P1

**Status:** Ready

Treat documents as structured evidence, content, or constraints rather than attaching an opaque file blob.

#### INPUT-03 acceptance criteria

- Support PDF, Word, and plain-text uploads with headings, paragraphs, tables, page references, and document metadata preserved.
- Scanned PDFs use OCR and clearly identify OCR-derived text and confidence.
- Users preview the extracted outline and choose the full document or selected sections before adding it to the canvas.
- Citations in generated artifacts retain source title and page or section references.
- Password-protected, malformed, or oversized files fail with specific recovery guidance.

### INPUT-04 — Ingest websites and URLs

**Priority:** P1

**Status:** Ready

Turn a URL into a bounded page snapshot containing meaningful content, structure, visual references, and provenance.

#### INPUT-04 acceptance criteria

- Fetch through a server-side reader with SSRF protection, redirect limits, MIME validation, and private-network blocking.
- Extract title, canonical URL, headings, primary content, metadata, and selected representative images without importing ads or navigation noise.
- Show a snapshot preview and retrieval timestamp before the page becomes an ingredient.
- Let users choose whether the page contributes content, visual style, evidence, or comparison context.
- Dynamic, authenticated, blocked, and paywalled pages return clear states rather than partial silent extraction.

### INPUT-05A — Ingest a public GitHub repository in Labs

**Priority:** P1

**Status:** Done

**Product position:** Experimental / Labs

Represent a public repository as a structured system capsule, not a concatenated code dump. This first slice requires no user authentication and tests whether repository structure adds value beyond pasting a README or uploading an archive.

#### INPUT-05A acceptance criteria

- Add a GitHub option under a clearly labeled Labs / Experimental section of the ingredient menu that accepts only canonical public `https://github.com/{owner}/{repo}` URLs in the MVP.
- A server-side inspect endpoint validates the host and repository path, resolves the default branch and immutable commit SHA, and retrieves public metadata without cloning or executing repository code.
- Use GitHub's public repository, tree, contents, languages, and commit APIs with strict request, redirect, response-size, and timeout limits; never fetch arbitrary repository-supplied URLs.
- Extract repository metadata, README and docs, language and dependency manifests, top-level architecture, selected source files, and UI assets. Issues and pull requests remain out of scope for the first slice.
- Skip binaries, vendored dependencies, lockfile bodies, generated/build folders, large files, symlinks, submodules, and likely secrets by default.
- Deterministic relevance ranking proposes a bounded file set and token estimate. Users inspect the tree, pin or exclude files, and see omission reasons before adding the repo.
- The resulting capsule is pinned to the resolved commit SHA and preserves owner, repository, branch, file path, blob SHA, license, and retrieval time as provenance.
- Default role is `Behavior`; users can choose `Understand`, `Use as behavior`, `Use as visual system`, or `Propose changes` before fusion.
- Unauthenticated GitHub rate limits are cached and surfaced clearly. An optional server-only token may raise public API limits but never changes the user's repository permissions.
- Private, missing, renamed, archived, empty, oversized, or API-truncated repositories return explicit states and recovery guidance.
- The MVP is tested against small, monorepo, documentation-heavy, frontend, binary-heavy, and intentionally adversarial public repositories.

### INPUT-05B — Connect private GitHub repositories

**Priority:** P2

**Status:** Ready

**Depends on:** INPUT-02, INPUT-05A

Extend the proven public-repository capsule through a repository-scoped GitHub App rather than broad OAuth scopes or user-provided personal access tokens.

#### INPUT-05B acceptance criteria

- Use a GitHub App with `Metadata: read` and `Contents: read`; issues and pull requests require separately approved optional permissions.
- Users install or select the app only for repositories they intend to expose, and the repository picker is limited to approved installations.
- Installation tokens are generated server-side, never sent to the browser, and refreshed before their approximately one-hour expiry.
- Store installation and immutable repository IDs alongside owner/name so renamed or transferred repositories remain identifiable.
- Handle organization approval, SAML SSO, enterprise policy, suspended installations, revoked access, and permission drift with explicit reconnect states.
- Recheck repository access before refreshing or reusing a capsule; revoked private content cannot be silently retained as a live source.
- Support GitHub Enterprise Server only through explicit host allowlisting, configurable API origins, trusted certificates, and separate app registration.
- Private repository URLs, file contents, tokens, and installation metadata never appear in logs, social metadata, Discover cards, or generated artifacts unless explicitly included by the user.

### INPUT-06 — Ingest Figma files and design systems

**Priority:** P1

**Status:** Ready

Extract design intent as tokens, components, layout, copy, and selected rendered frames rather than treating Figma as one screenshot.

#### INPUT-06 acceptance criteria

- Connect to a Figma file and let users select pages, frames, components, or variables before import.
- Capture component hierarchy, text, auto-layout, dimensions, variables, styles, and rendered previews with node provenance.
- Distinguish `Style` use from `Content` or `Behavior` use so a visual reference does not silently copy its copy or interaction model.
- Large files summarize the design system first and include only selected frames within budget.
- Private-file permissions, missing fonts, unsupported nodes, and detached instances surface clearly.

### INPUT-07 — Ingest spreadsheets and structured data

**Priority:** P1

**Status:** Ready

Treat tables as typed records and measures so Fuse can create grounded reports, comparisons, calculators, and interactive visualizations.

#### INPUT-07 acceptance criteria

- Support CSV and Excel uploads with sheet selection, headers, types, formulas, ranges, and basic formatting preserved.
- Profile row count, nulls, distributions, dates, units, and likely dimensions or measures before fusion.
- Users choose a table or range and see a representative sample rather than sending an entire workbook blindly.
- Generated artifacts remain grounded in supplied values and label any inferred or illustrative data explicitly.
- Large datasets use deterministic aggregation or server-side queries instead of exceeding model context.

### INPUT-08 — Ingest meetings, audio, and video

**Priority:** P2

**Status:** Ready

Convert temporal media into a capsule of transcript, speakers, decisions, moments, and selected visual frames.

#### INPUT-08 acceptance criteria

- Accept meeting recordings and common audio/video uploads with transcription, speaker labels, chapters, and timestamps.
- Extract decisions, action items, open questions, quotes, and key frames as distinct structured fields.
- Users preview and trim time ranges before adding the source to the canvas.
- Generated artifacts can deep-link citations to timestamps where the source system supports it.
- Consent, recording policy, biometric/speaker identification, and retention boundaries are explicit.

### INPUT-09 — Ingest email and Teams threads

**Priority:** P2

**Status:** Ready

Preserve chronology, participants, decisions, and attachments while removing repetitive signatures and quoted-thread noise.

#### INPUT-09 acceptance criteria

- Users select a thread or bounded message range through Microsoft Graph rather than granting undirected mailbox access.
- Extraction preserves sender, timestamp, recipients, reply structure, attachments, decisions, requests, and unresolved questions.
- The preview distinguishes original messages from quoted content and identifies omitted sensitive or unsupported attachments.
- Generated outputs cite individual messages without exposing addresses or private links unnecessarily.
- Sensitivity labels, tenant policy, and revoked access remain enforceable after capsule creation.

### INPUT-10 — Ingest presentations

**Priority:** P2

**Status:** Ready

Treat decks as both narrative structure and visual material, with slide-level selection and speaker-note context.

#### INPUT-10 acceptance criteria

- Support PowerPoint and PDF decks with slide order, titles, text, notes, charts, images, and rendered slide previews preserved.
- Users select slides and choose whether the deck contributes story structure, content, or visual style.
- Fuse can revise, compare, summarize, or extend a narrative without flattening the deck into one text transcript.
- Generated artifacts retain slide-level provenance for claims and reused visuals.
- Hidden slides, master layouts, and confidential notes are visibly included or excluded.

### INPUT-11 — Connect live APIs and queryable data

**Priority:** P2

**Status:** Ready

Let a capsule reference live state safely when a static snapshot would become stale, while keeping generated artifacts deterministic and auditable.

#### INPUT-11 acceptance criteria

- Configure approved read-only endpoints through a server connector with allowlisted hosts, methods, schemas, and secret storage.
- Preview sample responses, inferred schema, freshness, and expected request cost before adding the source.
- Users choose snapshot-at-fusion or live-at-view behavior explicitly.
- Live artifacts include loading, empty, error, and stale states and never expose connector credentials client-side.
- Responses are size-limited, cached, rate-limited, and logged with source provenance.

### INPUT-12 — Build Work IQ context bundles

**Priority:** P2

**Status:** Ready

Create a bounded project ingredient from related Microsoft 365 context rather than making users add every file, meeting, and thread separately.

#### INPUT-12 acceptance criteria

- Users start from a project, meeting, person, or date range and review the proposed files, messages, meetings, and decisions.
- The bundle explains why each item was included and supports removal before becoming one capsule.
- Retrieval uses Work IQ and Graph signals without allowing hidden context to influence outputs silently.
- Freshness and permissions are reevaluated when a bundle is reused.
- The model receives a structured timeline and relationship map, not an undifferentiated content dump.

### INPUT-13 — Add audience and persona ingredients

**Priority:** P2

**Status:** Ready

Represent the intended reader or user as an explicit constraint capsule covering needs, vocabulary, accessibility, and decision context.

#### INPUT-13 acceptance criteria

- Users can define an audience manually or derive one from an authorized profile or research source.
- Audience capsules separate observed evidence from inferred traits and never invent sensitive attributes.
- The capsule can constrain reading level, terminology, accessibility, tone, information density, and calls to action.
- Role defaults to `Constraint`; influence controls emphasis but cannot weaken required accessibility needs.
- Generated artifacts show which audience assumptions shaped the result and allow them to be edited or removed.

### INPUT-14 — Evaluate combination quality across sources

**Priority:** P1

**Status:** Ready

Prove that structured capsules and roles improve synthesis before expanding connector breadth.

#### INPUT-14 acceptance criteria

- Build a benchmark of representative combinations: repo + Figma + brief, meeting + deck + spreadsheet, feedback + telemetry + roadmap, and policy + UI + region.
- Compare capsule-based fusion against attachments plus a plain prompt for completeness, grounding, controllability, and output usefulness.
- Measure ingredient omission, citation accuracy, role obedience, latency, token cost, and user correction effort.
- Include adversarial cases with conflicting evidence, stale sources, inaccessible content, and prompt injection inside connected sources.
- Connector rollout pauses if structured ingestion does not outperform the simpler baseline.

### Input delivery sequence

1. **Foundation:** `INPUT-00`, `INPUT-01`, and `INPUT-02` establish the capsule contract, role grammar, and permission boundary.
2. **Local structured inputs:** `INPUT-03`, `INPUT-07`, and `INPUT-10` prove document, data, and narrative extraction without connector complexity.
3. **Referenced systems:** `INPUT-04`, `INPUT-05A`, and `INPUT-06` add web, public code, and design sources through the shared capsule path.
4. **Quality gate:** Run `INPUT-14` once at least one document, one structured-data, and one system source are functional. Do not expand connector breadth until the capsule approach beats plain attachments.
5. **Temporal and human context:** `INPUT-08` and `INPUT-13` add time-based media and explicit audience constraints.
6. **Connected enterprise context:** `INPUT-05B`, `INPUT-09`, `INPUT-11`, and `INPUT-12` follow only after permission, provenance, retention, and prompt-injection controls are verified.
