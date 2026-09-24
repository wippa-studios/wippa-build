/// <reference lib="webworker" />

import { createCancellationRegistry } from '../../lib/workers/cancellation';

const DEPTH_MODEL_ID = 'onnx-community/depth-anything-v2-small-ONNX';

type Device = 'webgpu' | 'wasm' | 'none';

type RawImageLike = {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
};

type RawImageFactory = {
  fromCanvas: (canvas: OffscreenCanvas) => RawImageLike;
};

type DepthPipeline = ((input: RawImageLike) => Promise<{
  depth: RawImageLike;
}>) & {
  dispose?: () => Promise<void> | void;
};

type InitResult = {
  success: boolean;
  device: Device;
  error?: string;
};

type WorkerMessage =
  | { type: 'init' }
  | {
      type: 'estimate';
      id: string;
      image: ImageBitmap;
      width: number;
      height: number;
      invert: boolean;
    }
  | { type: 'cancel'; id: string }
  | { type: 'dispose' };

let pipeline: DepthPipeline | null = null;
let rawImageFactory: RawImageFactory | null = null;
let device: Device = 'none';
let initialization: Promise<InitResult> | null = null;
const cancelledIds = createCancellationRegistry();

async function loadPipeline(): Promise<InitResult> {
  try {
    const { pipeline: createPipeline, RawImage } = await import('@huggingface/transformers');
    rawImageFactory = RawImage as unknown as RawImageFactory;

    try {
      const candidate = await createPipeline(
        'depth-estimation',
        DEPTH_MODEL_ID,
        { device: 'webgpu' },
      );
      pipeline = candidate as unknown as DepthPipeline;
      device = 'webgpu';
      return { success: true, device };
    } catch (webgpuError) {
      try {
        const candidate = await createPipeline(
          'depth-estimation',
          DEPTH_MODEL_ID,
          { device: 'wasm' },
        );
        pipeline = candidate as unknown as DepthPipeline;
        device = 'wasm';
        return { success: true, device };
      } catch (wasmError) {
        const message = wasmError instanceof Error ? wasmError.message : String(wasmError);
        const webgpuMessage = webgpuError instanceof Error ? webgpuError.message : String(webgpuError);
        return {
          success: false,
          device: 'none',
          error: `WebGPU and WASM both failed. WebGPU: ${webgpuMessage}; WASM: ${message}`,
        };
      }
    }
  } catch (error) {
    return {
      success: false,
      device: 'none',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function initializePipeline(): Promise<InitResult> {
  if (pipeline) return { success: true, device };
  if (!initialization) {
    initialization = loadPipeline().catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

function bilinearResample(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const dst = new Float32Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = y * yRatio;
    const y0 = Math.min(Math.floor(srcY), srcH - 1);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const yLerp = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const x0 = Math.min(Math.floor(srcX), srcW - 1);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const xLerp = srcX - x0;

      const v00 = src[y0 * srcW + x0];
      const v10 = src[y0 * srcW + x1];
      const v01 = src[y1 * srcW + x0];
      const v11 = src[y1 * srcW + x1];

      const top = v00 + (v10 - v00) * xLerp;
      const bottom = v01 + (v11 - v01) * xLerp;
      dst[y * dstW + x] = top + (bottom - top) * yLerp;
    }
  }

  return dst;
}

async function handleInit(): Promise<void> {
  const result = await initializePipeline();
  self.postMessage({ type: 'init-result', ...result });
}

async function handleEstimate(
  id: string,
  image: ImageBitmap,
  targetW: number,
  targetH: number,
  invert: boolean,
): Promise<void> {
  if (!pipeline || !rawImageFactory) {
    image.close();
    self.postMessage({ type: 'error', id, error: 'Pipeline not initialized' });
    return;
  }

  if (cancelledIds.consume(id)) {
    image.close();
    return;
  }

  try {
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for depth input');
    ctx.drawImage(image, 0, 0, targetW, targetH);
    const rawImage = rawImageFactory.fromCanvas(canvas);
    const result = await pipeline(rawImage);

    if (cancelledIds.consume(id)) return;

    const depthData = result.depth;
    const depthPixels = depthData.data;
    const modelW = depthData.width;
    const modelH = depthData.height;
    const pixelCount = modelW * modelH;
    const normalized = new Float32Array(pixelCount);
    const channels = depthData.channels || (depthPixels.length === pixelCount * 4 ? 4 : 1);
    const rgba = channels === 4;

    for (let i = 0; i < pixelCount; i++) {
      const value = depthPixels[rgba ? i * 4 : i] / 255;
      normalized[i] = invert ? 1 - value : value;
    }

    const resampled =
      modelW === targetW && modelH === targetH
        ? normalized
        : bilinearResample(normalized, modelW, modelH, targetW, targetH);

    if (cancelledIds.consume(id)) return;

    self.postMessage(
      { type: 'depth-result', id, width: targetW, height: targetH, data: resampled.buffer, device },
      [resampled.buffer],
    );
  } catch (error) {
    if (cancelledIds.consume(id)) return;
    self.postMessage({
      type: 'error',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    image.close();
  }
}

function handleCancel(id: string): void {
  cancelledIds.mark(id);
}

async function handleDispose(): Promise<void> {
  if (pipeline?.dispose) {
    await pipeline.dispose();
  }
  pipeline = null;
  rawImageFactory = null;
  device = 'none';
  initialization = null;
  cancelledIds.clear();
  self.postMessage({ type: 'disposed' });
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'init':
      void handleInit();
      break;
    case 'estimate':
      void handleEstimate(message.id, message.image, message.width, message.height, message.invert);
      break;
    case 'cancel':
      handleCancel(message.id);
      break;
    case 'dispose':
      void handleDispose();
      break;
  }
};
