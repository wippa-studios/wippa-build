import { describe, expect, it } from 'vitest';
import { applyContrast, applyGamma, applyReliefSource, gaussianBlur } from './HeightMap';

const pixels = new Uint8ClampedArray([
  255, 255, 255, 255,
  0, 0, 0, 255,
  255, 0, 0, 255,
  0, 0, 255, 128,
]);

describe('HeightMap operations', () => {
  it('extracts luma, inverted luma, and alpha deterministically', () => {
    const luma = applyReliefSource(pixels, 2, 2, 'luma');
    const inverted = applyReliefSource(pixels, 2, 2, 'invLuma');
    expect(luma[0]).toBe(1);
    expect(luma[1]).toBe(0);
    expect(luma[2]).toBeCloseTo(0.299);
    expect(luma[3]).toBeCloseTo(0.114);
    expect(inverted[0]).toBe(0);
    expect(inverted[1]).toBe(1);
    expect(inverted[2]).toBeCloseTo(0.701);
    expect(inverted[3]).toBeCloseTo(0.886);
    const alpha = applyReliefSource(pixels, 2, 2, 'alpha');
    expect(alpha[0]).toBe(1);
    expect(alpha[1]).toBe(1);
    expect(alpha[2]).toBe(1);
    expect(alpha[3]).toBeCloseTo(128 / 255);
  });

  it('applies gamma and clamps contrast to the valid range', () => {
    expect(applyGamma(new Float32Array([0, 0.25, 1]), 2)[1]).toBeCloseTo(0.5);
    expect(Array.from(applyContrast(new Float32Array([0, 0.5, 1]), 1))).toEqual([0, 0.5, 1]);
    expect(Array.from(applyContrast(new Float32Array([0, 1]), -1))).toEqual([0.5, 0.5]);
  });

  it('returns an unchanged copy for zero-radius smoothing', () => {
    const input = new Float32Array([0, 1, 0]);
    const output = gaussianBlur(input, 3, 1, 0);
    expect(Array.from(output)).toEqual(Array.from(input));
    expect(output).not.toBe(input);
  });
});
