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
  MapType,
  TilingParams,
  UnitParams,
  AxisConvention,
  ProjectParams,
  ProjectData,
  BakedMapData,
  PreviewMaps,
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
  previewMaps: PreviewMaps;

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
  setMode: (mode: Mode) => Promise<void>;
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
  refreshPreviewMaps: () => void;
  setProcessing: (v: boolean, msg?: string) => void;
  setError: (e: string | null) => void;
  probeCapability: () => Promise<void>;
  clearProject: () => void;
  saveProject: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  listProjects: () => Promise<ProjectData[]>;
  deleteProject: (id: string) => Promise<void>;
}

interface DepthInitResult {
  success: boolean;
  device: DeviceCapability | 'none';
  error?: string;
}

let meshWorker: Worker | null = null;
let depthWorker: Worker | null = null;
let depthInitPromise: Promise<DepthInitResult> | null = null;
let activeDepthRequestId: string | null = null;
let activeDepthEstimatePosted = false;
let activePreviewMapId: string | null = null;
let activePreviewMapPosted = false;
let activeHeightmapRequestId: string | null = null;
let activeHeightmapPosted = false;
let activeMeshRequestId: string | null = null;
let activeMeshRequestPosted = false;
let activeMeshCleanup: (() => void) | null = null;
let meshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let reliefDebounceTimer: ReturnType<typeof setTimeout> | null = null;
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

function getDepthWorker(): Worker {
  if (!depthWorker) {
    depthWorker = new Worker(
      new URL('../workers/depth/depth.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return depthWorker;
}

async function detectCapability(): Promise<DeviceCapability> {
  if (typeof navigator === 'undefined') {
    return 'unavailable';
  }

  const gpu = (navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown> };
  }).gpu;

  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (adapter) {
        return 'webgpu';
      }
    } catch {
      // The worker will try the WASM backend when WebGPU is unavailable.
    }
  }

  return typeof WebAssembly === 'undefined' ? 'unavailable' : 'wasm';
}

type SetState = StoreState | Partial<StoreState> | ((s: StoreState) => StoreState | Partial<StoreState>);
type GetState = () => StoreState;

function ensureDepthInitialized(worker: Worker): Promise<DepthInitResult> {
  if (depthInitPromise) return depthInitPromise;

  const promise = new Promise<DepthInitResult>((resolve, reject) => {
    const onMessage = (event: MessageEvent<{ type: string } & Partial<DepthInitResult>>) => {
      const data = event.data;
      if (data.type !== 'init-result') return;

      cleanup();
      if (data.success && data.device && data.device !== 'none') {
        resolve({ success: true, device: data.device });
      } else {
        reject(new Error(data.error ?? 'AI depth initialization failed'));
      }
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Depth worker initialization failed'));
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type: 'init' });
  }).catch((error: unknown) => {
    if (depthInitPromise === promise) depthInitPromise = null;
    throw error;
  });

  depthInitPromise = promise;
  return promise;
}

function cancelDepthEstimation(worker: Worker): void {
  if (activeDepthRequestId && activeDepthEstimatePosted) {
    worker.postMessage({ type: 'cancel', id: activeDepthRequestId });
  }
  activeDepthRequestId = null;
  activeDepthEstimatePosted = false;
}

function requestDepthEstimation(
  bitmap: ImageBitmap,
  invert: boolean,
  set: (partial: SetState) => void,
): void {
  const worker = getDepthWorker();
  cancelDepthEstimation(worker);

  const id = crypto.randomUUID();
  activeDepthRequestId = id;

  void (async () => {
    let initResult: DepthInitResult;
    try {
      initResult = await ensureDepthInitialized(worker);
    } catch (error) {
      if (activeDepthRequestId === id) {
        activeDepthRequestId = null;
        activeDepthEstimatePosted = false;
        set({
          isProcessing: false,
          processingMessage: '',
          error: error instanceof Error ? error.message : String(error),
          capability: 'unavailable',
        });
      }
      return;
    }

    if (activeDepthRequestId !== id) return;

    let image: ImageBitmap;
    try {
      image = await createImageBitmap(bitmap);
    } catch (error) {
      if (activeDepthRequestId === id) {
        activeDepthRequestId = null;
        activeDepthEstimatePosted = false;
        set({
          isProcessing: false,
          processingMessage: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (activeDepthRequestId !== id) {
      image.close();
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'depth-result' && data.id === id) {
        cleanup();
        if (activeDepthRequestId !== id) return;

        activeDepthRequestId = null;
        activeDepthEstimatePosted = false;
        const depth: DepthResult = {
          width: data.width,
          height: data.height,
          data: new Float32Array(data.data),
        };

        set({
          depthResult: depth,
          processingMessage: 'Building mesh...',
          capability: initResult.device === 'none' ? 'unavailable' : initResult.device,
        });
        requestMeshGeneration(depth.data, depth.width, depth.height, useStore.getState(), set);
      } else if (data.type === 'error' && data.id === id) {
        cleanup();
        if (activeDepthRequestId !== id) return;

        activeDepthRequestId = null;
        set({
          isProcessing: false,
          processingMessage: '',
          error: data.error,
        });
      }
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
    };

    worker.addEventListener('message', onMessage);
    activeDepthEstimatePosted = true;
    worker.postMessage(
      {
        type: 'estimate',
        id,
        image,
        width: bitmap.width,
        height: bitmap.height,
        invert,
      },
      [image],
    );
  })();
}

function cancelHeightmapExtraction(worker: Worker): void {
  if (activeHeightmapRequestId && activeHeightmapPosted) {
    worker.postMessage({ type: 'cancel', id: activeHeightmapRequestId });
  }
  activeHeightmapRequestId = null;
  activeHeightmapPosted = false;
}

function clearReliefDebounce(): void {
  if (reliefDebounceTimer) {
    clearTimeout(reliefDebounceTimer);
    reliefDebounceTimer = null;
  }
}

function scheduleHeightmapExtraction(set: (partial: SetState) => void): void {
  clearReliefDebounce();
  if (meshWorker) cancelHeightmapExtraction(meshWorker);
  reliefDebounceTimer = setTimeout(() => {
    reliefDebounceTimer = null;
    const state = useStore.getState();
    if (state.mode !== 'relief' || !state.imageBitmap) return;
    requestHeightmapExtraction(state.imageBitmap, state.relief, set);
  }, 150);
}

function requestHeightmapExtraction(
  bitmap: ImageBitmap,
  relief: ReliefParams,
  set: (partial: SetState) => void,
): void {
  const worker = getMeshWorker();
  cancelHeightmapExtraction(worker);

  const id = crypto.randomUUID();
  activeHeightmapRequestId = id;

  void (async () => {
    let image: ImageBitmap;
    try {
      image = await createImageBitmap(bitmap);
    } catch (error) {
      if (activeHeightmapRequestId === id) {
        activeHeightmapRequestId = null;
        activeHeightmapPosted = false;
        set({
          isProcessing: false,
          processingMessage: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (activeHeightmapRequestId !== id) {
      image.close();
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'heightmap-result' && data.id === id) {
        cleanup();
        if (activeHeightmapRequestId !== id) return;

        activeHeightmapRequestId = null;
        activeHeightmapPosted = false;
        const depth: DepthResult = {
          width: data.width,
          height: data.height,
          data: new Float32Array(data.data),
        };
        set({ depthResult: depth, processingMessage: 'Building mesh...', previewMaps: {} });
        requestMeshGeneration(depth.data, depth.width, depth.height, useStore.getState(), set);
      } else if (data.type === 'error' && data.id === id) {
        cleanup();
        if (activeHeightmapRequestId !== id) return;

        activeHeightmapRequestId = null;
        activeHeightmapPosted = false;
        set({
          isProcessing: false,
          processingMessage: '',
          error: data.error,
        });
      }
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
    };

    worker.addEventListener('message', onMessage);
    activeHeightmapPosted = true;
    worker.postMessage(
      {
        type: 'extract-heightmap',
        id,
        image,
        source: relief.source,
        gamma: relief.gamma,
        contrast: relief.contrast,
      },
      [image],
    );
  })();
}

function cancelMeshGeneration(worker: Worker): void {
  if (activeMeshRequestId && activeMeshRequestPosted) {
    worker.postMessage({ type: 'cancel', id: activeMeshRequestId });
  }
  activeMeshCleanup?.();
  activeMeshCleanup = null;
  activeMeshRequestId = null;
  activeMeshRequestPosted = false;
}

function clearMeshDebounce(): void {
  if (meshDebounceTimer) {
    clearTimeout(meshDebounceTimer);
    meshDebounceTimer = null;
  }
}

function scheduleMeshGeneration(set: (partial: SetState) => void): void {
  clearMeshDebounce();
  if (meshWorker) cancelMeshGeneration(meshWorker);
  meshDebounceTimer = setTimeout(() => {
    meshDebounceTimer = null;
    const state = useStore.getState();
    if (!state.depthResult) return;
    requestMeshGeneration(
      state.depthResult.data,
      state.depthResult.width,
      state.depthResult.height,
      state,
      set,
    );
  }, 150);
}

function getResolutionFallback(resolution: number): number | null {
  if (resolution === 2048) return 1024;
  if (resolution === 1024) return 512;
  return null;
}

function requestMeshGeneration(
  heights: Float32Array,
  width: number,
  height: number,
  state: StoreState,
  set: (partial: SetState) => void,
): void {
  clearMeshDebounce();
  const worker = getMeshWorker();
  cancelMeshGeneration(worker);
  const id = crypto.randomUUID();
  activeMeshRequestId = id;

  const cleanup = () => {
    worker.removeEventListener('message', onMessage);
    if (activeMeshCleanup === cleanup) activeMeshCleanup = null;
  };

  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data.type === 'mesh-result' && data.id === id) {
      cleanup();
      if (activeMeshRequestId !== id) return;

      activeMeshRequestId = null;
      activeMeshRequestPosted = false;
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
      cleanup();
      if (activeMeshRequestId !== id) return;

      activeMeshRequestId = null;
      activeMeshRequestPosted = false;
      const fallbackResolution = getResolutionFallback(state.resolution);
      if (fallbackResolution !== null) {
        set({
          resolution: fallbackResolution,
          isProcessing: true,
          processingMessage: `Mesh build failed at ${state.resolution}px. Retrying at ${fallbackResolution}px...`,
        });
        requestMeshGeneration(
          heights,
          width,
          height,
          { ...state, resolution: fallbackResolution },
          set,
        );
        return;
      }

      set({
        isProcessing: false,
        processingMessage: '',
        error: data.error,
      });
    }
  };

  activeMeshCleanup = cleanup;
  worker.addEventListener('message', onMessage);
  activeMeshRequestPosted = true;
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

type PreviewMapRequest = {
  mapType: MapType;
  strength?: number;
  flipY?: boolean;
};

function getMapRequests(maps: MapParams): PreviewMapRequest[] {
  const requests: PreviewMapRequest[] = [];
  if (maps.normal.enabled) {
    requests.push({
      mapType: 'normal',
      strength: maps.normal.strength,
      flipY: maps.normal.flipY,
    });
  }
  if (maps.ao.enabled) {
    requests.push({ mapType: 'ao', strength: maps.ao.intensity });
  }
  if (maps.roughness.mode === 'constant') {
    requests.push({ mapType: 'roughness', strength: maps.roughness.value });
  } else {
    requests.push({ mapType: 'roughness' });
  }
  if (maps.height.enabled) {
    requests.push({ mapType: 'height' });
  }
  return requests;
}

function cancelPreviewMapGeneration(worker: Worker): void {
  if (activePreviewMapId && activePreviewMapPosted) {
    worker.postMessage({ type: 'cancel', id: activePreviewMapId });
  }
  activePreviewMapId = null;
  activePreviewMapPosted = false;
}

function requestPreviewMaps(
  depth: DepthResult,
  maps: MapParams,
  set: (partial: SetState) => void,
): void {
  const worker = getMeshWorker();
  cancelPreviewMapGeneration(worker);

  const requests = getMapRequests(maps);

  if (requests.length === 0) {
    set({ previewMaps: {} });
    return;
  }

  const id = crypto.randomUUID();
  activePreviewMapId = id;
  const heights = depth.data.slice();

  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data.type === 'maps-result' && data.id === id) {
      cleanup();
      if (activePreviewMapId !== id) return;

      activePreviewMapId = null;
      activePreviewMapPosted = false;
      const previewMaps: PreviewMaps = {};
      const entries = data.maps as Array<{
        mapType: MapType;
        width: number;
        height: number;
        data: ArrayBuffer;
      }>;
      for (const entry of entries) {
        previewMaps[entry.mapType] = {
          width: entry.width,
          height: entry.height,
          data: entry.data,
        };
      }
      set({ previewMaps });
    } else if (data.type === 'error' && data.id === id) {
      cleanup();
      if (activePreviewMapId !== id) return;

      activePreviewMapId = null;
      activePreviewMapPosted = false;
      set({ previewMaps: {}, error: data.error });
    }
  };

  const cleanup = () => {
    worker.removeEventListener('message', onMessage);
  };

  worker.addEventListener('message', onMessage);
  activePreviewMapPosted = true;
  worker.postMessage(
    {
      type: 'build-maps',
      id,
      heights,
      width: depth.width,
      height: depth.height,
      resolution: depth.width,
      mapRequests: requests,
    },
    [heights.buffer],
  );
}

export function bakeMapsInWorker(
  depth: DepthResult,
  maps: MapParams,
): Promise<Record<string, BakedMapData>> {
  const requests = getMapRequests(maps);
  if (requests.length === 0) return Promise.resolve({});

  const worker = getMeshWorker();
  const id = crypto.randomUUID();
  const heights = depth.data.slice();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'maps-result' && data.id === id) {
        cleanup();
        const result: Record<string, BakedMapData> = {};
        const entries = data.maps as Array<{
          mapType: MapType;
          width: number;
          height: number;
          data: ArrayBuffer;
        }>;
        for (const entry of entries) {
          result[entry.mapType] = {
            width: entry.width,
            height: entry.height,
            data: entry.data,
          };
        }
        resolve(result);
      } else if (data.type === 'error' && data.id === id) {
        cleanup();
        reject(new Error(data.error));
      }
    };

    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Map worker failed'));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(
      {
        type: 'build-maps',
        id,
        heights,
        width: depth.width,
        height: depth.height,
        resolution: depth.width,
        mapRequests: requests,
      },
      [heights.buffer],
    );
  });
}

function decodeLegacyImage(value: string): Blob {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes]);
}

type StoredDepthData = NonNullable<ProjectData['depthCache']>['data'];

function copyStoredDepthData(data: StoredDepthData): Float32Array | null {
  if (data instanceof Float32Array) return new Float32Array(data);
  if (data instanceof ArrayBuffer) return new Float32Array(data);
  if (Array.isArray(data)) return Float32Array.from(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as unknown as ArrayBufferView;
    return new Float32Array(view.buffer, view.byteOffset, view.byteLength / 4);
  }
  return null;
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
  capability: 'unavailable',

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
  previewMaps: {},

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
    clearMeshDebounce();
    clearReliefDebounce();
    if (depthWorker) cancelDepthEstimation(depthWorker);
    if (meshWorker) {
      cancelPreviewMapGeneration(meshWorker);
      cancelHeightmapExtraction(meshWorker);
      cancelMeshGeneration(meshWorker);
    }
    const previous = get();
    const url = URL.createObjectURL(file);
    const bitmap = await createImageBitmap(
      await fetch(url).then((r) => r.blob())
    );
    previous.imageBitmap?.close();
    if (previous.imageUrl) URL.revokeObjectURL(previous.imageUrl);

    const state = get();
    const cap = await detectCapability();

    set({
      image: file,
      imageUrl: url,
      imageBitmap: bitmap,
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
      depthResult: null,
      meshResult: null,
      viewportInfo: null,
      previewMaps: {},
      isProcessing: true,
      processingMessage: state.mode === 'ai' ? 'Initializing AI depth estimation...' : 'Generating heightmap...',
      error: null,
      capability: cap,
    });

    if (state.mode === 'relief') {
      requestHeightmapExtraction(bitmap, state.relief, set);
    } else if (state.mode === 'ai') {
      requestDepthEstimation(bitmap, state.ai.invert, set);
    }
  },

  setMode: async (mode: Mode) => {
    clearMeshDebounce();
    clearReliefDebounce();
    if (depthWorker) cancelDepthEstimation(depthWorker);
    if (meshWorker) {
      cancelPreviewMapGeneration(meshWorker);
      cancelHeightmapExtraction(meshWorker);
      cancelMeshGeneration(meshWorker);
    }
    const state = get();
    const cap = await detectCapability();
    set({ mode, isProcessing: true, processingMessage: mode === 'ai' ? 'Running AI depth estimation...' : 'Regenerating depth...', capability: cap });

    if (mode === 'relief' && state.imageBitmap) {
      requestHeightmapExtraction(state.imageBitmap, state.relief, set);
    } else if (mode === 'ai' && state.imageBitmap) {
      requestDepthEstimation(state.imageBitmap, state.ai.invert, set);
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
    if (get().depthResult) {
      set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
      scheduleMeshGeneration(set);
    }
  },

  setSmoothing: (s: number) => {
    set({ smoothing: s });
    if (get().depthResult) {
      set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
      scheduleMeshGeneration(set);
    }
  },

  setReliefParams: (p: Partial<ReliefParams>) => {
    set((s) => ({ relief: { ...s.relief, ...p } }));
    if (get().mode === 'relief' && get().imageBitmap) {
      set({ isProcessing: true, processingMessage: 'Regenerating heightmap...' });
      scheduleHeightmapExtraction(set);
    }
  },

  setAiParams: (p: Partial<AiParams>) => {
    const previousInvert = get().ai.invert;
    set((s) => ({ ai: { ...s.ai, ...p } }));
    const state = get();
    if (state.mode === 'ai' && state.imageBitmap) {
      if (p.invert !== undefined && p.invert !== previousInvert) {
        set({ isProcessing: true, processingMessage: 'Re-running AI depth estimation...' });
        requestDepthEstimation(state.imageBitmap, p.invert, set);
      } else if (state.depthResult) {
        set({ isProcessing: true, processingMessage: 'Rebuilding mesh...' });
        requestMeshGeneration(state.depthResult.data, state.depthResult.width, state.depthResult.height, get(), set);
      }
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

  refreshPreviewMaps: () => {
    const state = get();
    if (!state.depthResult || state.materialMode !== 'pbr') {
      if (meshWorker) cancelPreviewMapGeneration(meshWorker);
      set({ previewMaps: {} });
      return;
    }
    requestPreviewMaps(state.depthResult, state.maps, set);
  },

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

  probeCapability: async () => {
    set({ capability: await detectCapability() });
  },

  clearProject: () => {
    const s = get();
    clearMeshDebounce();
    clearReliefDebounce();
    if (meshWorker) cancelMeshGeneration(meshWorker);
    s.imageBitmap?.close();
    if (depthWorker) cancelDepthEstimation(depthWorker);
    if (meshWorker) {
      cancelPreviewMapGeneration(meshWorker);
      cancelHeightmapExtraction(meshWorker);
    }
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
      previewMaps: {},
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
    const timestamp = new Date().toISOString();

    const project: ProjectData = {
      id: s.projectId,
      name: s.projectName,
      createdAt: timestamp,
      updatedAt: timestamp,
      imageBlob: s.image ?? undefined,
      imageName: s.image?.name,
      imageWidth: s.imageWidth || undefined,
      imageHeight: s.imageHeight || undefined,
      params: getProjectParams(s),
      depthCache: s.depthResult
        ? {
            width: s.depthResult.width,
            height: s.depthResult.height,
            data: new Float32Array(s.depthResult.data),
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
    s.imageBitmap?.close();
    if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);

    let imageBitmap: ImageBitmap | null = null;
    let image: File | null = null;
    let imageUrl: string | null = null;
    let imageBlob: Blob | undefined = project.imageBlob;
    let migrated = project.imageDataBase64 !== undefined;
    let loadError: string | null = null;

    if (!imageBlob && project.imageDataBase64) {
      try {
        imageBlob = decodeLegacyImage(project.imageDataBase64);
        migrated = true;
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
      }
    }

    if (imageBlob) {
      try {
        image = new File(
          [imageBlob],
          project.imageName ?? `${project.name}.png`,
          { type: imageBlob.type },
        );
        imageUrl = URL.createObjectURL(imageBlob);
        imageBitmap = await createImageBitmap(imageBlob);
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
        image = null;
        imageUrl = null;
        imageBitmap = null;
      }
    }

    let depthResult: DepthResult | null = null;
    if (project.depthCache) {
      const depthData = copyStoredDepthData(project.depthCache.data);
      if (depthData && depthData.length === project.depthCache.width * project.depthCache.height) {
        depthResult = {
          width: project.depthCache.width,
          height: project.depthCache.height,
          data: depthData,
        };
        if (Array.isArray(project.depthCache.data)) migrated = true;
      } else {
        loadError = 'Project depth cache has an invalid size or format';
      }
    }

    if (migrated && imageBlob) {
      const upgraded: ProjectData = {
        ...project,
        imageBlob,
        imageDataBase64: undefined,
        depthCache: project.depthCache && depthResult
          ? {
              width: depthResult.width,
              height: depthResult.height,
              data: new Float32Array(depthResult.data),
            }
          : undefined,
      };
      await db.put(STORE_NAME, upgraded);
    }

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
      previewMaps: {},
      error: loadError,
      ...project.params,
    });

    const cap = await detectCapability();
    set({ capability: cap });

    if (depthResult) {
      set({ isProcessing: true, processingMessage: 'Building mesh...' });
      requestMeshGeneration(depthResult.data, depthResult.width, depthResult.height, get(), set);
    } else if (project.params.mode === 'ai' && imageBitmap) {
      // No cached depth for AI mode, need to re-run estimation
      set({ isProcessing: true, processingMessage: 'Running AI depth estimation...' });
      requestDepthEstimation(imageBitmap, project.params.ai.invert, set);
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
