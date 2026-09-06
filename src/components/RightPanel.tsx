import { useStore } from '../store/useStore'

const CAPABILITY_LABELS: Record<string, { label: string; color: string }> = {
  webgpu: { label: 'WebGPU', color: 'bg-green-500/20 text-green-400' },
  wasm: { label: 'WASM', color: 'bg-yellow-500/20 text-yellow-400' },
  unavailable: { label: 'Unavailable', color: 'bg-red-500/20 text-red-400' },
}

export default function RightPanel() {
  const mesh = useStore((s) => s.mesh)
  const maps = useStore((s) => s.maps)
  const tiling = useStore((s) => s.tiling)
  const units = useStore((s) => s.units)
  const axisConvention = useStore((s) => s.axisConvention)
  const capability = useStore((s) => s.capability)
  const meshResult = useStore((s) => s.meshResult)
  const viewportInfo = useStore((s) => s.viewportInfo)

  const setMeshParams = useStore((s) => s.setMeshParams)
  const setMapParams = useStore((s) => s.setMapParams)
  const setTilingParams = useStore((s) => s.setTilingParams)
  const setUnitParams = useStore((s) => s.setUnitParams)
  const setAxisConvention = useStore((s) => s.setAxisConvention)

  const cap = CAPABILITY_LABELS[capability] ?? CAPABILITY_LABELS.unavailable

  const dims = meshResult
    ? {
        w: (meshResult.bounds.max[0] - meshResult.bounds.min[0]) * units.scale,
        h: (meshResult.bounds.max[1] - meshResult.bounds.min[1]) * units.scale,
        d: (meshResult.bounds.max[2] - meshResult.bounds.min[2]) * units.scale,
      }
    : null

  return (
    <aside
      className="w-72 bg-[var(--color-surface-raised)] border-l border-[var(--color-border)] overflow-y-auto shrink-0 select-none"
      aria-label="Right panel"
    >
      {/* Mesh section */}
      <Section title="Mesh">
        <fieldset>
          <legend className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
            Style
          </legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Mesh style">
            <RadioCard
              name="mesh-style"
              value="plane"
              checked={mesh.style === 'plane'}
              label="Plane"
              description="Flat surface"
              onChange={() => setMeshParams({ style: 'plane' })}
            />
            <RadioCard
              name="mesh-style"
              value="plate"
              checked={mesh.style === 'plate'}
              label="Plate"
              description="Solid with thickness"
              onChange={() => setMeshParams({ style: 'plate' })}
            />
          </div>
        </fieldset>

        {mesh.style === 'plate' && (
          <SliderRow
            label="Base thickness"
            value={mesh.baseThickness}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(v) => setMeshParams({ baseThickness: v })}
          />
        )}
      </Section>

      {/* PBR Maps section */}
      <Section title="PBR Maps">
        {/* Normal map */}
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-text)]">Normal map</span>
            <ToggleSwitch
              checked={maps.normal.enabled}
              onChange={(v) => setMapParams({ normal: { ...maps.normal, enabled: v } })}
              aria-label="Enable normal map"
            />
          </label>
          {maps.normal.enabled && (
            <>
              <SliderRow
                label="Strength"
                value={maps.normal.strength}
                min={0}
                max={3}
                step={0.1}
                onChange={(v) => setMapParams({ normal: { ...maps.normal, strength: v } })}
              />
              <label className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-[var(--color-text-muted)]">Flip Y</span>
                <ToggleSwitch
                  checked={maps.normal.flipY}
                  onChange={(v) => setMapParams({ normal: { ...maps.normal, flipY: v } })}
                  aria-label="Flip normal map Y"
                />
              </label>
            </>
          )}
        </div>

        {/* AO map */}
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-text)]">AO map</span>
            <ToggleSwitch
              checked={maps.ao.enabled}
              onChange={(v) => setMapParams({ ao: { ...maps.ao, enabled: v } })}
              aria-label="Enable AO map"
            />
          </label>
          {maps.ao.enabled && (
            <SliderRow
              label="Intensity"
              value={maps.ao.intensity}
              min={0}
              max={3}
              step={0.1}
              onChange={(v) => setMapParams({ ao: { ...maps.ao, intensity: v } })}
            />
          )}
        </div>

        {/* Roughness map */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-text)]">Roughness</span>
          </div>
          <fieldset>
            <legend className="sr-only">Roughness mode</legend>
            <div className="flex gap-2" role="radiogroup" aria-label="Roughness mode">
              <RadioCard
                name="roughness-mode"
                value="constant"
                checked={maps.roughness.mode === 'constant'}
                label="Constant"
                description="Fixed value"
                onChange={() => setMapParams({ roughness: { ...maps.roughness, mode: 'constant' } })}
              />
              <RadioCard
                name="roughness-mode"
                value="fromLuma"
                checked={maps.roughness.mode === 'fromLuma'}
                label="From Luma"
                description="Luminance-based"
                onChange={() => setMapParams({ roughness: { ...maps.roughness, mode: 'fromLuma' } })}
              />
            </div>
          </fieldset>
          {maps.roughness.mode === 'constant' && (
            <SliderRow
              label="Value"
              value={maps.roughness.value}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setMapParams({ roughness: { ...maps.roughness, value: v } })}
            />
          )}
        </div>

        {/* Height map */}
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text)]">Height map</span>
          <ToggleSwitch
            checked={maps.height.enabled}
            onChange={(v) => setMapParams({ height: { ...maps.height, enabled: v } })}
            aria-label="Enable height map"
          />
        </label>
      </Section>

      {/* Tiling section */}
      <Section title="Tiling">
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text)]">Enable tiling</span>
          <ToggleSwitch
            checked={tiling.enabled}
            onChange={(v) => setTilingParams({ enabled: v })}
            aria-label="Enable tiling"
          />
        </label>
        {tiling.enabled && (
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              label="Tiles X"
              value={tiling.tilesX}
              min={1}
              max={10}
              onChange={(v) => setTilingParams({ tilesX: v })}
            />
            <NumberInput
              label="Tiles Y"
              value={tiling.tilesY}
              min={1}
              max={10}
              onChange={(v) => setTilingParams({ tilesY: v })}
            />
          </div>
        )}
      </Section>

      {/* Units section */}
      <Section title="Units">
        <SliderRow
          label="Scale"
          value={units.scale}
          min={0.01}
          max={100}
          step={0.1}
          onChange={(v) => setUnitParams({ scale: v })}
          withNumericInput
        />

        <div className="space-y-1.5">
          <label
            className="text-xs text-[var(--color-text)]"
            htmlFor="unit-select"
          >
            Unit
          </label>
          <select
            id="unit-select"
            value={units.unit}
            onChange={(e) => setUnitParams({ unit: e.target.value as 'm' | 'cm' | 'mm' | 'unitless' })}
            className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors cursor-pointer"
            aria-label="Unit"
          >
            <option value="m">Meters (m)</option>
            <option value="cm">Centimeters (cm)</option>
            <option value="mm">Millimeters (mm)</option>
            <option value="unitless">Unitless</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs text-[var(--color-text)]"
            htmlFor="axis-select"
          >
            Axis convention
          </label>
          <select
            id="axis-select"
            value={axisConvention}
            onChange={(e) => setAxisConvention(e.target.value as 'gltf' | 'unity' | 'unreal')}
            className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors cursor-pointer"
            aria-label="Axis convention"
          >
            <option value="gltf">glTF (Y-up)</option>
            <option value="unity">Unity (Y-up, left-hand)</option>
            <option value="unreal">Unreal (Z-up)</option>
          </select>
        </div>

        {dims && (
          <p className="text-[11px] text-[var(--color-text-muted)] tabular-nums">
            Exports as {dims.w.toFixed(2)} {units.unit === 'unitless' ? 'units' : units.unit} ×{' '}
            {dims.h.toFixed(2)} {units.unit === 'unitless' ? 'units' : units.unit} ×{' '}
            {dims.d.toFixed(2)} {units.unit === 'unitless' ? 'units' : units.unit}
          </p>
        )}
      </Section>

      {/* Viewport info (always visible) */}
      <div className="p-4 space-y-2">
        <h3 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider leading-none">
          Viewport
        </h3>
        <div className="space-y-1 text-[11px] text-[var(--color-text-muted)]">
          <div className="flex items-center justify-between">
            <span>Triangles</span>
            <span className="tabular-nums text-[var(--color-text)]">
              {viewportInfo?.triangleCount.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Vertices</span>
            <span className="tabular-nums text-[var(--color-text)]">
              {viewportInfo?.vertexCount.toLocaleString() ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Dimensions</span>
            <span className="tabular-nums text-[var(--color-text)]">
              {viewportInfo
                ? `${viewportInfo.dimensions.width.toFixed(2)} × ${viewportInfo.dimensions.height.toFixed(2)} × ${viewportInfo.dimensions.depth.toFixed(2)}`
                : '—'}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[11px] text-[var(--color-text-muted)]">Device</span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cap.color}`}>
            {cap.label}
          </span>
        </div>
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 space-y-3 border-b border-[var(--color-border)]">
      <h3 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider leading-none">
        {title}
      </h3>
      {children}
    </div>
  )
}

function RadioCard({
  name,
  value,
  checked,
  label,
  description,
  onChange,
}: {
  name: string
  value: string
  checked: boolean
  label: string
  description: string
  onChange: () => void
}) {
  return (
    <label
      className={`flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded cursor-pointer transition-colors border ${
        checked
          ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)]'
          : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="text-xs font-semibold text-[var(--color-text)]">{label}</span>
      <span className="text-[10px] text-[var(--color-text-muted)] leading-tight text-center">
        {description}
      </span>
    </label>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  withNumericInput,
  integer,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  withNumericInput?: boolean
  integer?: boolean
}) {
  const displayValue = integer ? Math.round(value) : value

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-[var(--color-text)]" htmlFor={`slider-${label}`}>
          {label}
        </label>
        {withNumericInput ? (
          <input
            type="number"
            value={displayValue}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
            }}
            className="w-14 bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-[11px] text-right px-1.5 py-0.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label={`${label} value`}
          />
        ) : (
          <span className="text-[11px] text-[var(--color-text-muted)] tabular-nums min-w-[2.5rem] text-right">
            {displayValue}
          </span>
        )}
      </div>
      <input
        id={`slider-${label}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
        aria-label={`${label} slider`}
      />
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-border)]'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] text-[var(--color-text-muted)]" htmlFor={`num-${label}`}>
        {label}
      </label>
      <input
        id={`num-${label}`}
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10)
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
        }}
        className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        aria-label={label}
      />
    </div>
  )
}
