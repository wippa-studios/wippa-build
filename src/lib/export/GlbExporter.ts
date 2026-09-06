import type { MeshBuildResult, ExportOptions } from '../../types';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;

const TARGET_ARRAY_BUFFER = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

const SAMPLER_MAG_LINEAR = 9729;
const SAMPLER_MIN_LINEAR_MIPMAP = 9987;
const SAMPLER_WRAP_REPEAT = 10497;

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

function padTo4(src: Uint8Array): Uint8Array {
  const remainder = src.byteLength % 4;
  if (remainder === 0) return src;
  const padded = new Uint8Array(src.byteLength + (4 - remainder));
  padded.set(src);
  for (let i = src.byteLength; i < padded.byteLength; i++) padded[i] = 0x20;
  return padded;
}

async function readBlob(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

interface ImageDef {
  name: string;
  mimeType: string;
  byteLength: number;
}

function buildGltfJson(
  mesh: MeshBuildResult,
  imageDefs: ImageDef[],
  imageOffsets: number[],
  useShortIndices: boolean,
  mode: 'glb' | 'gltf',
  axisConvention?: string,
): object {
  const vertexCount = mesh.positions.length / 3;
  const indexCount = mesh.indices.length;

  const posBytes = vertexCount * 12;
  const normBytes = vertexCount * 12;
  const uvBytes = vertexCount * 8;
  const idxBytes = indexCount * (useShortIndices ? 2 : 4);
  const geometryBytes = posBytes + normBytes + uvBytes + idxBytes;
  const indexComponentType = useShortIndices ? COMPONENT_UNSIGNED_SHORT : COMPONENT_UNSIGNED_INT;

  const bufferViews: object[] = [];
  const accessors: object[] = [];

  bufferViews.push({
    buffer: 0,
    byteOffset: 0,
    byteLength: posBytes,
    target: TARGET_ARRAY_BUFFER,
  });
  accessors.push({
    bufferView: 0,
    componentType: COMPONENT_FLOAT,
    count: vertexCount,
    type: 'VEC3',
    min: [...mesh.bounds.min],
    max: [...mesh.bounds.max],
  });

  bufferViews.push({
    buffer: 0,
    byteOffset: posBytes,
    byteLength: normBytes,
    target: TARGET_ARRAY_BUFFER,
  });
  accessors.push({
    bufferView: 1,
    componentType: COMPONENT_FLOAT,
    count: vertexCount,
    type: 'VEC3',
  });

  const uvOffset = posBytes + normBytes;
  bufferViews.push({
    buffer: 0,
    byteOffset: uvOffset,
    byteLength: uvBytes,
    target: TARGET_ARRAY_BUFFER,
  });
  accessors.push({
    bufferView: 2,
    componentType: COMPONENT_FLOAT,
    count: vertexCount,
    type: 'VEC2',
  });

  const idxOffset = uvOffset + uvBytes;
  bufferViews.push({
    buffer: 0,
    byteOffset: idxOffset,
    byteLength: idxBytes,
    target: TARGET_ELEMENT_ARRAY_BUFFER,
  });
  accessors.push({
    bufferView: 3,
    componentType: indexComponentType,
    count: indexCount,
    type: 'SCALAR',
  });

  const imageBufferViewStart = bufferViews.length;
  if (mode === 'glb') {
    for (let i = 0; i < imageDefs.length; i++) {
      bufferViews.push({
        buffer: 0,
        byteOffset: imageOffsets[i],
        byteLength: imageDefs[i].byteLength,
      });
    }
  }

  const images = imageDefs.map((img, i) => {
    if (mode === 'glb') {
      return {
        bufferView: imageBufferViewStart + i,
        mimeType: img.mimeType,
        name: img.name.replace(/\.[^.]+$/, ''),
      };
    }
    return {
      uri: img.name,
      mimeType: img.mimeType,
      name: img.name.replace(/\.[^.]+$/, ''),
    };
  });

  const textures = images.map((_, i) => ({ sampler: 0, source: i }));

  const imageMap: Record<string, number> = {};
  imageDefs.forEach((img, i) => {
    imageMap[img.name] = i;
  });

  const material: Record<string, unknown> = {
    name: 'Material',
    pbrMetallicRoughness: {
      metallicFactor: 0.0,
      roughnessFactor: 1.0,
    },
  };

  if (imageMap['albedo.png'] !== undefined) {
    (material.pbrMetallicRoughness as Record<string, unknown>).baseColorTexture = {
      index: imageMap['albedo.png'],
    };
  }

  if (imageMap['roughness.png'] !== undefined) {
    (material.pbrMetallicRoughness as Record<string, unknown>).metallicRoughnessTexture = {
      index: imageMap['roughness.png'],
    };
  }

  if (imageMap['normal.png'] !== undefined) {
    material.normalTexture = { index: imageMap['normal.png'] };
  }

  if (imageMap['ao.png'] !== undefined) {
    material.occlusionTexture = { index: imageMap['ao.png'] };
  }

  let totalBinLength: number;
  if (mode === 'glb') {
    totalBinLength = geometryBytes;
    for (let i = 0; i < imageDefs.length; i++) {
      totalBinLength = align4(totalBinLength);
      totalBinLength += imageDefs[i].byteLength;
    }
  } else {
    totalBinLength = geometryBytes;
  }

  const asset: Record<string, unknown> = {
    version: '2.0',
    generator: 'wippa-build',
  };
  if (axisConvention && axisConvention !== 'gltf') {
    asset.extras = { axisConvention };
  }

  return {
    asset,
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name: 'Mesh', mesh: 0 }],
    meshes: [
      {
        name: 'Mesh',
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    materials: [material],
    textures,
    images,
    samplers: [
      {
        magFilter: SAMPLER_MAG_LINEAR,
        minFilter: SAMPLER_MIN_LINEAR_MIPMAP,
        wrapS: SAMPLER_WRAP_REPEAT,
        wrapT: SAMPLER_WRAP_REPEAT,
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalBinLength }],
  };
}

export async function exportGlb(
  mesh: MeshBuildResult,
  albedoImage?: Blob,
  maps?: { normal?: Blob; ao?: Blob; roughness?: Blob; height?: Blob },
): Promise<Blob> {
  const vertexCount = mesh.positions.length / 3;
  const indexCount = mesh.indices.length;
  const useShortIndices = vertexCount < 65536;

  const posBytes = vertexCount * 12;
  const normBytes = vertexCount * 12;
  const uvBytes = vertexCount * 8;
  const idxBytes = indexCount * (useShortIndices ? 2 : 4);
  const geometryBytes = posBytes + normBytes + uvBytes + idxBytes;

  const imageBlobs: { name: string; blob: Blob }[] = [];
  if (albedoImage) imageBlobs.push({ name: 'albedo.png', blob: albedoImage });
  if (maps?.normal) imageBlobs.push({ name: 'normal.png', blob: maps.normal });
  if (maps?.ao) imageBlobs.push({ name: 'ao.png', blob: maps.ao });
  if (maps?.roughness) imageBlobs.push({ name: 'roughness.png', blob: maps.roughness });
  if (maps?.height) imageBlobs.push({ name: 'height.png', blob: maps.height });

  const imageDefs: ImageDef[] = [];
  const imageData: Uint8Array[] = [];
  for (const entry of imageBlobs) {
    const data = await readBlob(entry.blob);
    imageData.push(data);
    imageDefs.push({ name: entry.name, mimeType: 'image/png', byteLength: data.byteLength });
  }

  const imageOffsets: number[] = [];
  let totalBufferSize = geometryBytes;
  for (let i = 0; i < imageDefs.length; i++) {
    const offset = align4(totalBufferSize);
    imageOffsets.push(offset);
    totalBufferSize = offset + imageDefs[i].byteLength;
  }

  const binBuffer = new ArrayBuffer(totalBufferSize);
  const binBytes = new Uint8Array(binBuffer);

  let writeOffset = 0;

  binBytes.set(
    new Uint8Array(mesh.positions.buffer, mesh.positions.byteOffset, posBytes),
    writeOffset,
  );
  writeOffset += posBytes;

  binBytes.set(
    new Uint8Array(mesh.normals.buffer, mesh.normals.byteOffset, normBytes),
    writeOffset,
  );
  writeOffset += normBytes;

  binBytes.set(
    new Uint8Array(mesh.uvs.buffer, mesh.uvs.byteOffset, uvBytes),
    writeOffset,
  );
  writeOffset += uvBytes;

  if (useShortIndices) {
    const shortIndices = new Uint16Array(mesh.indices);
    binBytes.set(
      new Uint8Array(shortIndices.buffer, shortIndices.byteOffset, idxBytes),
      writeOffset,
    );
  } else {
    binBytes.set(
      new Uint8Array(mesh.indices.buffer, mesh.indices.byteOffset, idxBytes),
      writeOffset,
    );
  }
  writeOffset += idxBytes;

  for (let i = 0; i < imageData.length; i++) {
    const imgOffset = imageOffsets[i];
    for (let j = writeOffset; j < imgOffset; j++) binBytes[j] = 0x20;
    binBytes.set(imageData[i], imgOffset);
    writeOffset = imgOffset + imageData[i].byteLength;
  }

  const gltfJson = buildGltfJson(mesh, imageDefs, imageOffsets, useShortIndices, 'glb');
  const jsonString = JSON.stringify(gltfJson);
  const jsonBytes = padTo4(new TextEncoder().encode(jsonString));

  const binPadding = (4 - (totalBufferSize % 4)) % 4;
  const paddedBinSize = totalBufferSize + binPadding;

  const totalGlbSize = 12 + 8 + jsonBytes.byteLength + 8 + paddedBinSize;

  const glb = new ArrayBuffer(totalGlbSize);
  const dv = new DataView(glb);
  const glbBytes = new Uint8Array(glb);

  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, GLB_VERSION, true);
  dv.setUint32(8, totalGlbSize, true);

  let pos = 12;

  dv.setUint32(pos, jsonBytes.byteLength, true);
  pos += 4;
  dv.setUint32(pos, JSON_CHUNK_TYPE, true);
  pos += 4;
  glbBytes.set(jsonBytes, pos);
  pos += jsonBytes.byteLength;

  dv.setUint32(pos, paddedBinSize, true);
  pos += 4;
  dv.setUint32(pos, BIN_CHUNK_TYPE, true);
  pos += 4;
  glbBytes.set(new Uint8Array(binBuffer), pos);
  for (let i = totalBufferSize; i < paddedBinSize; i++) {
    glbBytes[pos + i] = 0x20;
  }

  return new Blob([glb], { type: 'model/gltf-binary' });
}

export async function exportGltf(
  mesh: MeshBuildResult,
  options: ExportOptions,
  albedoImage?: Blob,
  maps?: { normal?: Blob; ao?: Blob; roughness?: Blob; height?: Blob },
): Promise<{ json: object; textures: Map<string, Blob> }> {
  const vertexCount = mesh.positions.length / 3;
  const useShortIndices = vertexCount < 65536;

  const textures = new Map<string, Blob>();
  const imageDefs: ImageDef[] = [];

  if (albedoImage) {
    textures.set('albedo.png', albedoImage);
    imageDefs.push({ name: 'albedo.png', mimeType: 'image/png', byteLength: 0 });
  }
  if (maps?.normal) {
    textures.set('normal.png', maps.normal);
    imageDefs.push({ name: 'normal.png', mimeType: 'image/png', byteLength: 0 });
  }
  if (maps?.ao) {
    textures.set('ao.png', maps.ao);
    imageDefs.push({ name: 'ao.png', mimeType: 'image/png', byteLength: 0 });
  }
  if (maps?.roughness) {
    textures.set('roughness.png', maps.roughness);
    imageDefs.push({ name: 'roughness.png', mimeType: 'image/png', byteLength: 0 });
  }
  if (maps?.height) {
    textures.set('height.png', maps.height);
    imageDefs.push({ name: 'height.png', mimeType: 'image/png', byteLength: 0 });
  }

  const json = buildGltfJson(
    mesh,
    imageDefs,
    [],
    useShortIndices,
    'gltf',
    options.axisConvention,
  );

  return { json, textures };
}
