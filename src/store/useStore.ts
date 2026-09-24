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
const MAX_INPUT_DIMENSION = 4096;
const MAX_INPUT_FILE_BYTES = 100 * 1024 * 1024;

type ImageDimensions = { width: number; height: number };

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function inspectImageDimensions(bytes: Uint8Array, type: string): ImageDimensions | null {
  if (type === 'image/png' && bytes.length >= 24) {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (signature.every((value, index) => bytes[index] === value)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
  }

  if (type === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker === 0xda) break;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xc3 || marker >= 0xc5 && marker <= 0xc7 || marker >= 0xc9 && marker <= 0xcb || marker >= 0xcd && marker <= 0xcf;
      if (isStartOfFrame) {
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      if (segmentLength < 2) break;
      offset += segmentLength;
    }
  }

  if (type === 'image/webp' && bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') {
      return {
        width: readUint24LE(bytes, 24) + 1,
        height: readUint24LE(bytes, 27) + 1,
      };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
        height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
  }

  return null;
}

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
  getOperationGeneration: () => number;
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
let mapWorker: Worker | null = null;
let previewMapWorker: Worker | null = null;
let depthWorker: Worker | null = null;
let depthInitPromise: Promise<DepthInitResult> | null = null;
let activeDepthRequestId: string | null = null;
let activePreviewMapId: string | null = null;
let activePreviewMapCleanup: (() => void) | null = null;
let activeHeightmapRequestId: string | null = null;
let activeHeightmapPosted = false;
let activeMeshRequestId: string | null = null;
let activeMeshRequestPosted = false;
let activeMeshCleanup: (() => void) | null = null;
let meshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let reliefDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let previewMapDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let errorTimeout: ReturnType<typeof setTimeout> | null = null;
let operationGeneration = 0;
let saveRevision = 0;
let saveQueue: Promise<void> = Promise.resolve();

function invalidateOperations(): number {
  operationGeneration += 1;
  saveRevision += 1;
  clearMeshDebounce();
  clearReliefDebounce();
  clearPreviewMapDebounce();
  if (depthWorker) cancelDepthEstimation(depthWorker);
  if (previewMapWorker) disposePreviewMapWorker();
  const currentMeshWorker = meshWorker;
  if (currentMeshWorker) {
    cancelHeightmapExtraction(currentMeshWorker);
    if (meshWorker === currentMeshWorker) cancelMeshGeneration(currentMeshWorker);
  }
  return operationGeneration;
}

function getMeshWorker(): Worker {
  if (!meshWorker) {
    meshWorker = new Worker(
      new URL('../workers/mesh/mesh.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return meshWorker;
}

function getMapWorker(): Worker {
  if (!mapWorker) {
    mapWorker = new Worker(
      new URL('../workers/mesh/mesh.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return mapWorker;
}

function getPreviewMapWorker(): Worker {
  if (!previewMapWorker) {
    previewMapWorker = new Worker(
      new URL('../workers/mesh/mesh.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return previewMapWorker;
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
      if (depthWorker === worker) {
        worker.terminate();
        depthWorker = null;
        depthInitPromise = null;
      }
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
  if (activeDepthRequestId) {
    worker.terminate();
    if (depthWorker === worker) {
      depthWorker = null;
      depthInitPromise = null;
    }
  }
  activeDepthRequestId = null;
}

function requestDepthEstimation(
  bitmap: ImageBitmap,
  invert: boolean,
  set: (partial: SetState) => void,
  generation = operationGeneration,
): void {
  if (depthWorker) cancelDepthEstimation(depthWorker);
  const worker = getDepthWorker();

  const id = crypto.randomUUID();
  activeDepthRequestId = id;

  void (async () => {
    let initResult: DepthInitResult;
    try {
      initResult = await ensureDepthInitialized(worker);
    } catch (error) {
      if (activeDepthRequestId === id) {
        activeDepthRequestId = null;
              set({
          isProcessing: false,
          processingMessage: '',
          error: error instanceof Error ? error.message : String(error),
          capability: 'unavailable',
        });
      }
      return;
    }

    if (generation !== operationGeneration || activeDepthRequestId !== id) return;

    let image: ImageBitmap;
    try {
      image = await createImageBitmap(bitmap);
    } catch (error) {
      if (activeDepthRequestId === id) {
        activeDepthRequestId = null;
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
        if (generation !== operationGeneration || activeDepthRequestId !== id) return;

        activeDepthRequestId = null;
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
        if (generation !== operationGeneration || activeDepthRequestId !== id) return;

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
      worker.removeEventListener('error', onError);
    };

    const onError = (event: ErrorEvent) => {
      image.close();
      if (depthWorker === worker) {
        worker.terminate();
        depthWorker = null;
        depthInitPromise = null;
      }
      onMessage({
        data: {
          type: 'error',
          id,
          error: event.message || 'Depth worker failed',
        },
      } as MessageEvent);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
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
    worker.terminate();
    if (meshWorker === worker) meshWorker = null;
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
  generation = operationGeneration,
): void {
  if (meshWorker) cancelHeightmapExtraction(meshWorker);
  const worker = getMeshWorker();

  const id = crypto.randomUUID();
  activeHeightmapRequestId = id;

  void (async () => {
    let image: ImageBitmap;
    try {
      image = await createImageBitmap(bitmap);
    } catch (error) {
      if (generation === operationGeneration && activeHeightmapRequestId === id) {
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

    if (generation !== operationGeneration || activeHeightmapRequestId !== id) {
      image.close();
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'heightmap-result' && data.id === id) {
        cleanup();
        if (generation !== operationGeneration || activeHeightmapRequestId !== id) return;

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
        if (generation !== operationGeneration || activeHeightmapRequestId !== id) return;

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
      worker.removeEventListener('error', onError);
    };

    const onError = (event: ErrorEvent) => {
      image.close();
      if (meshWorker === worker) {
        worker.terminate();
        meshWorker = null;
      }
      onMessage({
        data: {
          type: 'error',
          id,
          error: event.message || 'Heightmap worker failed',
        },
      } as MessageEvent);
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
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
    worker.terminate();
    if (meshWorker === worker) meshWorker = null;
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
  const generation = operationGeneration;
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
      generation,
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
  generation = operationGeneration,
): void {
  clearMeshDebounce();
  if (meshWorker) cancelMeshGeneration(meshWorker);
  const worker = getMeshWorker();
  const id = crypto.randomUUID();
  activeMeshRequestId = id;

  const cleanup = () => {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    if (activeMeshCleanup === cleanup) activeMeshCleanup = null;
  };

  const onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data.type === 'mesh-result' && data.id === id) {
      cleanup();
      if (generation !== operationGeneration || activeMeshRequestId !== id) return;

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
      if (generation !== operationGeneration || activeMeshRequestId !== id) return;

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
          generation,
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

  const onError = (event: ErrorEvent) => {
    if (meshWorker === worker) {
      worker.terminate();
      meshWorker = null;
    }
    onMessage({
      data: {
        type: 'error',
        id,
        error: event.message || 'Mesh worker failed',
      },
    } as MessageEvent);
  };

  activeMeshCleanup = cleanup;
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
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

function getPreviewMapRequests(maps: MapParams): PreviewMapRequest[] {
  const requests: PreviewMapRequest[] = [];
  if (maps.normal.enabled) requests.push({ mapType: 'normal', strength: 1, flipY: maps.normal.flipY });
  if (maps.ao.enabled) requests.push({ mapType: 'ao', strength: 1 });
  if (maps.roughness.mode === 'fromLuma') requests.push({ mapType: 'roughness' });
  if (maps.height.enabled) requests.push({ mapType: 'height' });
  return requests;
}

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

function clearPreviewMapDebounce(): void {
  if (previewMapDebounceTimer) {
    clearTimeout(previewMapDebounceTimer);
    previewMapDebounceTimer = null;
  }
}

function disposePreviewMapWorker(): void {
  activePreviewMapCleanup?.();
  activePreviewMapCleanup = null;
  if (previewMapWorker) {
    previewMapWorker.terminate();
    previewMapWorker = null;
  }
  activePreviewMapId = null;
}

function requestPreviewMaps(
  depth: DepthResult,
  maps: MapParams,
  set: (partial: SetState) => void,
  generation = operationGeneration,
): void {
  disposePreviewMapWorker();
  const worker = getPreviewMapWorker();

  const requests = getPreviewMapRequests(maps);

  if (requests.length === 0) {
    disposePreviewMapWorker();
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
      if (generation !== operationGeneration || activePreviewMapId !== id) return;

      activePreviewMapId = null;
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
      if (generation !== operationGeneration || activePreviewMapId !== id) return;

      activePreviewMapId = null;
          set({ previewMaps: {}, error: data.error });
    }
  };

  const cleanup = () => {
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    clearTimeout(timeout);
    if (activePreviewMapCleanup === cleanup) activePreviewMapCleanup = null;
  };

  const onError = (event: ErrorEvent) => {
    if (previewMapWorker === worker) {
      worker.terminate();
      previewMapWorker = null;
    }
    onMessage({
      data: {
        type: 'error',
        id,
        error: event.message || 'Preview map worker failed',
      },
    } as MessageEvent);
  };

  const timeout = setTimeout(() => {
    const wasCurrent = generation === operationGeneration && activePreviewMapId === id;
    cleanup();
    disposePreviewMapWorker();
    if (wasCurrent) {
      set({ previewMaps: {}, error: 'PBR preview maps timed out. Try a lower mesh resolution.' });
    }
  }, 120_000);

  activePreviewMapCleanup = cleanup;
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
}

function schedulePreviewMapRefresh(set: (partial: SetState) => void): void {
  clearPreviewMapDebounce();
  const generation = operationGeneration;
  previewMapDebounceTimer = setTimeout(() => {
    previewMapDebounceTimer = null;
    const state = useStore.getState();
    if (generation !== operationGeneration || state.materialMode !== 'pbr' || !state.depthResult) return;
    requestPreviewMaps(state.depthResult, state.maps, set, generation);
  }, 150);
}

export function bakeMapsInWorker(
  depth: DepthResult,
  maps: MapParams,
): Promise<Record<string, BakedMapData>> {
  const requests = getMapRequests(maps);
  if (requests.length === 0) return Promise.resolve({});

  const worker = getMapWorker();
  const id = crypto.randomUUID();
  const heights = depth.data.slice();

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      clearTimeout(timeout);
    };

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'maps-result' && data.id === id) {
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
        settle(() => resolve(result));
      } else if (data.type === 'error' && data.id === id) {
        settle(() => reject(new Error(data.error)));
      }
    };

    const onError = (event: ErrorEvent) => {
      if (mapWorker === worker) {
        worker.terminate();
        mapWorker = null;
      }
      settle(() => reject(new Error(event.message || 'Map worker failed')));
    };

    const timeout = setTimeout(() => {
      worker.postMessage({ type: 'cancel', id });
      if (mapWorker === worker) {
        worker.terminate();
        mapWorker = null;
      }
      settle(() => reject(new Error('PBR map baking timed out. Try a lower mesh resolution.')));
    }, 120_000);

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
    if (!file.type.startsWith('image/')) {
      set({ isProcessing: false, error: 'Please choose a PNG, JPEG, or WebP image.' });
      return;
    }
    if (file.size > MAX_INPUT_FILE_BYTES) {
      set({ isProcessing: false, error: 'Images must be 100 MB or smaller.' });
      return;
    }

    const generation = invalidateOperations();
    const previous = get();
    const url = URL.createObjectURL(file);
    let bitmap: ImageBitmap | null = null;

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const dimensions = inspectImageDimensions(bytes, file.type);
      if (!dimensions) throw new Error('Unsupported image format. Use PNG, JPEG, or WebP.');
      if (dimensions.width > MAX_INPUT_DIMENSION || dimensions.height > MAX_INPUT_DIMENSION) {
        throw new Error(`Images must be ${MAX_INPUT_DIMENSION} × ${MAX_INPUT_DIMENSION} pixels or smaller.`);
      }
      bitmap = await createImageBitmap(new Blob([bytes], { type: file.type }));
      if (generation !== operationGeneration) {
        bitmap.close();
        URL.revokeObjectURL(url);
        return;
      }

      const state = get();
      const cap = await detectCapability();
      if (generation !== operationGeneration) {
        bitmap.close();
        URL.revokeObjectURL(url);
        return;
      }

      previous.imageBitmap?.close();
      if (previous.imageUrl) URL.revokeObjectURL(previous.imageUrl);

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
        requestHeightmapExtraction(bitmap, state.relief, set, generation);
      } else if (state.mode === 'ai') {
        requestDepthEstimation(bitmap, state.ai.invert, set, generation);
      }
    } catch (error) {
      URL.revokeObjectURL(url);
      bitmap?.close();
      if (generation === operationGeneration) {
        set({
          isProcessing: false,
          processingMessage: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  },

  setMode: async (mode: Mode) => {
    const generation = invalidateOperations();
    const state = get();
    const cap = await detectCapability();
    if (generation !== operationGeneration) return;

    set({
      mode,
      depthResult: null,
      meshResult: null,
      viewportInfo: null,
      isProcessing: true,
      processingMessage: mode === 'ai' ? 'Running AI depth estimation...' : 'Regenerating depth...',
      capability: cap,
    });

    if (mode === 'relief' && state.imageBitmap) {
      requestHeightmapExtraction(state.imageBitmap, state.relief, set, generation);
    } else if (mode === 'ai' && state.imageBitmap) {
      requestDepthEstimation(state.imageBitmap, state.ai.invert, set, generation);
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
    invalidateOperations();
    set((s) => ({ relief: { ...s.relief, ...p } }));
    if (get().mode === 'relief' && get().imageBitmap) {
      set({
        depthResult: null,
        meshResult: null,
        viewportInfo: null,
        isProcessing: true,
        processingMessage: 'Regenerating heightmap...',
      });
      scheduleHeightmapExtraction(set);
    }
  },

  setAiParams: (p: Partial<AiParams>) => {
    const previousInvert = get().ai.invert;
    const invertChanged = p.invert !== undefined && p.invert !== previousInvert;
    const nextInvert = p.invert ?? previousInvert;
    const generation = invertChanged ? invalidateOperations() : operationGeneration;
    set((s) => ({ ai: { ...s.ai, ...p } }));
    const state = get();
    if (state.mode === 'ai' && state.imageBitmap) {
      if (invertChanged) {
        set({
          depthResult: null,
          meshResult: null,
          viewportInfo: null,
          isProcessing: true,
          processingMessage: 'Re-running AI depth estimation...',
        });
        requestDepthEstimation(state.imageBitmap, nextInvert, set, generation);
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
      clearPreviewMapDebounce();
      disposePreviewMapWorker();
      set({ previewMaps: {} });
      return;
    }
    schedulePreviewMapRefresh(set);
  },

  setProcessing: (v: boolean, msg?: string) => set({ isProcessing: v, processingMessage: msg ?? '' }),
  getOperationGeneration: () => operationGeneration,

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
    invalidateOperations();
    const s = get();
    s.imageBitmap?.close();
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
    if (s.isProcessing || !s.depthResult) {
      set({ error: 'Wait for the current image and depth calculation to finish before saving.' });
      return;
    }

    const revision = ++saveRevision;
    const generation = operationGeneration;
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
      depthCache: {
        width: s.depthResult.width,
        height: s.depthResult.height,
        data: new Float32Array(s.depthResult.data),
      },
    };

    const write = saveQueue.then(async () => {
      if (revision !== saveRevision || generation !== operationGeneration) return;
      const db = await getDB();
      if (revision !== saveRevision || generation !== operationGeneration) return;
      await db.put(STORE_NAME, project);
    });
    saveQueue = write.catch(() => undefined);

    try {
      await write;
    } catch (error) {
      if (revision === saveRevision && generation === operationGeneration) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    }
  },

  loadProject: async (id: string) => {
    const generation = invalidateOperations();
    await saveQueue;
    if (generation !== operationGeneration) return;
    const db = await getDB();
    const project = (await db.get(STORE_NAME, id)) as ProjectData | undefined;
    if (!project || generation !== operationGeneration) return;

    const s = get();

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
        const imageType = imageBlob.type || (project.imageName?.toLowerCase().endsWith('.jpg') || project.imageName?.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png');
        const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
        const dimensions = inspectImageDimensions(imageBytes, imageType);
        if (!dimensions) throw new Error('Saved project image has an unsupported format.');
        if (dimensions.width > MAX_INPUT_DIMENSION || dimensions.height > MAX_INPUT_DIMENSION) {
          throw new Error(`Saved project images must be ${MAX_INPUT_DIMENSION} × ${MAX_INPUT_DIMENSION} pixels or smaller.`);
        }
        image = new File(
          [imageBlob],
          project.imageName ?? `${project.name}.png`,
          { type: imageType },
        );
        imageUrl = URL.createObjectURL(imageBlob);
        imageBitmap = await createImageBitmap(imageBlob);
        if (generation !== operationGeneration) {
          imageBitmap.close();
          URL.revokeObjectURL(imageUrl);
          return;
        }
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
        imageBitmap?.close();
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        image = null;
        imageUrl = null;
        imageBitmap = null;
      }
    }

    let depthResult: DepthResult | null = null;
    if (project.depthCache) {
      try {
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
      } catch (error) {
        loadError = error instanceof Error ? error.message : 'Project depth cache has an invalid format';
      }
    }

    if (migrated) {
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
      const migrationRevision = saveRevision;
      const migrationWrite = saveQueue.then(async () => {
        if (generation !== operationGeneration || migrationRevision !== saveRevision) return;
        const migrationDb = await getDB();
        if (generation !== operationGeneration || migrationRevision !== saveRevision) return;
        await migrationDb.put(STORE_NAME, upgraded);
      });
      saveQueue = migrationWrite.catch(() => undefined);
      try {
        await migrationWrite;
      } catch (error) {
        loadError = error instanceof Error ? error.message : 'Project migration could not be saved';
      }
      if (generation !== operationGeneration) {
        imageBitmap?.close();
        if (imageUrl) URL.revokeObjectURL(imageUrl);
        return;
      }
    }

    if (generation !== operationGeneration) {
      imageBitmap?.close();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      return;
    }

    s.imageBitmap?.close();
    if (s.imageUrl) URL.revokeObjectURL(s.imageUrl);

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
      isProcessing: false,
      processingMessage: '',
      error: loadError,
      ...project.params,
    });

    const cap = await detectCapability();
    if (generation !== operationGeneration) return;
    set({ capability: cap });

    if (depthResult) {
      set({ isProcessing: true, processingMessage: 'Building mesh...' });
      requestMeshGeneration(depthResult.data, depthResult.width, depthResult.height, get(), set, generation);
    } else if (project.params.mode === 'ai' && imageBitmap) {
      // No cached depth for AI mode, need to re-run estimation
      set({ isProcessing: true, processingMessage: 'Running AI depth estimation...' });
      requestDepthEstimation(imageBitmap, project.params.ai.invert, set, generation);
    } else if (project.params.mode === 'relief' && imageBitmap) {
      set({ isProcessing: true, processingMessage: 'Regenerating heightmap...' });
      requestHeightmapExtraction(imageBitmap, project.params.relief, set, generation);
    }
  },

  listProjects: async () => {
    const db = await getDB();
    const projects = await db.getAll(STORE_NAME);
    set({ projects });
    return projects;
  },

  deleteProject: async (id: string) => {
    saveRevision += 1;
    await saveQueue;
    const db = await getDB();
    await db.delete(STORE_NAME, id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
    }));
  },
}));
