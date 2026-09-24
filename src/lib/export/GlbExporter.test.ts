import { describe, expect, it } from 'vitest';
import type { ExportOptions, MeshBuildResult } from '../../types';
import { exportGlb, exportGltf } from './GlbExporter';

const options: ExportOptions = {
  format: 'gltf',
  axisConvention: 'gltf',
  includeTextures: true,
  texturePacking: 'individual',
  units: 'm',
  scale: 1,
};

function mesh(): MeshBuildResult {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    triangleCount: 1,
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
  };
}

describe('glTF exporters', () => {
  it('emits a declared external buffer whose bytes match the JSON', async () => {
    const result = await exportGltf(mesh(), options);
    const json = result.json as {
      buffers: Array<{ uri?: string; byteLength: number }>;
      accessors: Array<{ min?: number[]; max?: number[] }>;
    };
    expect(json.buffers[0].uri).toBe('geometry.bin');
    expect(json.buffers[0].byteLength).toBe(result.bin.byteLength);
    expect(json.accessors[0].min).toEqual([0, 0, -1]);
    expect(new Float32Array(result.bin, 0, 3)).toEqual(new Float32Array([0, 0, 0]));
  });

  it('serializes a self-contained GLB with transformed accessor bounds', async () => {
    const blob = await exportGlb(mesh(), { ...options, format: 'glb', axisConvention: 'unity' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength))) as {
      buffers: Array<{ uri?: string }>;
      accessors: Array<{ min: number[]; max: number[] }>;
    };
    expect(json.buffers[0].uri).toBeUndefined();
    expect(json.accessors[0].min).toEqual([0, 0, 0]);
    expect(json.accessors[0].max).toEqual([1, 0, 1]);
  });

  it('rejects malformed geometry instead of emitting a misleading file', async () => {
    const invalid = { ...mesh(), positions: new Float32Array([0, 0]) };
    await expect(exportGltf(invalid, options)).rejects.toThrow();
  });
});
