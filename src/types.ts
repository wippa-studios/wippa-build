export type Mode = 'ai' | 'relief';

export type MeshStyle = 'plane' | 'plate';

export type ExportFormat = 'glb' | 'gltf' | 'obj' | 'stl' | 'maps-zip';

export type MaterialMode = 'shaded' | 'textured' | 'pbr' | 'normals' | 'wire' | 'depth';

export type ReliefSource = 'luma' | 'invLuma' | 'alpha';

export type RoughnessMode = 'constant' | 'fromLuma';

export type AxisConvention = 'gltf' | 'unity' | 'unreal';

export type Unit = 'm' | 'cm' | 'mm' | 'unitless';

export type TexturePacking = 'individual' | 'ormo' | 'ue';

export type MapType = 'normal' | 'ao' | 'roughness' | 'height';

export type DeviceCapability = 'webgpu' | 'wasm' | 'unavailable';

export interface DepthResult {
  width: number;
  height: number;
  data: Float32Array;
}

export interface DepthProvider {
  readonly id: string;
  init(): Promise<void>;
  estimate(bitmap: ImageBitmap, signal: AbortSignal): Promise<DepthResult>;
  dispose(): Promise<void>;
}

export interface MeshBuildInput {
  heights: Float32Array;
  width: number;
  height: number;
  resolution: number;
  depthScale: number;
  smoothing: number;
  style: MeshStyle;
  baseThickness: number;
}

export interface MeshBuildResult {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

export interface MapBakeInput {
  heights: Float32Array;
  width: number;
  height: number;
  resolution: number;
  mapType: MapType;
  strength?: number;
  flipY?: boolean;
}

export interface MapBakeResult {
  imageData: ImageData;
  mapType: MapType;
}

export interface ExportOptions {
  format: ExportFormat;
  axisConvention: AxisConvention;
  includeTextures: boolean;
  texturePacking: TexturePacking;
  units: Unit;
  scale: number;
}

export interface ReliefParams {
  source: ReliefSource;
  gamma: number;
  contrast: number;
}

export interface AiParams {
  invert: boolean;
}

export interface MeshParams {
  style: MeshStyle;
  baseThickness: number;
}

export interface MapParams {
  normal: { enabled: boolean; strength: number; flipY: boolean };
  ao: { enabled: boolean; intensity: number };
  roughness: { mode: RoughnessMode; value: number };
  height: { enabled: boolean };
}

export interface TilingParams {
  enabled: boolean;
  tilesX: number;
  tilesY: number;
}

export interface UnitParams {
  scale: number;
  unit: Unit;
}

export interface ProjectParams {
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
}

export interface ProjectData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  imageDataBase64?: string;
  imageWidth?: number;
  imageHeight?: number;
  params: ProjectParams;
  depthCache?: { width: number; height: number; data: number[] };
}

export interface ViewportInfo {
  triangleCount: number;
  dimensions: { width: number; height: number; depth: number };
  vertexCount: number;
}
