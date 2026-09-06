import type { MapBakeInput, MapBakeResult, MapType } from '../../types';

function getHeight(heights: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || x >= w || y < 0 || y >= h) return 0;
  return heights[y * w + x];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return [0, 0, 1];
  return [x / len, y / len, z / len];
}

export function bakeNormalMap(input: MapBakeInput): MapBakeResult {
  const { width: w, height: h, heights } = input;
  const strength = input.strength ?? 1.0;
  const flipY = input.flipY ?? false;

  if (w === 0 || h === 0) {
    const imageData = new ImageData(1, 1);
    return { imageData, mapType: 'normal' };
  }

  const out = new ImageData(w, h);
  const data = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = getHeight(heights, w, h, x - 1, y - 1);
      const tc = getHeight(heights, w, h, x, y - 1);
      const tr = getHeight(heights, w, h, x + 1, y - 1);
      const ml = getHeight(heights, w, h, x - 1, y);
      const mr = getHeight(heights, w, h, x + 1, y);
      const bl = getHeight(heights, w, h, x - 1, y + 1);
      const bc = getHeight(heights, w, h, x, y + 1);
      const br = getHeight(heights, w, h, x + 1, y + 1);

      const dhdx = (tr + 2 * mr + br - tl - 2 * ml - bl) / 4.0;
      const dhdy = (bl + 2 * bc + br - tl - 2 * tc - tr) / 4.0;

      let nx = -dhdx * strength;
      let ny = -dhdy * strength;
      let nz = 1.0;

      [nx, ny, nz] = normalize3(nx, ny, nz);

      if (flipY) ny = -ny;

      const idx = (y * w + x) * 4;
      data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round(nz * 255);
      data[idx + 3] = 255;
    }
  }

  return { imageData: out, mapType: 'normal' };
}

export function bakeAOMap(input: MapBakeInput): MapBakeResult {
  const { width: w, height: h, heights } = input;
  const intensity = input.strength ?? 1.0;

  if (w === 0 || h === 0) {
    const imageData = new ImageData(1, 1);
    return { imageData, mapType: 'ao' };
  }

  const out = new ImageData(w, h);
  const data = out.data;

  const radius = Math.max(w, h) / 16;
  const dirs = 16;
  const samplesPerDir = 8;

  const angleStep = (2 * Math.PI) / dirs;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const centerH = heights[y * w + x];
      let occluded = 0;
      let totalSamples = 0;

      for (let d = 0; d < dirs; d++) {
        const angle = angleStep * d;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);

        for (let s = 1; s <= samplesPerDir; s++) {
          const t = s / samplesPerDir;
          const sx = Math.round(x + dx * radius * t);
          const sy = Math.round(y + dy * radius * t);

          if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

          const sampleH = heights[sy * w + sx];
          if (sampleH > centerH) occluded++;
          totalSamples++;
        }
      }

      const ao = totalSamples > 0 ? occluded / totalSamples : 0;
      const value = Math.pow(1.0 - ao, intensity);
      const byte = Math.round(clamp(value, 0, 1) * 255);

      const idx = (y * w + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }

  return { imageData: out, mapType: 'ao' };
}

export function bakeRoughnessMap(input: MapBakeInput): MapBakeResult {
  const { width: w, height: h, heights } = input;
  const hasStrength = input.strength !== undefined;
  const roughnessValue = clamp(input.strength ?? 0.5, 0, 1);

  if (w === 0 || h === 0) {
    const imageData = new ImageData(1, 1);
    return { imageData, mapType: 'roughness' };
  }

  const out = new ImageData(w, h);
  const data = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let value: number;

      if (hasStrength) {
        value = roughnessValue;
      } else {
        const h01 = clamp(heights[y * w + x], 0, 1);
        value = clamp(0.5 + (h01 - 0.5) * 1.5, 0, 1);
      }

      const byte = Math.round(value * 255);
      const idx = (y * w + x) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }

  return { imageData: out, mapType: 'roughness' };
}

export function bakeHeightMap(input: MapBakeInput): MapBakeResult {
  const { width: w, height: h, heights } = input;

  if (w === 0 || h === 0) {
    const imageData = new ImageData(1, 1);
    return { imageData, mapType: 'height' };
  }

  const out = new ImageData(w, h);
  const data = out.data;

  for (let i = 0; i < w * h; i++) {
    const byte = Math.round(clamp(heights[i], 0, 1) * 255);
    const idx = i * 4;
    data[idx] = byte;
    data[idx + 1] = byte;
    data[idx + 2] = byte;
    data[idx + 3] = 255;
  }

  return { imageData: out, mapType: 'height' };
}

export function bakeMap(input: MapBakeInput): MapBakeResult {
  switch (input.mapType) {
    case 'normal':
      return bakeNormalMap(input);
    case 'ao':
      return bakeAOMap(input);
    case 'roughness':
      return bakeRoughnessMap(input);
    case 'height':
      return bakeHeightMap(input);
    default: {
      const _exhaustive: never = input.mapType;
      throw new Error(`Unknown map type: ${_exhaustive}`);
    }
  }
}

export async function imageDataToPngBlob(imageData: ImageData): Promise<Blob> {
  const { width, height } = imageData;
  if (width === 0 || height === 0) {
    return new Blob([], { type: 'image/png' });
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context from OffscreenCanvas');

  ctx.putImageData(imageData, 0, 0);

  return canvas.convertToBlob({ type: 'image/png' });
}
