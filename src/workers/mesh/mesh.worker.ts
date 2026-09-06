import type { MeshBuildInput, MeshBuildResult, MapType } from '../../types';
import { buildPlaneMesh, buildPlateMesh } from '../../lib/mesh/MeshBuilder';
import { gaussianBlur } from '../../lib/mesh/HeightMap';
import {
  bakeNormalMap,
  bakeAOMap,
  bakeRoughnessMap,
  bakeHeightMap,
} from '../../lib/maps/MapBaker';

type WorkerMessage =
  | { type: 'build-mesh'; id: string; input: MeshBuildInput }
  | {
      type: 'build-maps';
      id: string;
      heights: Float32Array;
      width: number;
      height: number;
      resolution: number;
      mapTypes: string[];
    }
  | { type: 'cancel'; id: string };

const cancelled = new Set<string>();

const mapBakers: Record<string, (heights: Float32Array, w: number, h: number) => { imageData: ImageData; mapType: MapType }> = {
  normal: (heights, w, h) => bakeNormalMap({ heights, width: w, height: h, resolution: 0, mapType: 'normal' }),
  ao: (heights, w, h) => bakeAOMap({ heights, width: w, height: h, resolution: 0, mapType: 'ao' }),
  roughness: (heights, w, h) => bakeRoughnessMap({ heights, width: w, height: h, resolution: 0, mapType: 'roughness' }),
  height: (heights, w, h) => bakeHeightMap({ heights, width: w, height: h, resolution: 0, mapType: 'height' }),
};

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'cancel': {
      cancelled.add(msg.id);
      break;
    }

    case 'build-mesh': {
      const { id, input } = msg;

      if (cancelled.has(id)) {
        cancelled.delete(id);
        break;
      }

      try {
        let heights = input.heights;
        if (input.smoothing > 0) {
          heights = gaussianBlur(heights, input.width, input.height, input.smoothing);
        }

        const buildInput: MeshBuildInput = { ...input, heights };
        let result: MeshBuildResult;
        if (input.style === 'plate') {
          result = buildPlateMesh(buildInput);
        } else {
          result = buildPlaneMesh(buildInput);
        }

        if (cancelled.has(id)) {
          cancelled.delete(id);
          break;
        }

        self.postMessage({ type: 'mesh-result', id, result });
      } catch (err) {
        if (cancelled.has(id)) {
          cancelled.delete(id);
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: 'error', id, error: message });
      }
      break;
    }

    case 'build-maps': {
      const { id, heights, width, height, resolution, mapTypes } = msg;

      if (cancelled.has(id)) {
        cancelled.delete(id);
        break;
      }

      try {
        const maps: Array<{ mapType: string; width: number; height: number; data: ArrayBuffer }> = [];
        const transfer: ArrayBuffer[] = [];

        for (const mapType of mapTypes) {
          const baker = mapBakers[mapType];
          if (!baker) continue;

          const { imageData } = baker(heights, width, height);
          const buffer = imageData.data.buffer;

          maps.push({
            mapType,
            width: imageData.width,
            height: imageData.height,
            data: buffer,
          });
          transfer.push(buffer);
        }

        if (cancelled.has(id)) {
          cancelled.delete(id);
          break;
        }

        self.postMessage({ type: 'maps-result', id, maps }, transfer);
      } catch (err) {
        if (cancelled.has(id)) {
          cancelled.delete(id);
          break;
        }
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ type: 'error', id, error: message });
      }
      break;
    }
  }
};
