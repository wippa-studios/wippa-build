import type { MeshBuildResult, ExportOptions, ExportFormat } from '../../types';
import { exportGlb, exportGltf } from '../../lib/export/GlbExporter';
import { exportObjWithMtl } from '../../lib/export/ObjExporter';
import { exportStl } from '../../lib/export/StlExporter';
import { bakeMap, imageDataToPngBlob } from '../../lib/maps/MapBaker';

type ExportMessage =
  | {
      type: 'export';
      id: string;
      mesh: MeshBuildResult;
      options: ExportOptions;
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
      textures: Array<{ name: string; blob: Blob }>;
    }
  | { type: 'export-result'; id: string; format: 'obj'; obj: string; mtl: string }
  | { type: 'export-result'; id: string; format: 'stl'; blob: Blob }
  | {
      type: 'export-result';
      id: string;
      format: 'maps-zip';
      maps: Array<{ name: string; blob: Blob }>;
    }
  | { type: 'export-error'; id: string; error: string };

const cancelled = new Set<string>();

function convertMapsToBlobs(
  maps: Record<string, { width: number; height: number; data: ArrayBuffer }> | undefined,
): { normal?: Blob; ao?: Blob; roughness?: Blob; height?: Blob } | undefined {
  if (!maps) return undefined;

  const result: {
    normal?: Blob;
    ao?: Blob;
    roughness?: Blob;
    height?: Blob;
  } = {};

  for (const [name, entry] of Object.entries(maps)) {
    const blob = new Blob([entry.data], { type: 'image/png' });
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

async function handleExport(msg: {
  id: string;
  mesh: MeshBuildResult;
  options: ExportOptions;
  maps?: Record<string, { width: number; height: number; data: ArrayBuffer }>;
}): Promise<WorkerResult> {
  const { id, mesh, options, maps } = msg;
  const format = options.format;
  const mapsBlob = convertMapsToBlobs(maps);

  switch (format) {
    case 'glb': {
      const blob = await exportGlb(mesh, undefined, mapsBlob);
      return { type: 'export-result', id, format: 'glb', blob };
    }

    case 'gltf': {
      const result = await exportGltf(mesh, options, undefined, mapsBlob);
      const textures: Array<{ name: string; blob: Blob }> = [];
      result.textures.forEach((blob, name) => {
        textures.push({ name, blob });
      });
      return { type: 'export-result', id, format: 'gltf', json: result.json, textures };
    }

    case 'obj': {
      const result = exportObjWithMtl(mesh, options);
      return { type: 'export-result', id, format: 'obj', obj: result.obj, mtl: result.mtl };
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
      cancelled.add(msg.id);
      break;
    }

    case 'export': {
      const { id } = msg;

      if (cancelled.has(id)) {
        cancelled.delete(id);
        break;
      }

      handleExport(msg)
        .then((result) => {
          if (cancelled.has(id)) {
            cancelled.delete(id);
            return;
          }
          self.postMessage(result);
        })
        .catch((err) => {
          if (cancelled.has(id)) {
            cancelled.delete(id);
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          self.postMessage({ type: 'export-error', id, error: message } satisfies WorkerResult);
        });
      break;
    }
  }
};
