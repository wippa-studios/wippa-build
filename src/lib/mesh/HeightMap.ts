import type { DepthResult, ReliefParams, ReliefSource } from '../../types';

export function extractLuma(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const count = width * height;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    out[i] =
      (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]) /
      255;
  }
  return out;
}

export function extractAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const count = width * height;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = data[i * 4 + 3] / 255;
  }
  return out;
}

export function applyReliefSource(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  source: ReliefSource,
): Float32Array {
  switch (source) {
    case 'luma':
      return extractLuma(data, width, height);
    case 'alpha':
      return extractAlpha(data, width, height);
    case 'invLuma': {
      const luma = extractLuma(data, width, height);
      const out = new Float32Array(luma.length);
      for (let i = 0; i < luma.length; i++) {
        out[i] = 1 - luma[i];
      }
      return out;
    }
  }
}

export function normalizeHeights(heights: Float32Array): Float32Array {
  const len = heights.length;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < len; i++) {
    const v = heights[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const out = new Float32Array(len);
  if (range === 0) {
    out.fill(0.5);
    return out;
  }
  for (let i = 0; i < len; i++) {
    out[i] = (heights[i] - min) / range;
  }
  return out;
}

export function applyGamma(heights: Float32Array, gamma: number): Float32Array {
  const g = gamma === 0 ? 1 : gamma;
  const invGamma = 1 / g;
  const len = heights.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Math.pow(heights[i], invGamma);
  }
  return out;
}

export function applyContrast(
  heights: Float32Array,
  contrast: number,
): Float32Array {
  const scale = 1 + contrast;
  const len = heights.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Math.min(1, Math.max(0, 0.5 + (heights[i] - 0.5) * scale));
  }
  return out;
}

export function gaussianBlur(
  heights: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return new Float32Array(heights);

  const size = 2 * radius + 1;
  const sigma = radius / 3;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const val = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = val;
    sum += val;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = 0; k < size; k++) {
        const sx = Math.min(width - 1, Math.max(0, x + k - radius));
        v += heights[y * width + sx] * kernel[k];
      }
      tmp[y * width + x] = v;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let k = 0; k < size; k++) {
        const sy = Math.min(height - 1, Math.max(0, y + k - radius));
        v += tmp[sy * width + x] * kernel[k];
      }
      out[y * width + x] = v;
    }
  }

  return out;
}

export function createHeightmapFromImageBitmap(
  bitmap: ImageBitmap,
  resolution: number,
  source: ReliefSource,
  gamma: number,
  contrast: number,
  smoothing: number,
): Float32Array {
  const canvas = new OffscreenCanvas(resolution, resolution);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, resolution, resolution);
  const imageData = ctx.getImageData(0, 0, resolution, resolution);

  let heights = applyReliefSource(
    imageData.data,
    resolution,
    resolution,
    source,
  );
  heights = normalizeHeights(heights);
  heights = applyGamma(heights, gamma);
  heights = applyContrast(heights, contrast);
  heights = gaussianBlur(heights, resolution, resolution, smoothing);

  return heights;
}

export function resampleHeights(
  heights: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Float32Array {
  const out = new Float32Array(dstWidth * dstHeight);
  const scaleX = (srcWidth - 1) / (dstWidth - 1 || 1);
  const scaleY = (srcHeight - 1) / (dstHeight - 1 || 1);

  for (let dy = 0; dy < dstHeight; dy++) {
    const sy = dy * scaleY;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, srcHeight - 1);
    const fy = sy - y0;

    for (let dx = 0; dx < dstWidth; dx++) {
      const sx = dx * scaleX;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const fx = sx - x0;

      const v00 = heights[y0 * srcWidth + x0];
      const v10 = heights[y0 * srcWidth + x1];
      const v01 = heights[y1 * srcWidth + x0];
      const v11 = heights[y1 * srcWidth + x1];

      out[dy * dstWidth + dx] =
        v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy;
    }
  }

  return out;
}
