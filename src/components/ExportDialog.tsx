import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { ExportFormat, ExportOptions, AxisConvention, TexturePacking, Unit } from '../types'
import { bakeMap } from '../lib/maps/MapBaker'

const FORMATS: { value: ExportFormat; label: string; desc: string }[] = [
  { value: 'glb', label: 'GLB', desc: 'Binary glTF — single file, game-ready' },
  { value: 'gltf', label: 'glTF', desc: 'glTF with external textures' },
  { value: 'obj', label: 'OBJ', desc: 'Wavefront OBJ + MTL' },
  { value: 'stl', label: 'STL', desc: 'STL mesh (3D printing)' },
  { value: 'maps-zip', label: 'Maps ZIP', desc: 'PBR texture maps only (PNG)' },
]

const AXIS_OPTIONS: { value: AxisConvention; label: string; icon: string }[] = [
  { value: 'gltf', label: 'glTF (Y-up)', icon: '📐' },
  { value: 'unity', label: 'Unity (Y-up, left-hand)', icon: '🎮' },
  { value: 'unreal', label: 'Unreal (Z-up)', icon: '🎯' },
]

const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: 'm', label: 'Meters (m)' },
  { value: 'cm', label: 'Centimeters (cm)' },
  { value: 'mm', label: 'Millimeters (mm)' },
  { value: 'unitless', label: 'Unitless' },
]

const PACKING_OPTIONS: { value: TexturePacking; label: string }[] = [
  { value: 'individual', label: 'Individual files' },
  { value: 'ormo', label: 'ORMO packed' },
  { value: 'ue', label: 'UE packed' },
]

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function ExportDialog() {
  const exportDialogOpen = useStore((s) => s.exportDialogOpen)
  const mesh = useStore((s) => s.meshResult)
  const viewportInfo = useStore((s) => s.viewportInfo)
  const depthResult = useStore((s) => s.depthResult)
  const maps = useStore((s) => s.maps)
  const units = useStore((s) => s.units)
  const axisConvention = useStore((s) => s.axisConvention)

  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen)
  const setProcessing = useStore((s) => s.setProcessing)
  const setError = useStore((s) => s.setError)

  const [format, setFormat] = useState<ExportFormat>('glb')
  const [includeTextures, setIncludeTextures] = useState(true)
  const [texturePacking, setTexturePacking] = useState<TexturePacking>('individual')
  const [unit, setUnit] = useState<Unit>(units.unit)
  const [scale, setScale] = useState(units.scale)
  const [axis, setAxis] = useState<AxisConvention>(axisConvention)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    if (exportDialogOpen) {
      setFormat('glb')
      setIncludeTextures(true)
      setTexturePacking('individual')
      setUnit(units.unit)
      setScale(units.scale)
      setAxis(axisConvention)
      setExportError(null)
    }
  }, [exportDialogOpen, units.unit, units.scale, axisConvention])

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  const showTextures = format === 'gltf' || format === 'obj'
  const showPacking = format === 'gltf' && includeTextures
  const mapsZipDisabled = format !== 'maps-zip' && !showTextures

  const dims = mesh
    ? {
        w: (mesh.bounds.max[0] - mesh.bounds.min[0]) * scale,
        h: (mesh.bounds.max[1] - mesh.bounds.min[1]) * scale,
        d: (mesh.bounds.max[2] - mesh.bounds.min[2]) * scale,
      }
    : null

  const estimatedSize = mesh
    ? (() => {
        const baseSize = mesh.positions.byteLength + mesh.normals.byteLength + mesh.uvs.byteLength + mesh.indices.byteLength
        if (format === 'glb') return baseSize * 1.1
        if (format === 'gltf') return baseSize * 0.8
        if (format === 'obj') return baseSize * 0.5
        if (format === 'stl') return baseSize * 0.4
        return 0
      })()
    : null

  const close = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setExportDialogOpen(false)
  }, [setExportDialogOpen])

  const handleExport = useCallback(async () => {
    if (!mesh) {
      setExportError('No mesh loaded')
      return
    }

    setExporting(true)
    setExportError(null)
    setProcessing(true, 'Exporting...')

    try {
      const id = crypto.randomUUID()

      let mapsData: Record<string, { width: number; height: number; data: ArrayBuffer }> | undefined

      if (showTextures && depthResult) {
        mapsData = {}

        if (maps.normal.enabled) {
          const result = bakeMap({
            heights: depthResult.data,
            width: depthResult.width,
            height: depthResult.height,
            resolution: depthResult.width,
            mapType: 'normal',
            strength: maps.normal.strength,
            flipY: maps.normal.flipY,
          })
          mapsData.normal = {
            width: result.imageData.width,
            height: result.imageData.height,
            data: result.imageData.data.buffer.slice(0),
          }
        }

        if (maps.ao.enabled) {
          const result = bakeMap({
            heights: depthResult.data,
            width: depthResult.width,
            height: depthResult.height,
            resolution: depthResult.width,
            mapType: 'ao',
            strength: maps.ao.intensity,
          })
          mapsData.ao = {
            width: result.imageData.width,
            height: result.imageData.height,
            data: result.imageData.data.buffer.slice(0),
          }
        }

        if (maps.roughness.mode === 'fromLuma') {
          const result = bakeMap({
            heights: depthResult.data,
            width: depthResult.width,
            height: depthResult.height,
            resolution: depthResult.width,
            mapType: 'roughness',
          })
          mapsData.roughness = {
            width: result.imageData.width,
            height: result.imageData.height,
            data: result.imageData.data.buffer.slice(0),
          }
        }

        if (maps.height.enabled) {
          const result = bakeMap({
            heights: depthResult.data,
            width: depthResult.width,
            height: depthResult.height,
            resolution: depthResult.width,
            mapType: 'height',
          })
          mapsData.height = {
            width: result.imageData.width,
            height: result.imageData.height,
            data: result.imageData.data.buffer.slice(0),
          }
        }

        if (Object.keys(mapsData).length === 0) {
          mapsData = undefined
        }
      }

      const options: ExportOptions = {
        format,
        axisConvention: axis,
        includeTextures: showTextures ? includeTextures : false,
        texturePacking,
        units: unit,
        scale,
      }

      const worker = new Worker(
        new URL('../workers/export/export.worker.ts', import.meta.url),
        { type: 'module' }
      )
      workerRef.current = worker

      type ExportWorkerResult = { type: string; id: string; format: string; blob?: Blob; json?: object; obj?: string; mtl?: string; textures?: Array<{ name: string; blob: Blob }>; maps?: Array<{ name: string; blob: Blob }> }
      const result = await new Promise<ExportWorkerResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Export timed out'))
        }, 30000)

        worker.onmessage = (e) => {
          clearTimeout(timeout)
          const data = e.data
          if (data.type === 'export-error') {
            reject(new Error(data.error))
          } else if (data.id === id) {
            resolve(data)
          }
        }

        worker.onerror = (e) => {
          clearTimeout(timeout)
          reject(new Error(e.message || 'Export worker error'))
        }

        worker.postMessage({
          type: 'export',
          id,
          mesh,
          options,
          maps: mapsData,
        })
      })

      const projectName = useStore.getState().projectName.replace(/[^a-zA-Z0-9-_]/g, '_') || 'export'

      switch (result.format) {
        case 'glb':
          downloadBlob(result.blob!, `${projectName}.glb`)
          break
        case 'gltf': {
          downloadBlob(
            new Blob([JSON.stringify(result.json)], { type: 'application/json' }),
            `${projectName}.gltf`
          )
          for (const tex of result.textures ?? []) {
            downloadBlob(tex.blob, tex.name)
          }
          break
        }
        case 'obj': {
          downloadBlob(
            new Blob([result.obj!], { type: 'text/plain' }),
            `${projectName}.obj`
          )
          downloadBlob(
            new Blob([result.mtl!], { type: 'text/plain' }),
            `${projectName}.mtl`
          )
          break
        }
        case 'stl':
          downloadBlob(result.blob!, `${projectName}.stl`)
          break
        case 'maps-zip': {
          for (const m of result.maps ?? []) {
            downloadBlob(m.blob, m.name)
          }
          break
        }
      }

      close()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setExportError(msg)
      setError(msg)
    } finally {
      setExporting(false)
      setProcessing(false)
      if (workerRef.current) {
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [
    mesh, format, axis, includeTextures, texturePacking, unit, scale,
    showTextures, depthResult, maps,
    close, setProcessing, setError,
  ])

  if (!exportDialogOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !exporting) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Export"
    >
      <div className="bg-[var(--color-surface-raised)] rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in zoom-in-95 fade-in duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-[var(--color-text)]">Export</h2>
          <button
            onClick={close}
            disabled={exporting}
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-overlay)] transition-colors disabled:opacity-40"
            aria-label="Close export dialog"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {!mesh && (
          <div className="px-5 pb-5">
            <div className="rounded-lg bg-[var(--color-surface-overlay)] border border-[var(--color-border)] p-4 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                No mesh loaded. Import an image to create a mesh before exporting.
              </p>
            </div>
          </div>
        )}

        {mesh && (
          <div className="px-5 pb-5 space-y-5">
            {/* Format */}
            <fieldset>
              <legend className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                Format
              </legend>
              <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Export format">
                {FORMATS.map((f) => (
                  <label
                    key={f.value}
                    className={`flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-lg cursor-pointer transition-colors border text-center ${
                      format === f.value
                        ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-text)]'
                        : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="export-format"
                      value={f.value}
                      checked={format === f.value}
                      onChange={() => setFormat(f.value)}
                      disabled={exporting}
                      className="sr-only"
                    />
                    <span className="text-xs font-semibold leading-tight">{f.label}</span>
                    <span className="text-[9px] leading-tight opacity-70">{f.desc}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Settings */}
            <fieldset>
              <legend className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                Settings
              </legend>
              <div className="space-y-3">
                {/* Axis convention */}
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--color-text)]" htmlFor="export-axis">
                    Axis convention
                  </label>
                  <select
                    id="export-axis"
                    value={axis}
                    onChange={(e) => setAxis(e.target.value as AxisConvention)}
                    disabled={exporting}
                    className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors cursor-pointer"
                  >
                    {AXIS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.icon} {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Include textures — glTF / OBJ only */}
                {showTextures && (
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[var(--color-text)]">Include textures</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={includeTextures}
                      aria-label="Include textures"
                      onClick={() => setIncludeTextures(!includeTextures)}
                      disabled={exporting}
                      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
                        includeTextures ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-border)]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          includeTextures ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </label>
                )}

                {/* Texture packing — glTF with textures */}
                {showPacking && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-[var(--color-text)]" htmlFor="export-packing">
                      Texture packing
                    </label>
                    <select
                      id="export-packing"
                      value={texturePacking}
                      onChange={(e) => setTexturePacking(e.target.value as TexturePacking)}
                      disabled={exporting}
                      className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors cursor-pointer"
                    >
                      {PACKING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Units */}
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--color-text)]" htmlFor="export-unit">
                    Units
                  </label>
                  <select
                    id="export-unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                    disabled={exporting}
                    className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors cursor-pointer"
                  >
                    {UNIT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Scale */}
                <div className="space-y-1.5">
                  <label className="text-xs text-[var(--color-text)]" htmlFor="export-scale">
                    Scale
                  </label>
                  <input
                    id="export-scale"
                    type="number"
                    value={scale}
                    min={0.01}
                    max={100}
                    step={0.1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      if (!isNaN(v)) setScale(Math.min(100, Math.max(0.01, v)))
                    }}
                    disabled={exporting}
                    className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              </div>
            </fieldset>

            {/* Preview */}
            <div className="rounded-lg bg-[var(--color-surface-overlay)] border border-[var(--color-border)] p-3 space-y-1.5">
              <h3 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1">
                Preview
              </h3>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--color-text-muted)]">Triangles</span>
                <span className="tabular-nums text-[var(--color-text)]">
                  {viewportInfo?.triangleCount.toLocaleString() ?? '—'}
                </span>
              </div>
              {dims && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--color-text-muted)]">Dimensions</span>
                  <span className="tabular-nums text-[var(--color-text)]">
                    {dims.w.toFixed(2)} × {dims.h.toFixed(2)} × {dims.d.toFixed(2)} {unit === 'unitless' ? 'units' : unit}
                  </span>
                </div>
              )}
              {estimatedSize !== null && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--color-text-muted)]">Est. file size</span>
                  <span className="tabular-nums text-[var(--color-text)]">
                    {formatBytes(estimatedSize)}
                  </span>
                </div>
              )}
            </div>

            {/* Error */}
            {exportError && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-400">
                {exportError}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={close}
                disabled={exporting}
                className="px-4 py-2 rounded-lg text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-overlay)] transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleExport}
                disabled={exporting || !mesh}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {exporting && (
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {exporting ? 'Exporting...' : 'Download'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
