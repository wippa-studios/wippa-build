import type { MeshBuildInput, MeshBuildResult } from '../../types';

export function computeBounds(
  positions: Float32Array,
): { min: [number, number, number]; max: [number, number, number] } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const count = positions.length / 3;
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function normalize(nx: number, ny: number, nz: number): [number, number, number] {
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len === 0) return [0, 0, 1];
  const inv = 1 / len;
  return [nx * inv, ny * inv, nz * inv];
}

export function buildPlaneMesh(input: MeshBuildInput): MeshBuildResult {
  const { heights, resolution: res, depthScale } = input;
  const cellCount = res - 1;
  const vertexCount = res * res;
  const triCount = 2 * cellCount * cellCount;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(triCount * 3);

  const gridStep = 1.0 / cellCount;

  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const vi = r * res + c;
      const u = c * gridStep;
      const v = r * gridStep;
      positions[vi * 3] = u;
      positions[vi * 3 + 1] = v;
      positions[vi * 3 + 2] = heights[vi] * depthScale;
      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = v;
    }
  }

  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const vi = r * res + c;
      const cL = c > 0 ? c - 1 : 0;
      const cR = c < cellCount ? c + 1 : cellCount;
      const rD = r > 0 ? r - 1 : 0;
      const rU = r < cellCount ? r + 1 : cellCount;

      const hL = heights[r * res + cL];
      const hR = heights[r * res + cR];
      const hD = heights[rD * res + c];
      const hU = heights[rU * res + c];

      const rawNx = -(hR - hL) * depthScale;
      const rawNy = -(hU - hD) * depthScale;
      const rawNz = 2.0 * gridStep;
      const [nx, ny, nz] = normalize(rawNx, rawNy, rawNz);

      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
    }
  }

  let ii = 0;
  for (let r = 0; r < cellCount; r++) {
    for (let c = 0; c < cellCount; c++) {
      const v00 = r * res + c;
      const v10 = v00 + 1;
      const v01 = v00 + res;
      const v11 = v01 + 1;

      indices[ii++] = v00;
      indices[ii++] = v10;
      indices[ii++] = v01;

      indices[ii++] = v10;
      indices[ii++] = v11;
      indices[ii++] = v01;
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    triangleCount: triCount,
    bounds: computeBounds(positions),
  };
}

export function buildPlateMesh(input: MeshBuildInput): MeshBuildResult {
  const { heights, resolution: res, depthScale, baseThickness } = input;
  const cellCount = res - 1;

  const topVerts = res * res;
  const sideVertsPerEdge = 2 * res;
  const baseVerts = res * res;
  const totalVerts = topVerts + 4 * sideVertsPerEdge + baseVerts;

  const topTris = 2 * cellCount * cellCount;
  const sideTris = 4 * 2 * cellCount;
  const baseTris = 2 * cellCount * cellCount;
  const totalTris = topTris + sideTris + baseTris;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalTris * 3);

  const gridStep = 1.0 / cellCount;

  const topOff = 0;
  const s0Off = topOff + topVerts;
  const s1Off = s0Off + sideVertsPerEdge;
  const s2Off = s1Off + sideVertsPerEdge;
  const s3Off = s2Off + sideVertsPerEdge;
  const baseOff = s3Off + sideVertsPerEdge;

  // ─── TOP FACE (positions + UVs) ───
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const vi = topOff + r * res + c;
      const hi = r * res + c;
      const u = c * gridStep;
      const v = r * gridStep;
      positions[vi * 3] = u;
      positions[vi * 3 + 1] = v;
      positions[vi * 3 + 2] = heights[hi] * depthScale;
      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = v;
    }
  }

  // ─── TOP FACE (normals via central differences) ───
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const vi = topOff + r * res + c;
      const cL = c > 0 ? c - 1 : 0;
      const cR = c < cellCount ? c + 1 : cellCount;
      const rD = r > 0 ? r - 1 : 0;
      const rU = r < cellCount ? r + 1 : cellCount;

      const hL = heights[r * res + cL];
      const hR = heights[r * res + cR];
      const hD = heights[rD * res + c];
      const hU = heights[rU * res + c];

      const rawNx = -(hR - hL) * depthScale;
      const rawNy = -(hU - hD) * depthScale;
      const rawNz = 2.0 * gridStep;
      const [nx, ny, nz] = normalize(rawNx, rawNy, rawNz);

      normals[vi * 3] = nx;
      normals[vi * 3 + 1] = ny;
      normals[vi * 3 + 2] = nz;
    }
  }

  // ─── SIDE 0: y = 0 edge, outward normal (0, -1, 0) ───
  for (let i = 0; i < res; i++) {
    const x = i * gridStep;
    const zTop = heights[i] * depthScale;

    const tvi = s0Off + i;
    const bvi = s0Off + res + i;

    positions[tvi * 3] = x;
    positions[tvi * 3 + 1] = 0;
    positions[tvi * 3 + 2] = zTop;
    normals[tvi * 3] = 0;
    normals[tvi * 3 + 1] = -1;
    normals[tvi * 3 + 2] = 0;
    uvs[tvi * 2] = x;
    uvs[tvi * 2 + 1] = 0;

    positions[bvi * 3] = x;
    positions[bvi * 3 + 1] = 0;
    positions[bvi * 3 + 2] = -baseThickness;
    normals[bvi * 3] = 0;
    normals[bvi * 3 + 1] = -1;
    normals[bvi * 3 + 2] = 0;
    uvs[bvi * 2] = x;
    uvs[bvi * 2 + 1] = 1;
  }

  // ─── SIDE 1: x = 1 edge, outward normal (1, 0, 0) ───
  for (let j = 0; j < res; j++) {
    const y = j * gridStep;
    const zTop = heights[j * res + cellCount] * depthScale;

    const tvi = s1Off + j;
    const bvi = s1Off + res + j;

    positions[tvi * 3] = 1;
    positions[tvi * 3 + 1] = y;
    positions[tvi * 3 + 2] = zTop;
    normals[tvi * 3] = 1;
    normals[tvi * 3 + 1] = 0;
    normals[tvi * 3 + 2] = 0;
    uvs[tvi * 2] = y;
    uvs[tvi * 2 + 1] = 0;

    positions[bvi * 3] = 1;
    positions[bvi * 3 + 1] = y;
    positions[bvi * 3 + 2] = -baseThickness;
    normals[bvi * 3] = 1;
    normals[bvi * 3 + 1] = 0;
    normals[bvi * 3 + 2] = 0;
    uvs[bvi * 2] = y;
    uvs[bvi * 2 + 1] = 1;
  }

  // ─── SIDE 2: y = 1 edge, outward normal (0, 1, 0) ───
  for (let c = 0; c < res; c++) {
    const x = c * gridStep;
    const zTop = heights[cellCount * res + c] * depthScale;

    const tvi = s2Off + c;
    const bvi = s2Off + res + c;

    positions[tvi * 3] = x;
    positions[tvi * 3 + 1] = 1;
    positions[tvi * 3 + 2] = zTop;
    normals[tvi * 3] = 0;
    normals[tvi * 3 + 1] = 1;
    normals[tvi * 3 + 2] = 0;
    uvs[tvi * 2] = x;
    uvs[tvi * 2 + 1] = 0;

    positions[bvi * 3] = x;
    positions[bvi * 3 + 1] = 1;
    positions[bvi * 3 + 2] = -baseThickness;
    normals[bvi * 3] = 0;
    normals[bvi * 3 + 1] = 1;
    normals[bvi * 3 + 2] = 0;
    uvs[bvi * 2] = x;
    uvs[bvi * 2 + 1] = 1;
  }

  // ─── SIDE 3: x = 0 edge, outward normal (-1, 0, 0) ───
  for (let r = 0; r < res; r++) {
    const y = r * gridStep;
    const zTop = heights[r * res] * depthScale;

    const tvi = s3Off + r;
    const bvi = s3Off + res + r;

    positions[tvi * 3] = 0;
    positions[tvi * 3 + 1] = y;
    positions[tvi * 3 + 2] = zTop;
    normals[tvi * 3] = -1;
    normals[tvi * 3 + 1] = 0;
    normals[tvi * 3 + 2] = 0;
    uvs[tvi * 2] = y;
    uvs[tvi * 2 + 1] = 0;

    positions[bvi * 3] = 0;
    positions[bvi * 3 + 1] = y;
    positions[bvi * 3 + 2] = -baseThickness;
    normals[bvi * 3] = -1;
    normals[bvi * 3 + 1] = 0;
    normals[bvi * 3 + 2] = 0;
    uvs[bvi * 2] = y;
    uvs[bvi * 2 + 1] = 1;
  }

  // ─── BASE FACE: flat grid at z = -baseThickness ───
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      const vi = baseOff + r * res + c;
      const u = c * gridStep;
      const v = r * gridStep;
      positions[vi * 3] = u;
      positions[vi * 3 + 1] = v;
      positions[vi * 3 + 2] = -baseThickness;
      normals[vi * 3] = 0;
      normals[vi * 3 + 1] = 0;
      normals[vi * 3 + 2] = -1;
      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = v;
    }
  }

  // ─── INDICES ───
  let ii = 0;

  // Top face: two CCW triangles per cell (facing +z)
  for (let r = 0; r < cellCount; r++) {
    for (let c = 0; c < cellCount; c++) {
      const v00 = topOff + r * res + c;
      const v10 = v00 + 1;
      const v01 = v00 + res;
      const v11 = v01 + 1;

      indices[ii++] = v00;
      indices[ii++] = v10;
      indices[ii++] = v01;

      indices[ii++] = v10;
      indices[ii++] = v11;
      indices[ii++] = v01;
    }
  }

  // Side 0 (y=0, normal -y): top[i], bottom[i], bottom[i+1] / top[i], bottom[i+1], top[i+1]
  for (let i = 0; i < cellCount; i++) {
    const t0 = s0Off + i;
    const t1 = s0Off + i + 1;
    const b0 = s0Off + res + i;
    const b1 = s0Off + res + i + 1;

    indices[ii++] = t0;
    indices[ii++] = b0;
    indices[ii++] = b1;

    indices[ii++] = t0;
    indices[ii++] = b1;
    indices[ii++] = t1;
  }

  // Side 1 (x=1, normal +x): top[j], bottom[j], bottom[j+1] / top[j], bottom[j+1], top[j+1]
  for (let j = 0; j < cellCount; j++) {
    const t0 = s1Off + j;
    const t1 = s1Off + j + 1;
    const b0 = s1Off + res + j;
    const b1 = s1Off + res + j + 1;

    indices[ii++] = t0;
    indices[ii++] = b0;
    indices[ii++] = b1;

    indices[ii++] = t0;
    indices[ii++] = b1;
    indices[ii++] = t1;
  }

  // Side 2 (y=1, normal +y): top[c+1], bottom[c+1], bottom[c] / top[c+1], bottom[c], top[c]
  for (let c = 0; c < cellCount; c++) {
    const t0 = s2Off + c + 1;
    const t1 = s2Off + c;
    const b0 = s2Off + res + c + 1;
    const b1 = s2Off + res + c;

    indices[ii++] = t0;
    indices[ii++] = b0;
    indices[ii++] = b1;

    indices[ii++] = t0;
    indices[ii++] = b1;
    indices[ii++] = t1;
  }

  // Side 3 (x=0, normal -x): top[r], top[r+1], bottom[r+1] / top[r], bottom[r+1], bottom[r]
  for (let r = 0; r < cellCount; r++) {
    const t0 = s3Off + r;
    const t1 = s3Off + r + 1;
    const b0 = s3Off + res + r;
    const b1 = s3Off + res + r + 1;

    indices[ii++] = t0;
    indices[ii++] = t1;
    indices[ii++] = b1;

    indices[ii++] = t0;
    indices[ii++] = b1;
    indices[ii++] = b0;
  }

  // Base face: reversed winding from top (facing -z)
  for (let r = 0; r < cellCount; r++) {
    for (let c = 0; c < cellCount; c++) {
      const v00 = baseOff + r * res + c;
      const v10 = v00 + 1;
      const v01 = v00 + res;
      const v11 = v01 + 1;

      indices[ii++] = v00;
      indices[ii++] = v01;
      indices[ii++] = v10;

      indices[ii++] = v10;
      indices[ii++] = v01;
      indices[ii++] = v11;
    }
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    triangleCount: totalTris,
    bounds: computeBounds(positions),
  };
}
