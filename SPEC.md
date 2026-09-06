# wippa-build — Product & Technical Specification

**Version:** 0.1 (draft)
**Date:** 2026-09-06
**Owner:** Joel

---

## 1. Overview

**wippa-build** is a browser-based application that converts a single 2D image into a 3D asset. The user uploads an image, generates depth two ways (AI depth estimation or manual heightmap/relief), previews the resulting mesh live in 3D, tunes parameters, and exports game-ready files.

**Primary audience:** game developers and technical artists who need meshes + PBR texture maps for Unity, Unreal, Godot, and web engines.

**Core value proposition:**
1. Zero-install, runs in the browser (no GPU farm, no account required for v1).
2. Privacy-first: image processing and inference happen client-side.
3. Produces *engine-ready* output — glTF/GLB with generated PBR maps, not just raw geometry.

**One-liner:** *Drop an image in, get a 3D asset out.*

---

## 2. Scope

### 2.1 In scope (v1)
- Single-image upload (PNG, JPEG, WebP) up to 4096×4096.
- Two depth-generation modes:
  - **AI mode** — monocular depth estimation (Depth Anything V2 via transformers.js / ONNX, WebGPU with WASM fallback).
  - **Relief mode** — luminance → heightmap displacement (logos, tiles, decos, lithophane-style plates).
- Live 3D preview (react-three-fiber): orbit/zoom/pan, lighting presets, material preview modes.
- Parameter controls: depth strength, smoothing, resolution, base/plate options, tiling.
- PBR map generation: normal, ambient occlusion, roughness (derived from depth/height).
- Export: GLB (primary), glTF (separate files), OBJ+MTL, STL, and PNG texture maps.
- Project save/load (`.wippa` JSON + settings, stored in IndexedDB; export/import as file).

### 2.2 Out of scope (v1) — see §11 Roadmap
- Multi-image photogrammetry / image-set reconstruction.
- Texture synthesis from reference photos (inpainting unseen surfaces).
- Skeletal/rigged assets, LOD generation beyond resolution scaling.
- User accounts, cloud storage, payments.
- Native desktop or mobile apps.

---

## 3. User flows

### 3.1 Happy path
1. Land on the workspace → empty state with drag-and-drop zone.
2. Drop image → it loads into preview panel + settings panel appears.
3. Choose mode: **AI Depth** or **Relief** (default: AI Depth for photos, Relief for flat graphics — auto-suggested, user-overridable).
4. Inference/generation runs with progress indicator → mesh appears in viewport.
5. User tweaks sliders (depth scale, smoothing, resolution, etc.) → preview updates (debounced, incremental recompute).
6. User optionally generates PBR maps (toggle per map).
7. User hits **Export** → dialog with format, scale, axis convention, texture packing options → downloads file(s).
8. Optionally **Save project** → stored locally, reloadable.

### 3.2 Error paths
- Unsupported file type / corrupt image → inline toast, no crash.
- Image too large → offer auto-downscale to 4096 max dimension (with notice).
- WebGPU unavailable → silent fallback to WASM with banner noting slower inference; WASM unavailable → AI mode disabled, Relief mode still fully functional.
- Out-of-memory during mesh gen → auto-retry at half resolution with user notice.

---

## 4. Functional requirements

### 4.1 Image input
| Requirement | Detail |
|---|---|
| Formats | PNG, JPEG, WebP (decode via `createImageBitmap`); HEIC = graceful "convert first" message |
| Max size | 4096×4096 input; larger auto-downscaled with notice |
| Preprocess | Resize to selected working resolution (256–2048), optional alpha→white/black fill, grayscale conversion for Relief mode |
| Alpha handling | Transparent regions: choice of "keep as hole/cutout" or "fill color" |

### 4.2 Depth generation — AI mode
- Model: **Depth Anything V2 (Small)** — Apache-2.0 licensed — via `@huggingface/transformers` (ONNX Runtime Web backend).
- Execution: WebGPU when available; falls back to WASM (SIMD + threads).
- Input: image resized to model input (518×518 letterbox); output: relative depth map (0–1 float).
- Depth map is upsampled to working resolution and stored as Float32 texture.
- Requirement: inference completes < 5 s on WebGPU-class hardware, < 30 s WASM; model cached in browser after first load (~50 MB quantized).
- Model must be bundled/served same-origin or via CDN with integrity pinning.

### 4.3 Depth generation — Relief mode
- Heightmap = configurable combination of: luminance (L\* or luma), inverted luminance, alpha channel.
- Gamma/contrast controls on the heightmap before displacement.
- Deterministic and instant (< 1 s at 2048²).

### 4.4 Mesh generation
- **Displaced plane (default):** grid of N×N vertices (res selectable 64–2048), Z displacement = depth × strength, vertex normals recomputed after displacement.
- **Solid/plate mode (Relief):** displaced top + flat base + side walls (watertight, print/manifold-safe) — base thickness configurable.
- **Cutout mode:** alpha/luminance threshold → silhouette extrusion with bevel (later milestone, see roadmap).
- Smoothing: separable Gaussian on heightmap (radius 0–32) before displacement; optional Laplacian mesh smoothing after.
- Resolution fallback chain for memory safety: 2048 → 1024 → 512.

### 4.5 PBR map generation (game-asset focus)
| Map | Source | Notes |
|---|---|---|
| Normal | Sobel/sobel-of-smoothed-height, configurable strength | 8-bit RGB, non-signed, Unity/UE toggle for Y orientation |
| AO | Local depth-difference occlusion estimate (screen-space style kernel) | 8-bit grayscale |
| Roughness | Constant value or luminance-derived (user choice) | 8-bit grayscale |
| Height | The raw heightmap itself | 8-bit grayscale, for engines that do their own tessellation |
| Packing | Optional: ORMO (Occlusion/Roughness/Metallic-const/—) or UE-style packing | Export-time option |

### 4.6 3D preview (viewport)
- react-three-fiber + drei: OrbitControls, grid, environment lighting presets (studio / sunset / neutral), background toggle.
- Preview material modes: **Shaded**, **Textured** (original image as albedo), **PBR maps applied**, **Normals**, **Wireframe**, **Depth map flat view**.
- Polycount + bounding-box readout always visible (triangles, dimensions in units where 1 unit = user-defined, e.g. meters).
- Performance: preview mesh decimated above 500k tris (viewport-only decimation; export uses full res).

### 4.7 Parameter set (v1)
```
mode: 'ai' | 'relief'
resolution: 64 | 128 | 256 | 512 | 1024 | 2048
depthScale: 0–2 (world units)
smoothing: 0–32 (px radius)
relief: { source: 'luma'|'invLuma'|'alpha', gamma, contrast }
ai: { model: 'depth-anything-v2-small', invert: bool }
mesh: { style: 'plane'|'plate', baseThickness, skirt }
maps: { normal: {enabled, strength, flipY}, ao: {enabled, intensity},
        roughness: {mode:'constant'|'fromLuma', value}, height: {enabled} }
units: { scale, unit: 'm'|'cm'|'mm'|'unitless' }
axisConvention: 'gltf (+Y up)' | 'unity (-Z forward)' | 'unreal (Z up, cm)' — affects export only
tiling: { enabled, tilesX, tilesY }  // stamps the relief plane into a tiled sheet
```

### 4.8 Export
| Format | Contents | Notes |
|---|---|---|
| **GLB** | mesh + embedded albedo/PBR maps | Primary format; Draco optional (later) |
| glTF | mesh + external textures + JSON | For pipelines wanting loose files |
| OBJ + MTL | mesh + materials + textures | Max compat |
| STL | mesh only (binary) | For printing users |
| PNG maps | normal / AO / roughness / height | Exports alongside mesh or standalone |

- Export runs in a Worker; UI stays responsive; progress bar on large exports.
- All exports must pass validation against the target engine's import conventions per selected axis convention preset.

### 4.9 Project persistence
- Autosave settings + depth cache to IndexedDB (keyed by image hash).
- Export/import `.wippa` project file (JSON: settings; embedded image + depth cache optional/base64 or referenced paths).
- "New / Open / Recent projects" in header.

---

## 5. Non-functional requirements

| Category | Requirement |
|---|---|
| **Performance** | Relief mesh gen < 1 s @ 1024²; AI inference < 5 s (WebGPU) / < 30 s (WASM); export < 5 s for ≤ 1 M tris |
| **Memory** | Must not exceed ~2 GB tab limit at 2048 working res; graceful downscale chain otherwise |
| **Compatibility** | Chrome/Edge/Firefox/Safari current − 1. WebGPU where available; WASM+SIMD+threads baseline for AI mode |
| **Privacy** | 100% client-side in v1. No image ever leaves the device. Documented in UI ("Your images never leave this device") |
| **Accessibility** | WCAG 2.1 AA: keyboard-accessible panels, focus states, prefers-reduced-motion respected, contrast-checked theme |
| **Licensing** | All model weights Apache-2.0 (Depth Anything V2); libraries MIT/Apache-compatible; no GPL runtime deps |
| **Offline** | After first load (model cached), app is fully functional offline (PWA install optional, v1.1) |

---

## 6. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **React 19 + TypeScript + Vite** | Fast DX, ecosystem fit |
| 3D | **three.js via @react-three/fiber + drei** | De-facto web 3D standard |
| ML inference | **@huggingface/transformers (ONNX Runtime Web)** — WebGPU → WASM | Client-side, no server cost |
| Depth model | **Depth Anything V2 Small (ONNX, quantized)** | Apache-2.0, strong quality/size tradeoff |
| Image ops | **OffscreenCanvas + Web Workers**; sharp-free (no Node deps) | Keep everything in-browser |
| Mesh generation | **Custom typed-array generator** (PlaneGeometry displacement + plate builder) in Worker | Full control, no dependency risk |
| State | **Zustand** | Lightweight, works well with r3f |
| Styling | **Tailwind CSS v4** | Speed |
| Export | **GLTFExporter (three), custom OBJ/STL writers in Worker** | three ships GLTF/OBJ; STL writer is trivial to own |
| Persistence | **IndexedDB via idb** | Async, structured storage |
| Testing | **Vitest** (unit) + **Playwright** (e2e) + golden-file tests for exporters | Deterministic output checks |
| Lint/format | **ESLint + Prettier** | Standard |

### 6.1 Why no backend?
v1 is a fully static site. A thin optional backend (Node + GPU) is a planned v2 addition for "high-quality mode" (larger depth models like Depth Pro / Marigold) — the architecture keeps a `DepthProvider` interface so a server provider drops in without UI changes (see §8).

---

## 7. Architecture

```
┌────────────────────────────── Browser ──────────────────────────────┐
│                                                                     │
│  UI Layer (React)                                                   │
│  ├── Workspace (viewport + panels)                                  │
│  ├── SettingsPanel      ImportPanel      ExportDialog               │
│  └── Zustand store  ← single source of truth for params/state       │
│                                                                     │
│  Worker Pool                                                        │
│  ├── depth.worker      — runs transformers.js inference (WebGPU/WASM)│
│  ├── mesh.worker       — displacement, plate build, smoothing,     │
│  │                       normal/AO/roughness map generation          │
│  └── export.worker     — GLB/OBJ/STL/ZIP serialization              │
│                                                                     │
│  Core lib (pure TS, unit-testable, no DOM)                          │
│  ├── DepthProvider interface                                        │
│  │     ├── LocalDepthProvider (transformers.js)                     │
│  │     └── (future) RemoteDepthProvider (HTTP → GPU server)         │
│  ├── HeightMap ops (blur, gamma, invert, resample)                  │
│  ├── MeshBuilder (plane / plate / cutout)                           │
│  ├── MapBaker (normal / AO / roughness)                             │
│  └── exporters (glb | gltf | obj | stl | maps)                      │
│                                                                     │
│  Storage: IndexedDB (projects, depth cache, model cache)            │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.1 Data flow (single conversion)
```
Image file
  → decode (createImageBitmap) → downscale to working res (RGBA8)
  → [AI mode] depth.worker: resize→model→Float32 depth @model res → bilinear upsample
  → [Relief mode] luma/alpha → Float32 height @working res
  → HeightMap ops: smooth/gamma
  → mesh.worker: Float32 heights → typed-array mesh (positions, normals, uvs, indices)
  → r3f BufferGeometry preview
  → (on export) mesh.worker output + MapBaker output → export.worker → Blob → download
```

### 7.2 Recompute strategy
- Parameter changes are classified: **cheap** (depthScale, strength) → re-displace existing geometry only; **medium** (smoothing, resolution) → re-run from heightmap; **expensive** (new image, model change) → full pipeline.
- All recompute debounced 150 ms; mesh.worker output is cancelable (generation tokens).

---

## 8. Key interfaces (TypeScript)

```ts
export type DepthResult = { width: number; height: number; data: Float32Array }; // 0..1, 0 = near

export interface DepthProvider {
  readonly id: string;
  init(): Promise<void>;                       // load/compile model, cache
  estimate(bitmap: ImageBitmap, signal: AbortSignal): Promise<DepthResult>;
  dispose(): Promise<void>;
}

export interface MeshBuildInput {
  heights: Float32Array; width: number; height: number;
  resolution: number; depthScale: number;
  style: 'plane' | 'plate'; baseThickness?: number;
}
export interface MeshBuildResult {
  positions: Float32Array; normals: Float32Array;
  uvs: Float32Array; indices: Uint32Array;
  triangleCount: number; bounds: { min: [number,number,number]; max: [number,number,number] };
}

export type ExportFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'maps-zip';
export interface ExportOptions {
  format: ExportFormat;
  axisConvention: 'gltf' | 'unity' | 'unreal';
  includeTextures: boolean;
  texturePacking?: 'individual' | 'ormo' | 'ue';
}
```

---

## 9. UI / UX spec

### 9.1 Layout (single-page workspace)
```
┌──────────────────────────────────────────────────────────────────┐
│ Header: logo · project name · New/Open/Save · Export button      │
├──────────────┬──────────────────────────────────┬────────────────┤
│ Left rail    │  Viewport (3D preview)           │ Right panel    │
│ 1. Image     │  orbit / zoom / pan              │ 1. Mode        │
│ 2. Mode      │  overlay: tri-count, dims,       │ 2. Parameters  │
│ 3. Depth     │  material-mode chips             │ 3. Mesh        │
│ 4. Maps      │                                  │ 4. PBR Maps    │
│ 5. Export    │                                  │ 5. Units/Axis  │
├──────────────┴──────────────────────────────────┴────────────────┤
│ Status bar: device capability badge (WebGPU/WASM) · autosave     │
└──────────────────────────────────────────────────────────────────┘
```

- **Material-mode chips** (viewport top-right): Shaded · Textured · PBR · Normals · Wire · Depth.
- **Progress** appears as an overlay chip on the viewport (never blocks the whole UI).
- Sliders show numeric input alongside; all controls keyboard reachable.
- Empty state: large drop zone with sample images ("Try one") that load CC0 images instantly.

### 9.2 Export dialog
- Format picker (GLB default), texture include/packing, axis-convention preset (with engine logos: Unity / Unreal / Godot / glTF), units, scale preview ("Exports as 2.00 m × 2.00 m × 0.30 m"), file size estimate, Download.

---

## 10. Testing & quality

| Area | Approach |
|---|---|
| Core lib | Vitest unit tests: HeightMap ops (golden arrays), MeshBuilder (vertex counts, manifold checks for plate mode, normal orientation), exporters (parse-back round-trip: exported GLB re-parsed and compared) |
| Determinism | Same input + params → byte-identical STL/OBJ (except header) — snapshot-tested |
| Inference | Skip-in-CI unit contract test on DepthProvider interface + recorded fixture depth map for pipeline tests |
| E2E | Playwright: upload sample → toggle modes → change params → export GLB → assert download exists & parses |
| Perf budget | Lighthouse CI ≥ 90 perf on landing; worker time asserts in e2e |
| A11y | axe-core in Playwright on main workspace |

---

## 11. Roadmap / milestones

### M0 — Scaffold (0.5 wk)
Vite + React + TS + Tailwind + r3f skeleton, Zustand store, workspace layout, deploy pipeline (static host), CI (lint, test, build).

### M1 — Relief MVP (1 wk)
Import pipeline, Relief mode end-to-end, plane mesh builder, preview (Shaded/Textured/Wire), GLB + STL export, project save/load. **Definition of done:** a logo PNG becomes a valid GLB that imports cleanly into Unity and Godot.

### M2 — AI depth (1–1.5 wk)
depth.worker + LocalDepthProvider, WebGPU/WASM detection + fallback, model caching, depth invert/smooth controls, Depth preview mode. **DoD:** photo → mesh on M-series MacBook in < 5 s (WebGPU), works in WASM Firefox.

### M3 — Game-asset polish (1 wk)
PBR map baking (normal/AO/roughness/height), texture packing options, axis-convention presets, units/scale, OBJ + glTF + maps-zip export, viewport PBR mode.

### M4 — Robustness & release (0.5–1 wk)
Memory fallback chain, worker cancellation, error surfaces, a11y pass, perf pass, e2e suite green, docs (`README`, in-app help), public deploy.

### Post-v1 backlog (priority order)
1. **High-quality remote mode** — optional Node+GPU server (Depth Pro / Marigold) behind the `DepthProvider` interface, user-provided endpoint or hosted toggle.
2. Cutout/extrusion mode (alpha → silhouette + bevel) for sprites/decals.
3. Tiled texture-sheet mode (relief stamped N×M with seam blending).
4. PWA install + offline model streaming.
5. Draco/meshopt compression options.
6. Batch queue (folder of images → folder of GLBs).
7. Decimation controls + LOD chain export (glTF extras).
8. Alpha-mask AI subject isolation (rembg-class model) before depth.

---

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| WebGPU unavailable (Safari/Firefox older) | Slow AI mode | WASM fallback + Relief mode unaffected; capability badge sets expectations |
| 2 GB tab memory ceiling at 2048² | Crashes | Resolution fallback chain (2048→1024→512), Float32-only in workers, transferable buffers, cancelable jobs |
| ONNX model download size (~50 MB) | First-run friction | Show size before first AI use, aggressive caching, Relief mode works offline immediately |
| Export doesn't import cleanly in Unity/UE | Kills core value prop | Axis-convention presets + round-trip tests + M1 DoD requires real engine imports |
| Depth Anything V2 relative-depth scale ambiguity | Meshes "look flat" for distant scenes | depthScale + non-linear curve remap control; docs recommending close-range photos |
| Model license/CDN drift | Legal/availability | Self-host weights, pin versions + integrity hash, Apache-2.0 only |

---

## 13. Success metrics (post-launch)

- Median time from drop → exported GLB < 60 s.
- ≥ 70 % of exports are GLB; export error rate < 1 %.
- Engine-import success reported by users (feedback link in export dialog).
- P95 worker memory < 1.5 GB at default settings.

---

## Appendix A — Glossary
- **Heightmap:** grayscale image where pixel value = height.
- **Displacement:** moving mesh vertices along an axis according to a heightmap.
- **PBR maps:** texture maps (normal/AO/roughness/etc.) used by physically-based shading in game engines.
- **Axis conventions:** engines differ (glTF +Y up right-handed; Unity -Z forward; Unreal Z-up cm).
