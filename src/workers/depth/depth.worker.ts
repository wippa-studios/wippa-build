/// <reference lib="webworker" />

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipeline: any = null;
const cancelledIds = new Set<string>();

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
  try {
    const { pipeline: createPipeline } = await import("@huggingface/transformers");

    let device = "webgpu";
    try {
      pipeline = await createPipeline(
        "depth-estimation",
        "depth-anything/Depth-Anything-V2-Small-hf",
        { device: "webgpu" },
      );
    } catch {
      device = "wasm";
      try {
        pipeline = await createPipeline(
          "depth-estimation",
          "depth-anything/Depth-Anything-V2-Small-hf",
          { device: "wasm" },
        );
      } catch (wasmError) {
        postMessage({
          type: "init-result",
          success: false,
          device: "none",
          error: `WebGPU and WASM both failed. WASM error: ${wasmError instanceof Error ? wasmError.message : String(wasmError)}`,
        });
        return;
      }
    }

    postMessage({ type: "init-result", success: true, device });
  } catch (err) {
    postMessage({
      type: "init-result",
      success: false,
      device: "none",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleEstimate(
  id: string,
  imageData: { width: number; height: number; data: ArrayBuffer },
  invert: boolean,
): Promise<void> {
  if (!pipeline) {
    postMessage({ type: "error", id, error: "Pipeline not initialized" });
    return;
  }

  if (cancelledIds.has(id)) {
    cancelledIds.delete(id);
    return;
  }

  try {
    const pixels = new Uint8ClampedArray(imageData.data);
    const srcImageData = new ImageData(pixels, imageData.width, imageData.height);
    const bitmap = await createImageBitmap(srcImageData);

    const result = await pipeline(bitmap);
    bitmap.close();

    if (cancelledIds.has(id)) {
      cancelledIds.delete(id);
      return;
    }

    const depthData: ImageData | HTMLCanvasElement = result.depth;

    let depthPixels: Uint8ClampedArray;
    let modelW: number;
    let modelH: number;

    if (depthData instanceof HTMLCanvasElement) {
      const ctx = depthData.getContext("2d")!;
      modelW = depthData.width;
      modelH = depthData.height;
      depthPixels = ctx.getImageData(0, 0, modelW, modelH).data;
    } else {
      modelW = (depthData as ImageData).width;
      modelH = (depthData as ImageData).height;
      depthPixels = (depthData as ImageData).data;
    }

    const targetW = imageData.width;
    const targetH = imageData.height;

    let normalized: Float32Array;
    const pixelCount = modelW * modelH;

    if (depthPixels.length === pixelCount) {
      normalized = new Float32Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        normalized[i] = depthPixels[i] / 255;
      }
    } else {
      normalized = new Float32Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        normalized[i] = depthPixels[i * 4] / 255;
      }
    }

    if (invert) {
      for (let i = 0; i < normalized.length; i++) {
        normalized[i] = 1.0 - normalized[i];
      }
    }

    let resampled: Float32Array;
    if (modelW === targetW && modelH === targetH) {
      resampled = normalized;
    } else {
      resampled = bilinearResample(normalized, modelW, modelH, targetW, targetH);
    }

    const buffer = resampled.buffer;
    postMessage(
      { type: "depth-result", id, width: targetW, height: targetH, data: buffer },
      [buffer],
    );
  } catch (err) {
    postMessage({
      type: "error",
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function handleCancel(id: string): void {
  cancelledIds.add(id);
}

function handleDispose(): void {
  if (pipeline) {
    pipeline.dispose();
    pipeline = null;
  }
  cancelledIds.clear();
  postMessage({ type: "disposed" });
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  switch (msg.type) {
    case "init":
      await handleInit();
      break;

    case "estimate":
      await handleEstimate(msg.id, msg.imageData, msg.invert);
      break;

    case "cancel":
      handleCancel(msg.id);
      break;

    case "dispose":
      handleDispose();
      break;
  }
};
