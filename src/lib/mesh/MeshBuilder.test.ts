import { describe, expect, it } from 'vitest';
import type { MeshBuildInput } from '../../types';
import { buildPlaneMesh, buildPlateMesh, computeBounds } from './MeshBuilder';

function input(style: 'plane' | 'plate' = 'plane'): MeshBuildInput {
  return {
    heights: new Float32Array([0, 1, 1, 0]),
    width: 2,
    height: 2,
    resolution: 2,
    depthScale: 1,
    smoothing: 0,
    style,
    baseThickness: 0.25,
  };
}

describe('MeshBuilder', () => {
  it('builds a plane with the expected grid and triangle counts', () => {
    const result = buildPlaneMesh(input());
    expect(result.positions).toHaveLength(12);
    expect(result.indices).toHaveLength(6);
    expect(result.triangleCount).toBe(2);
    expect(result.bounds.min[0]).toBe(0);
    expect(result.bounds.max[1]).toBe(1);
  });

  it('builds a closed plate with top, sides, and base geometry', () => {
    const result = buildPlateMesh(input('plate'));
    expect(result.positions).toHaveLength(24 * 3);
    expect(result.indices).toHaveLength(12 * 3);
    expect(result.triangleCount).toBe(12);
    expect(result.bounds.min[2]).toBe(-0.25);
  });

  it('tracks negative and positive coordinate bounds', () => {
    expect(computeBounds(new Float32Array([-2, 0, -1, 3, 4, 5]))).toEqual({
      min: [-2, 0, -1],
      max: [3, 4, 5],
    });
  });
});
