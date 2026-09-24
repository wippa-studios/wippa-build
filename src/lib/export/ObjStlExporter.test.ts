import { describe, expect, it } from 'vitest';
import type { ExportOptions, MeshBuildResult } from '../../types';
import { exportObjWithMtl } from './ObjExporter';
import { exportStl } from './StlExporter';

const options: ExportOptions = {
  format: 'obj',
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

describe('OBJ/STL exporters', () => {
  it('uses the shared canonical transform and emits declared texture references', () => {
    const result = exportObjWithMtl(mesh(), options, { albedo: true, normal: true });
    expect(result.obj).toContain('mtllib material.mtl');
    expect(result.obj).toContain('v 0 0 0');
    expect(result.mtl).toContain('map_Kd albedo.png');
    expect(result.mtl).toContain('map_Kn normal.png');
  });

  it('applies STL scale even when the axis preset is glTF', async () => {
    const blob = exportStl(mesh(), { ...options, format: 'stl', scale: 2 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getFloat32(84 + 12, true)).toBe(0);
    expect(view.getFloat32(84 + 12 + 4, true)).toBe(0);
    expect(view.getFloat32(84 + 12 + 8, true)).toBe(0);
    expect(view.getFloat32(84 + 12 + 12, true)).toBe(2);
  });
});
