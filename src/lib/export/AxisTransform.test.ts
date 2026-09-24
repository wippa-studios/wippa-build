import { describe, expect, it } from 'vitest';
import type { MeshBuildResult } from '../../types';
import { transformMesh, transformNormal, transformPosition } from './AxisTransform';

function mesh(): MeshBuildResult {
  return {
    positions: new Float32Array([1, 2, 3, -1, 4, 5]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 1]),
    indices: new Uint32Array([0, 1, 0]),
    triangleCount: 1,
    bounds: { min: [-1, 2, 3], max: [1, 4, 5] },
  };
}

describe('AxisTransform', () => {
  it('applies Unity and Unreal position/normal conventions', () => {
    expect(transformPosition(1, 2, 3, 'unity', 2)).toEqual([2, 6, -4]);
    expect(transformPosition(1, 2, 3, 'unreal', 1)).toEqual([100, 300, -200]);
    expect(transformNormal(0, 1, 0, 'unity')).toEqual([0, 0, -1]);
  });

  it('keeps glTF identity transforms and returns matching bounds', () => {
    const result = transformMesh(mesh(), 'gltf', 1);
    expect(result.positions).toEqual(mesh().positions);
    expect(result.bounds).toEqual({ min: [-1, 2, 3], max: [1, 4, 5] });
  });
});
