import { create } from 'zustand';
import { openDB, type IDBPDatabase } from 'idb';
import type {
  Mode,
  MaterialMode,
  DeviceCapability,
  DepthResult,
  MeshBuildResult,
  ViewportInfo,
  ReliefParams,
  AiParams,
  MeshParams,
  MapParams,
  TilingParams,
  UnitParams,
  AxisConvention,
  ProjectParams,
  ProjectData,
} from '../types';

function generateId(): string {
  return crypto.randomUUID();
}

function getProjectParams(s: StoreState): ProjectParams {
  return {
    mode: s.mode,
    resolution: s.resolution,
    depthScale: s.depthScale,
    smoothing: s.smoothing,
    relief: s.relief,
    ai: s.ai,
    mesh: s.mesh,
    maps: s.maps,
    tiling: s.tiling,
    units: s.units,
    axisConvention: s.axisConvention,
  };
}

const DB_NAME = 'wippa-build';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    },
  });
}

interface StoreState {
  // UI state
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  materialMode: MaterialMode;
  exportDialogOpen: boolean;
  isProcessing: boolean;
  processingMessage: string;
  error: string | null;
  capability: DeviceCapability;

  // Image state
  image: File | null;
  imageUrl: string | null;
  imageBitmap: ImageBitmap | null;
  imageWidth: number;
  imageHeight: number;

  // Depth state
  depthResult: DepthResult | null;

  // Mesh state
  meshResult: MeshBuildResult | null;
  viewportInfo: ViewportInfo | null;

  // Project state
  projectId: string;
  projectName: string;
  projects: ProjectData[];

  // Parameters
  mode: Mode;
  resolution: number;
  depthScale: number;
  smoothing: number;
  relief: ReliefParams;
  ai: AiParams;
  mesh: MeshParams;
  maps: MapParams;
  tiling: TilingParams;
  units: UnitParams;
  axisConvention: AxisConvention;

  // Actions
  loadImage: (file: File) => Promise<void>;
  setMode: (mode: Mode) => void;
  setResolution: (res: number) => void;
  setDepthScale: (scale: number) => void;
  setSmoothing: (s: number) => void;
  setReliefParams: (p: Partial<ReliefParams>) => void;
  setAiParams: (p: Partial<AiParams>) => void;
  setMeshParams: (p: Partial<MeshParams>) => void;
  setMapParams: (p: Partial<MapParams>) => void;
  setTilingParams: (p: Partial<TilingParams>) => void;
  setUnitParams: (p: Partial<UnitParams>) => void;
  setAxisConvention: (a: AxisConvention) => void;
  setProjectName: (name: string) => void;
  setMaterialMode: (m: MaterialMode) => void;
  setLeftPanelOpen: (v: boolean) => void;
  setRightPanelOpen: (v: boolean) => void;
  setExportDialogOpen: (v: boolean) => void;
  setMeshResult: (r: MeshBuildResult | null) => void;
  setViewportInfo: (v: ViewportInfo | null) => void;
  setDepthResult: (d: DepthResult | null) => void;
  setProcessing: (v: boolean, msg?: string) => void;
  setError: (e: string | null) => void;
  clearProject: () => void;
  saveProject: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  listProjects: () => Promise<ProjectData[]>;
  deleteProject: (id: string) => Promise<void>;
}

let meshWorker: Worker | null = null;
let errorTimeout: ReturnType<typeof setTimeout> | null = null;

function getMeshWorker(): Worker {
  if (!meshWorker) {
    meshWorker = new Worker(
      new URL('../workers/mesh/mesh.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return meshWorker;
}

function extractHeightmap(bitmap: ImageBitmap, source: 'luma' | 'invLuma' | 'alpha'): Float32Array {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const pixels = imageData.data;
  const w = bitmap.width;
  const h = bitmap.height;
  const result = new Float32Array(w * h);

  for (let i = 0; i < w * h; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    const a = pixels[i * 4 + 3];
    let value: number;

    if (source === 'alpha') {
      value = a / 255;
    } else {
      value = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (source === 'invLuma') value = 1 - value;
    }

    result[i] = value;
  }

  return result;
}

type SetState = StoreState | Partial<StoreState> | ((s: StoreState) => StoreState | Partial<StoreState>);
type GetState = () => StoreState;

function requestMeshGeneration(
  heights: Float32Array,
  width: number,
  height: number,
  state: StoreState,
  set: (partial: SetState) => void,
) {
  const worker = getMeshWorker();
  const id = crypto.randomUUID();

  const onMessage = (e: MessageEvent) => {
    const data = e.data;
    if (data.type === 'mesh-result' && data.id === id) {
      worker.removeEventListener('message', onMessage);
      const result = data.result as MeshBuildResult;
      const viewport: ViewportInfo = {
        triangleCount: result.triangleCount,
        vertexCount: result.positions.length / 3,
        dimensions: {
          width: result.bounds.max[0] - result.bounds.min[0],
          height: result.bounds.max[1] - result.bounds.min[1],
          depth: result.bounds.max[2] - result.bounds.min[2],
        },
      };
      set({
        meshResult: result,
        viewportInfo: viewport,
        isProcessing: false,
        processingMessage: '',
      });
    } else if (data.type === 'error' && data.id === id) {
      worker.removeEventListener('message', onMessage);
      set({
        isProcessing: false,
        processingMessage: '',
        error: data.error,
      });
    }
  };

  worker.addEventListener('message', onMessage);

  worker.postMessage({
    type: 'build-mesh',
    id,
    input: {
      heights,
      width,
      height,
      resolution: state.resolution,
      depthScale: state.depthScale,
      smoothing: state.smoothing,
      style: state.mesh.style,
      baseThickness: state.mesh.baseThickness,
    },
  });
}

function b64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function b64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export const useStore = create<StoreState>((set, get) => ({
  // UI defaults
  leftPanelOpen: true,
  rightPanelOpen: true,
  materialMode: 'shaded',
  exportDialogOpen: false,
  isProcessing: false,
  processingMessage: '',
  error: null,
  capability: 'wasm',

  // Image defaults
  image: null,
  imageUrl: null,
  imageBitmap: null,
  imageWidth: 0,
  imageHeight: 0,

  // Depth defaults
  depthResult: null,

  // Mesh defaults
  meshResult: null,
  viewportInfo: null,

  // Project defaults
  projectId: generateId(),
  projectName: 'Untitled',
  projects: [],

  // Parameter defaults
  mode: 'relief',
  resolution: 512,
  depthScale: 1.0,
  smoothing: 2,

  relief: { source: 'luma', gamma: 1.0, contrast: 0 },
  ai: { invert: false },
  mesh: { style: 'plane', baseThickness: 0.1 },
  maps: {
    normal: { enabled: true, strength: 1.0, flipY: false },
    ao: { enabled: true, intensity: 1.0 },
    roughness: { mode: 'constant', value: 0.5 },
    height: { enabled: true },
  },
  tiling: { enabled: false, tilesX: 1, tilesY: 1 },
  units: { scale: 1.0, unit: 'm' },
  axisConvention: 'gltf',

  // Actions
  loadImage: async (file: File) => {
    const url = URL.createObjectURL(file);
    const bitmap = await createImageBitmap(
      await fetch(url).then((r) => r.blob())
    );

    set({
      image: file,
      imageUrl: url,
      imageBitmap: bitmap,
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
      depthResult: null,
      meshResult: null,
      viewportInfo: null,
      isProcessing: true,
      processingMessage: 'Generating heightmap...',
      error: null,
    });

    const state = get();

    if (state.mode === 'relief') {
      const heights = extractHeightmap(bitmap, state.relief.source);

      const depth: DepthResult = {
        width: bitmap.width,
        height: bitmap.height,
        data: heights,
      };

      set({ depthResult: depth, processingMessage: 'Building mesh...' });

      requestMeshGeneration(heights, bitmap.width, bitmap.height, get(), set);
    } else {
      set({ isProcessing: false, processingMessage: '' });
    }
  },

  setMode: (mode: Mode) => {
    set({ mode, isProcessing: true, processingMessage: 'Regenerating depth...' });
    const state = get();

    if (mode === 'relief' && state.imageBitmap) {
      const heights = extractHeightmap(state.imageBitmap, state.relief.source);
      const depth: DepthResult = {
        width: state.imageBitmap.width,
        height: state.imageBitmap.height,
        data: heights,
      };
      set({ depthResult: depth, processingMessage: 'Building mesh...' });
      requestMeshGeneration(heights, depth.width, depth.height, get(), set);
    } else {
      set({ depthResult: null, meshResult: null, viewportInfo: null, isProcessing: false, processingMessage: '' });
    }
  },

  setResolution: (res: number) => {
    set({ resolution: res });
    const state = get();
    if (state.depthResult) {
      set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
      requestMeshGeneration(state.depthResult.data, state.depthResult.width, state.depthResult.height, get(), set);
    }
  },

  setDepthScale: (scale: number) => {
    set({ depthScale: scale });
    const state = get();
    if (state.depthResult) {
      set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
      requestMeshGeneration(state.depthResult.data, state.depthResult.width, state.depthResult.height, get(), set);
    }
  },

  setSmoothing: (s: number) => {
    set({ smoothing: s });
    const state = get();
    if (state.depthResult) {
      set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
      requestMeshGeneration(state.depthResult.data, state.depthResult.width, state.depthResult.height, get(), set);
    }
  },

  setReliefParams: (p: Partial<ReliefParams>) => {
    set((s) => ({ relief: { ...s.relief, ...p } }));
    const state = get();
    if (state.mode === 'relief' && state.imageBitmap) {
      set({ isProcessing: true, processingMessage: 'Regenerating...' });
      const heights = extractHeightmap(state.imageBitmap, state.relief.source);
      const depth: DepthResult = {
        width: state.imageBitmap.width,
        height: state.imageBitmap.height,
        data: heights,
      };
      set({ depthResult: depth, processingMessage: 'Building mesh...' });
      requestMeshGeneration(heights, depth.width, depth.height, get(), set);
    }
  },

  setAiParams: (p: Partial<AiParams>) => {
    set((s) => ({ ai: { ...s.ai, ...p } }));
    const state = get();
    if (state.mode === 'ai' && state.depthResult) {
      set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
      requestMeshGeneration(state.depthResult.data, state.depthResult.width, state.depthResult.height, get(), set);
    }
  },

  setMeshParams: (p: Partial<MeshParams>) => {
    set((s) => ({ mesh: { ...s.mesh, ...p } }));
    const state = get();
    if (state.depthResult) {
      set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
      requestMeshGeneration(state.depthResult.data, state.depthResult.width, state.depthResult.height, get(), set);
    }
  },

  setMapParams: (p: Partial<MapParams>) => {
    set((s) => ({
      maps: {
        ...s.maps,
        ...p,
        normal: p.normal ? { ...s.maps.normal, ...p.normal } : s.maps.normal,
        ao: p.ao ? { ...s.maps.ao, ...p.ao } : s.maps.ao,
        roughness: p.roughness ? { ...s.maps.roughness, ...p.roughness } : s.maps.roughness,
        height: p.height ? { ...s.maps.height, ...p.height } : s.maps.height,
      },
    }));
  },

  setTilingParams: (p: Partial<TilingParams>) => {
    set((s) => ({ tiling: { ...s.tiling, ...p } }));
  },

  setUnitParams: (p: Partial<UnitParams>) => {
    set((s) => ({ units: { ...s.units, ...p } }));
  },

  setAxisConvention: (a: AxisConvention) => set({ axisConvention: a }),
  setProjectName: (name: string) => set({ projectName: name }),
  setMaterialMode: (m: MaterialMode) => set({ materialMode: m }),
  setLeftPanelOpen: (v: boolean) => set({ leftPanelOpen: v }),
  setRightPanelOpen: (v: boolean) => set({ rightPanelOpen: v }),
  setExportDialogOpen: (v: boolean) => set({ exportDialogOpen: v }),
  setMeshResult: (r: MeshBuildResult | null) => set({ meshResult: r }),
  setViewportInfo: (v: ViewportInfo | null) => set({ viewportInfo: v }),
  setDepthResult: (d: DepthResult | null) => set({ depthResult: d }),

  setProcessing: (v: boolean, msg?: string) => set({ isProcessing: v, processingMessage: msg ?? '' }),

  setError: (e: string | null) => {
    set({ error: e });
    if (errorTimeout) clearTimeout(errorTimeout);
    if (e) {
      errorTimeout = setTimeout(() => {
        set({ error: null });
        errorTimeout = null;
      }, 5000);
    }
  },

  clearProject: () => {
    const s = get();
    if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);

    if (errorTimeout) {
      clearTimeout(errorTimeout);
      errorTimeout = null;
    }

    set({
      image: null,
      imageUrl: null,
      imageBitmap: null,
      imageWidth: 0,
      imageHeight: 0,
      depthResult: null,
      meshResult: null,
      viewportInfo: null,
      isProcessing: false,
      processingMessage: '',
      error: null,
      projectId: generateId(),
      projectName: 'Untitled',
      mode: 'relief',
      resolution: 512,
      depthScale: 1.0,
      smoothing: 2,
      relief: { source: 'luma', gamma: 1.0, contrast: 0 },
      ai: { invert: false },
      mesh: { style: 'plane', baseThickness: 0.1 },
      maps: {
        normal: { enabled: true, strength: 1.0, flipY: false },
        ao: { enabled: true, intensity: 1.0 },
        roughness: { mode: 'constant', value: 0.5 },
        height: { enabled: true },
      },
      tiling: { enabled: false, tilesX: 1, tilesY: 1 },
      units: { scale: 1.0, unit: 'm' },
      axisConvention: 'gltf',
      materialMode: 'shaded',
    });
  },

  saveProject: async () => {
    const s = get();
    const db = await getDB();

    let imageDataBase64: string | undefined;
    if (s.image) {
      const arrayBuffer = await s.image.arrayBuffer();
      imageDataBase64 = b64Encode(new Uint8Array(arrayBuffer));
    }

    const project: ProjectData = {
      id: s.projectId,
      name: s.projectName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      imageDataBase64,
      imageWidth: s.imageWidth || undefined,
      imageHeight: s.imageHeight || undefined,
      params: getProjectParams(s),
      depthCache: s.depthResult
        ? {
            width: s.depthResult.width,
            height: s.depthResult.height,
            data: Array.from(s.depthResult.data),
          }
        : undefined,
    };

    await db.put(STORE_NAME, project);
  },

  loadProject: async (id: string) => {
    const db = await getDB();
    const project = (await db.get(STORE_NAME, id)) as ProjectData | undefined;
    if (!project) return;

    const s = get();
    if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);

    let imageBitmap: ImageBitmap | null = null;
    let image: File | null = null;
    let imageUrl: string | null = null;

    if (project.imageDataBase64) {
      const bytes = b64Decode(project.imageDataBase64);
      const blob = new Blob([bytes]);
      image = new File([blob], `${project.name}.png`);
      imageUrl = URL.createObjectURL(blob);
      imageBitmap = await createImageBitmap(blob);
    }

    const depthResult: DepthResult | null = project.depthCache
      ? {
          width: project.depthCache.width,
          height: project.depthCache.height,
          data: new Float32Array(project.depthCache.data),
        }
      : null;

    set({
      projectId: project.id,
      projectName: project.name,
      image,
      imageUrl,
      imageBitmap,
      imageWidth: project.imageWidth ?? 0,
      imageHeight: project.imageHeight ?? 0,
      depthResult,
      meshResult: null,
      viewportInfo: null,
      ...project.params,
    });

    if (depthResult) {
      set({ isProcessing: true, processingMessage: 'Building mesh...' });
      requestMeshGeneration(depthResult.data, depthResult.width, depthResult.height, get(), set);
    }
  },

  listProjects: async () => {
    const db = await getDB();
    return db.getAll(STORE_NAME);
  },

  deleteProject: async (id: string) => {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
    }));
  },
}));
