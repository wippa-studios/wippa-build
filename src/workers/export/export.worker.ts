import type { MeshBuildResult, ExportOptions } from '../../types';
import { exportGlb, exportGltf } from '../../lib/export/GlbExporter';
import { exportObjWithMtl } from '../../lib/export/ObjExporter';
import { exportStl } from '../../lib/export/StlExporter';
import { imageDataToPngBlob } from '../../lib/maps/MapBaker';
import { createCancellationRegistry } from '../../lib/workers/cancellation';

type ExportMessage =
  | {
      type: 'export';
      id: string;
       mesh: MeshBuildResult;
       options: ExportOptions;
       albedoImage?: Blob;
       maps?: Record<
        string,
        { width: number; height: number; data: ArrayBuffer }
      >;
    }
  | { type: 'cancel'; id: string };

type WorkerResult =
  | { type: 'export-result'; id: string; format: 'glb'; blob: Blob }
  | {
      type: 'export-result';
      id: string;
      format: 'gltf';
      json: object;
      bin: ArrayBuffer;
      binName: string;
      textures: Array<{ name: string; blob: Blob }>;
    }
  | {
      type: 'export-result';
      id: string;
      format: 'obj';
      obj: string;
      mtl: string;
      mtlName: string;
      textures: Array<{ name: string; blob: Blob }>;
    }
  | { type: 'export-result'; id: string; format: 'stl'; blob: Blob }
  | {
      type: 'export-result';
      id: string;
      format: 'maps-zip';
      maps: Array<{ name: string; blob: Blob }>;
    }
  | { type: 'export-error'; id: string; error: string };

const cancelled = createCancellationRegistry();

async function convertMapsToBlobs(
  maps: Record<string, { width: number; height: number; data: ArrayBuffer }> | undefined,
): Promise<{ normal?: Blob; ao?: Blob; roughness?: Blob; height?: Blob } | undefined> {
  if (!maps) return undefined;

  const result: {
    normal?: Blob;
    ao?: Blob;
    roughness?: Blob;
    height?: Blob;
  } = {};

  for (const [name, entry] of Object.entries(maps)) {
    const imageData = new ImageData(
      new Uint8ClampedArray(entry.data),
      entry.width,
      entry.height,
    );
    const blob = await imageDataToPngBlob(imageData);
    switch (name) {
      case 'normal':
        result.normal = blob;
        break;
      case 'ao':
        result.ao = blob;
        break;
      case 'roughness':
        result.roughness = blob;
        break;
      case 'height':
        result.height = blob;
        break;
    }
  }

  return result;
}

async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context for albedo conversion');
    ctx.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

async function handleExport(msg: {
  id: string;
  mesh: MeshBuildResult;
  options: ExportOptions;
  albedoImage?: Blob;
  maps?: Record<string, { width: number; height: number; data: ArrayBuffer }>;
}): Promise<WorkerResult> {
  const { id, mesh, options, maps } = msg;
  const format = options.format;
  const needsTextureResources = format === 'glb' || (format === 'gltf' || format === 'obj') && options.includeTextures;
  const mapsBlob = needsTextureResources ? await convertMapsToBlobs(maps) : undefined;
  const albedoImage = needsTextureResources && msg.albedoImage
    ? await convertImageBlobToPng(msg.albedoImage)
    : undefined;

  switch (format) {
    case 'glb': {
      const blob = await exportGlb(mesh, options, albedoImage, mapsBlob);
      return { type: 'export-result', id, format: 'glb', blob };
    }

    case 'gltf': {
      const result = await exportGltf(mesh, options, albedoImage, mapsBlob);
      const textures: Array<{ name: string; blob: Blob }> = [];
      result.textures.forEach((blob, name) => {
        textures.push({ name, blob });
      });
      return { type: 'export-result', id, format: 'gltf', json: result.json, bin: result.bin, binName: result.binName, textures };
    }

    case 'obj': {
      const result = exportObjWithMtl(mesh, options, {
        albedo: Boolean(albedoImage),
        normal: Boolean(mapsBlob?.normal),
      });
      const textures: Array<{ name: string; blob: Blob }> = [];
      if (albedoImage) textures.push({ name: 'albedo.png', blob: albedoImage });
      if (mapsBlob?.normal) textures.push({ name: 'normal.png', blob: mapsBlob.normal });
      if (mapsBlob?.ao) textures.push({ name: 'ao.png', blob: mapsBlob.ao });
      if (mapsBlob?.roughness) textures.push({ name: 'roughness.png', blob: mapsBlob.roughness });
      if (mapsBlob?.height) textures.push({ name: 'height.png', blob: mapsBlob.height });
      return {
        type: 'export-result',
        id,
        format: 'obj',
        obj: result.obj,
        mtl: result.mtl,
        mtlName: result.mtlName,
        textures,
      };
    }

    case 'stl': {
      const blob = exportStl(mesh, options);
      return { type: 'export-result', id, format: 'stl', blob };
    }

    case 'maps-zip': {
      const mapEntries = maps ? Object.entries(maps) : [];
      const exportedMaps: Array<{ name: string; blob: Blob }> = [];

      for (const [name, entry] of mapEntries) {
        const imageData = new ImageData(
          new Uint8ClampedArray(entry.data),
          entry.width,
          entry.height,
        );
        const blob = await imageDataToPngBlob(imageData);
        exportedMaps.push({ name: `${name}.png`, blob });
      }

      return { type: 'export-result', id, format: 'maps-zip', maps: exportedMaps };
    }

    default: {
      const _exhaustive: never = format;
      throw new Error(`Unsupported export format: ${_exhaustive}`);
    }
  }
}

self.onmessage = (e: MessageEvent<ExportMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'cancel': {
      cancelled.mark(msg.id);
      break;
    }

    case 'export': {
      const { id } = msg;

      if (cancelled.consume(id)) {
        break;
      }

      handleExport(msg)
        .then((result) => {
          if (cancelled.consume(id)) {
            return;
          }
          self.postMessage(result);
        })
        .catch((err) => {
          if (cancelled.consume(id)) {
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          self.postMessage({ type: 'export-error', id, error: message } satisfies WorkerResult);
        });
      break;
    }
  }
};
