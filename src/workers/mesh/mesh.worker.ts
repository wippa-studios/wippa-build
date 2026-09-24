import type { MapType, MeshBuildInput, ReliefSource } from '../../types';
import { createCancellationRegistry } from '../../lib/workers/cancellation';
import { buildPlaneMesh, buildPlateMesh } from '../../lib/mesh/MeshBuilder';
import { createHeightmapFromImageData, gaussianBlur } from '../../lib/mesh/HeightMap';
import { bakeMap } from '../../lib/maps/MapBaker';

type MapRequest = {
  mapType: MapType;
  strength?: number;
  flipY?: boolean;
};

type WorkerMessage =
  | { type: 'build-mesh'; id: string; input: MeshBuildInput }
  | {
      type: 'extract-heightmap';
      id: string;
      image: ImageBitmap;
      source: ReliefSource;
      gamma: number;
      contrast: number;
    }
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

const cancelled = createCancellationRegistry();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'cancel': {
      cancelled.mark(message.id);
      break;
    }

    case 'build-mesh': {
      const { id, input } = message;

      if (cancelled.consume(id)) break;

      try {
        const heights = input.smoothing > 0
          ? gaussianBlur(input.heights, input.width, input.height, input.smoothing)
          : input.heights;
        const buildInput: MeshBuildInput = { ...input, heights };
        const result = input.style === 'plate'
          ? buildPlateMesh(buildInput)
          : buildPlaneMesh(buildInput);

        if (cancelled.consume(id)) break;
        self.postMessage({ type: 'mesh-result', id, result });
      } catch (error) {
        if (cancelled.consume(id)) break;
        self.postMessage({
          type: 'error',
          id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }

    case 'extract-heightmap': {
      const { id, image, source, gamma, contrast } = message;
      if (cancelled.consume(id)) {
        image.close();
        break;
      }

      try {
        const width = image.width;
        const height = image.height;
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Failed to get 2D context for heightmap extraction');
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const heights = createHeightmapFromImageData(imageData, source, gamma, contrast);
        image.close();

        if (cancelled.consume(id)) break;
        self.postMessage(
          { type: 'heightmap-result', id, width, height, data: heights.buffer },
          [heights.buffer],
        );
      } catch (error) {
        image.close();
        if (cancelled.consume(id)) break;
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
      if (cancelled.consume(id)) break;

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

        if (cancelled.consume(id)) break;
        self.postMessage({ type: 'maps-result', id, maps }, transfer);
      } catch (error) {
        if (cancelled.consume(id)) break;
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
