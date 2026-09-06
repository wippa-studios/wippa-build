# wippa-build

**Drop an image in, get a 3D asset out.**

A browser-based tool that converts 2D images into 3D meshes with PBR textures. Built for game developers and technical artists who need engine-ready assets — not just raw geometry.

> Zero install. Runs entirely in your browser. Your images never leave your device.

---

## What it does

wippa-build takes a single image and generates a 3D model from it using two methods:

- **Relief mode** — Converts pixel brightness into height. Perfect for logos, tiles, lithophanes, coins, terrain heightmaps, and decorative reliefs. Instant, deterministic, no ML required.

- **AI mode** — Uses [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) to estimate real-world depth from any photo. Runs client-side via WebGPU (or WASM fallback). Great for turning photos of real objects into 3D meshes.

Tweak parameters live in the viewport, then export to any major format with PBR texture maps baked and ready.

---

## Features

### Two depth modes

| Mode | How it works | Best for |
|------|-------------|----------|
| **Relief** | Luminance/alpha → heightmap displacement | Logos, coins, tiles, terrain, lithophanes |
| **AI Depth** | Neural depth estimation (Depth Anything V2) | Photos of real objects, scenes, faces |

### Live 3D preview

- Orbit, zoom, pan with mouse
- 6 material preview modes: Shaded, Textured, PBR, Normals, Wireframe, Depth
- Real-time triangle count and dimension readout
- Adjustable grid and lighting

### Full parameter control

- **Resolution** — 64 to 2048 vertices per axis
- **Depth scale** — 0–2× displacement strength
- **Smoothing** — Gaussian blur radius 0–32px before mesh generation
- **Mesh style** — Flat plane or watertight plate (for 3D printing)
- **Relief source** — Luminance, inverted luminance, or alpha channel
- **Gamma & contrast** — Shape the heightmap before displacement

### PBR map generation

Bake texture maps directly from the heightmap:

| Map | What it does |
|-----|-------------|
| **Normal** | Surface detail via Sobel gradient (configurable strength, Y-flip for engine compat) |
| **Ambient Occlusion** | Depth-based contact shadowing |
| **Roughness** | Constant value or luminance-derived |
| **Height** | Raw heightmap for tessellation shaders |

### Export formats

| Format | Contents | Use case |
|--------|----------|----------|
| **GLB** | Mesh + embedded textures | Primary format — Unity, Unreal, Godot, Blender |
| **glTF** | Mesh + external texture files | Pipelines that want loose files |
| **OBJ + MTL** | Mesh + material + textures | Maximum compatibility |
| **STL** | Mesh only (binary) | 3D printing |
| **Maps ZIP** | PBR textures only (PNG) | Texture authoring workflows |

### Engine presets

Export with the correct coordinate system for your target engine:

- **glTF** — Y-up, right-handed (default)
- **Unity** — Y-up, left-handed, Z-forward
- **Unreal** — Z-up, centimeter scale

### Project persistence

- Save/load projects to browser storage (IndexedDB)
- Settings, image, and depth cache all persisted
- New project, save, export — all in the header bar

---

## Getting started

```bash
# Clone
git clone https://github.com/wippa-studios/wippa-build.git
cd wippa-build

# Install
npm install

# Dev server
npm run dev
```

Open `http://localhost:5173` and drop an image onto the canvas.

### Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript compiler (no emit) |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| UI | React 19, TypeScript, Tailwind CSS v4 |
| 3D | Three.js via @react-three/fiber + drei |
| State | Zustand |
| ML | @huggingface/transformers (ONNX Runtime Web) |
| Model | Depth Anything V2 Small (Apache-2.0) |
| Build | Vite 7 |
| Storage | IndexedDB via idb |

### Why no backend?

Everything runs in the browser. Image decoding, heightmap generation, mesh building, PBR baking, depth inference, and export all happen client-side. This means:

- **Zero server costs** — no GPU farm, no inference API bills
- **Total privacy** — images never leave the device
- **Offline capable** — once the model is cached, the app works fully offline
- **Instant deploy** — static files, host anywhere

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  React UI (Zustand store → r3f viewport)            │
├─────────────────────────────────────────────────────┤
│  Workers                                            │
│  ├─ mesh.worker     — heightmap → geometry          │
│  ├─ depth.worker    — AI inference (WebGPU/WASM)    │
│  └─ export.worker   — GLB/OBJ/STL serialization     │
├─────────────────────────────────────────────────────┤
│  Core lib (pure TypeScript, no DOM)                  │
│  ├─ HeightMap ops (blur, gamma, extract)             │
│  ├─ MeshBuilder (plane / plate / cutout)             │
│  ├─ MapBaker (normal / AO / roughness / height)      │
│  └─ Exporters (GLB / glTF / OBJ / STL)              │
└─────────────────────────────────────────────────────┘
```

All heavy computation runs in Web Workers to keep the UI responsive. The `DepthProvider` interface is designed so a future server-GPU mode can drop in without changing the UI.

---

## File structure

```
src/
├── App.tsx                    # Root layout + drop zone
├── main.tsx                   # Entry point
├── index.css                  # Tailwind + custom styles
├── types.ts                   # All TypeScript types
├── store/useStore.ts          # Zustand state + IndexedDB persistence
├── components/
│   ├── Header.tsx             # Brand, project name, material chips, save/export
│   ├── LeftPanel.tsx          # Image, mode, relief/AI controls, resolution
│   ├── RightPanel.tsx         # Mesh, PBR maps, tiling, units, viewport info
│   ├── Viewport.tsx           # r3f canvas, materials, orbit controls
│   └── ExportDialog.tsx       # Format picker, axis presets, download
├── lib/
│   ├── mesh/
│   │   ├── HeightMap.ts       # Luma, blur, gamma, resample
│   │   └── MeshBuilder.ts     # Plane + plate geometry builders
│   ├── maps/MapBaker.ts       # Normal, AO, roughness, height baking
│   └── export/
│       ├── GlbExporter.ts     # Binary GLB (valid glTF 2.0)
│       ├── ObjExporter.ts     # OBJ + MTL with axis transforms
│       └── StlExporter.ts     # Binary STL
└── workers/
    ├── mesh/mesh.worker.ts    # Mesh generation in worker
    ├── depth/depth.worker.ts  # AI depth inference in worker
    └── export/export.worker.ts # File export in worker
```

---

## Roadmap

### Done
- [x] Relief mode (luminance/alpha heightmap → mesh)
- [x] AI depth mode (Depth Anything V2, WebGPU/WASM)
- [x] Mesh builder (plane + watertight plate)
- [x] PBR map baking (normal, AO, roughness, height)
- [x] Export (GLB, glTF, OBJ+MTL, STL, maps ZIP)
- [x] 3D viewport with 6 material modes
- [x] Project save/load (IndexedDB)
- [x] Engine presets (glTF, Unity, Unreal)

### Next
- [ ] High-quality remote mode (server GPU: Depth Pro / Marigold)
- [ ] Cutout/extrusion mode (silhouette + bevel for sprites)
- [ ] Tiled texture sheets (seam-blended relief stamps)
- [ ] PWA install + offline model streaming
- [ ] Draco / meshopt compression
- [ ] Batch processing (folder → folder)
- [ ] LOD chain export

---

## License

MIT
