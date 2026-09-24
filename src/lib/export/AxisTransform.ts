import type { AxisConvention, MeshBuildResult } from '../../types';

export function transformPosition(
  x: number,
  y: number,
  z: number,
  axisConvention: AxisConvention,
  scale: number,
): [number, number, number] {
  let tx = x * scale;
  let ty = y * scale;
  let tz = z * scale;

  if (axisConvention === 'unity') {
    const previousY = ty;
    ty = tz;
    tz = -previousY;
  } else if (axisConvention === 'unreal') {
    tx *= 100;
    ty *= 100;
    tz *= 100;
    const previousY = ty;
    ty = tz;
    tz = -previousY;
  }

  return [tx, ty, tz];
}

export function transformNormal(
  x: number,
  y: number,
  z: number,
  axisConvention: AxisConvention,
): [number, number, number] {
  if (axisConvention === 'gltf') return [x, y, z];

  return [x, z, -y];
}

export function transformMesh(
  mesh: MeshBuildResult,
  axisConvention: AxisConvention,
  scale: number,
): MeshBuildResult {
  if (axisConvention === 'gltf' && scale === 1) return mesh;

  const positions = new Float32Array(mesh.positions.length);
  const normals = new Float32Array(mesh.normals.length);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const vertexCount = mesh.positions.length / 3;

  for (let i = 0; i < vertexCount; i++) {
    const position = transformPosition(
      mesh.positions[i * 3],
      mesh.positions[i * 3 + 1],
      mesh.positions[i * 3 + 2],
      axisConvention,
      scale,
    );
    positions[i * 3] = position[0];
    positions[i * 3 + 1] = position[1];
    positions[i * 3 + 2] = position[2];

    min[0] = Math.min(min[0], position[0]);
    min[1] = Math.min(min[1], position[1]);
    min[2] = Math.min(min[2], position[2]);
    max[0] = Math.max(max[0], position[0]);
    max[1] = Math.max(max[1], position[1]);
    max[2] = Math.max(max[2], position[2]);
  }

  for (let i = 0; i < vertexCount; i++) {
    const normal = transformNormal(
      mesh.normals[i * 3],
      mesh.normals[i * 3 + 1],
      mesh.normals[i * 3 + 2],
      axisConvention,
    );
    normals[i * 3] = normal[0];
    normals[i * 3 + 1] = normal[1];
    normals[i * 3 + 2] = normal[2];
  }

  return {
    positions,
    normals,
    uvs: mesh.uvs,
    indices: mesh.indices,
    triangleCount: mesh.triangleCount,
    bounds: vertexCount === 0 ? mesh.bounds : { min, max },
  };
}
