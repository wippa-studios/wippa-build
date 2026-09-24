import type { MapType, MeshBuildInput, MeshBuildResult } from '../../types';
import { buildPlaneMesh, buildPlateMesh } from '../../lib/mesh/MeshBuilder';
import { gaussianBlur } from '../../lib/mesh/HeightMap';
import { bakeMap } from '../../lib/maps/MapBaker';

type MapRequest = {
  mapType: MapType;
  strength?: number;
  flipY?: boolean;
};

type WorkerMessage =
  | { type: 'build-mesh'; id: string; input: MeshBuildInput }
  | {
      type: 'build-maps';
      id: string;
      heights: Float32Array;
      width: number;
      height: number;
      resolution: number;
      mapRequests: MapRequest[];
    }
  | { type: 'cancel'; id: string };

const cancelled = new Set<string>();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'cancel': {
      cancelled.add(message.id);
      break;
    }

    case 'build-mesh': {
      const { id, input } = message;

      if (cancelled.delete(id)) break;

      try {
        const heights = input.smoothing > 0
          ? gaussianBlur(input.heights, input.width, input.height, input.smoothing)
          : input.heights;
        const buildInput: MeshBuildInput = { ...input, heights };
        const result = input.style === 'plate'
          ? buildPlateMesh(buildInput)
          : buildPlaneMesh(buildInput);

        if (cancelled.delete(id)) break;
        self.postMessage({ type: 'mesh-result', id, result });
      } catch (error) {
        if (cancelled.delete(id)) break;
        self.postMessage({
          type: 'error',
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }

    case 'build-maps': {
      const { id, heights, width, height, resolution, mapRequests } = message;
      if (cancelled.delete(id)) break;

      try {
        const maps: Array<{
          mapType: MapType;
          width: number;
          height: number;
          data: ArrayBuffer;
        }> = [];
        const transfer: ArrayBuffer[] = [];

        for (const request of mapRequests) {
          if (cancelled.has(id)) break;

          const { imageData } = bakeMap({
            heights,
            width,
            height,
            resolution,
            mapType: request.mapType,
            strength: request.strength,
            flipY: request.flipY,
          });
          const buffer = imageData.data.buffer;
          maps.push({
            mapType: request.mapType,
            width: imageData.width,
            height: imageData.height,
            data: buffer,
          });
          transfer.push(buffer);
        }

        if (cancelled.delete(id)) break;
        self.postMessage({ type: 'maps-result', id, maps }, transfer);
      } catch (error) {
        if (cancelled.delete(id)) break;
        self.postMessage({
          type: 'error',
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
  }
};
