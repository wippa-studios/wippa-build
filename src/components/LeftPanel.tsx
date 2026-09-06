import { useRef } from 'react'
import { useStore } from '../store/useStore'
import type { ReliefSource } from '../types'

const RESOLUTION_OPTIONS = [64, 128, 256, 512, 1024, 2048] as const

const RELIEF_SOURCES: { value: ReliefSource; label: string; description: string }[] = [
  { value: 'luma', label: 'Luminance', description: 'Bright = high' },
  { value: 'invLuma', label: 'Inv. Luminance', description: 'Dark = high' },
  { value: 'alpha', label: 'Alpha', description: 'Opacity channel' },
]

const CAPABILITY_LABELS: Record<string, { label: string; color: string }> = {
  webgpu: { label: 'WebGPU', color: 'bg-green-500/20 text-green-400' },
  wasm: { label: 'WASM', color: 'bg-yellow-500/20 text-yellow-400' },
  unavailable: { label: 'Unavailable', color: 'bg-red-500/20 text-red-400' },
}

export default function LeftPanel() {
  const image = useStore((s) => s.image)
  const imageUrl = useStore((s) => s.imageUrl)
  const imageWidth = useStore((s) => s.imageWidth)
  const imageHeight = useStore((s) => s.imageHeight)
  const mode = useStore((s) => s.mode)
  const resolution = useStore((s) => s.resolution)
  const depthScale = useStore((s) => s.depthScale)
  const smoothing = useStore((s) => s.smoothing)
  const relief = useStore((s) => s.relief)
  const ai = useStore((s) => s.ai)
  const capability = useStore((s) => s.capability)

  const loadImage = useStore((s) => s.loadImage)
  const setMode = useStore((s) => s.setMode)
  const setResolution = useStore((s) => s.setResolution)
  const setDepthScale = useStore((s) => s.setDepthScale)
  const setSmoothing = useStore((s) => s.setSmoothing)
  const setReliefParams = useStore((s) => s.setReliefParams)
  const setAiParams = useStore((s) => s.setAiParams)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadImage(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const cap = CAPABILITY_LABELS[capability] ?? CAPABILITY_LABELS.unavailable

  return (
    <aside
      className="w-72 bg-[var(--color-surface-raised)] border-r border-[var(--color-border)] overflow-y-auto shrink-0 select-none"
      aria-label="Left panel"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Image section */}
      <Section title="Image">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded border border-dashed border-[var(--color-border)] hover:border-[var(--color-brand)] transition-colors overflow-hidden text-left"
          aria-label={image ? 'Change loaded image' : 'Load an image'}
        >
          {imageUrl ? (
            <div className="flex items-center gap-3 p-2">
              <img
                src={imageUrl}
                alt="Loaded source"
                className="w-14 h-14 rounded object-cover bg-[var(--color-surface)]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-[var(--color-text)] truncate">
                  {image?.name ?? 'Image'}
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                  {imageWidth} x {imageHeight}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 gap-1.5">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="text-[var(--color-text-muted)]"
              >
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <span className="text-[11px] text-[var(--color-text-muted)]">
                Click to load image
              </span>
            </div>
          )}
        </button>
      </Section>

      {/* Mode section */}
      <Section title="Mode">
        <div className="flex gap-2" role="radiogroup" aria-label="Processing mode">
          <RadioCard
            name="mode"
            value="ai"
            checked={mode === 'ai'}
            label="AI"
            description="Neural depth estimation"
            onChange={() => setMode('ai')}
          />
          <RadioCard
            name="mode"
            value="relief"
            checked={mode === 'relief'}
            label="Relief"
            description="Heightmap from image"
            onChange={() => setMode('relief')}
          />
        </div>
      </Section>

      {/* Relief section */}
      {mode === 'relief' && (
        <Section title="Relief">
          <fieldset>
            <legend className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
              Source
            </legend>
            <div className="space-y-1.5" role="radiogroup" aria-label="Relief source">
              {RELIEF_SOURCES.map((src) => (
                <label
                  key={src.value}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded cursor-pointer transition-colors ${
                    relief.source === src.value
                      ? 'bg-[var(--color-brand)]/10 text-[var(--color-text)]'
                      : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-overlay)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="relief-source"
                    value={src.value}
                    checked={relief.source === src.value}
                    onChange={() => setReliefParams({ source: src.value })}
                    className="sr-only"
                  />
                  <span
                    className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      relief.source === src.value
                        ? 'border-[var(--color-brand)]'
                        : 'border-[var(--color-border)]'
                    }`}
                  >
                    {relief.source === src.value && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand)]" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-xs font-medium">{src.label}</span>
                    <span className="text-[10px] text-[var(--color-text-muted)] ml-1.5">
                      {src.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <SliderRow
            label="Gamma"
            value={relief.gamma}
            min={0.1}
            max={3.0}
            step={0.1}
            onChange={(v) => setReliefParams({ gamma: v })}
          />

          <SliderRow
            label="Contrast"
            value={relief.contrast}
            min={-1.0}
            max={1.0}
            step={0.05}
            onChange={(v) => setReliefParams({ contrast: v })}
          />
        </Section>
      )}

      {/* AI section */}
      {mode === 'ai' && (
        <Section title="AI">
          <label className="flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--color-text)]">Invert depth</span>
            <ToggleSwitch
              checked={ai.invert}
              onChange={(v) => setAiParams({ invert: v })}
              aria-label="Invert depth"
            />
          </label>

          <div className="flex items-center justify-between mt-2">
            <span className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider">
              Device
            </span>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${cap.color}`}>
              {cap.label}
            </span>
          </div>
        </Section>
      )}

      {/* Resolution section */}
      <Section title="Resolution">
        <label className="text-xs text-[var(--color-text)] block mb-1.5">
          Mesh resolution
        </label>
        <select
          value={resolution}
          onChange={(e) => setResolution(Number(e.target.value))}
          className="w-full bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-xs px-2.5 py-1.5 rounded border border-[var(--color-border)] outline-none focus:border-[var(--color-brand)] transition-colors cursor-pointer"
          aria-label="Mesh resolution"
        >
          {RESOLUTION_OPTIONS.map((res) => (
            <option key={res} value={res}>
              {res} x {res}
            </option>
          ))}
        </select>
      </Section>

      {/* Depth Scale section */}
      <Section title="Depth Scale">
        <SliderRow
          label="Scale"
          value={depthScale}
          min={0}
          max={2}
          step={0.05}
          onChange={setDepthScale}
          withNumericInput
        />
      </Section>

      {/* Smoothing section */}
      <Section title="Smoothing">
        <SliderRow
          label="Smoothing"
          value={smoothing}
          min={0}
          max={32}
          step={1}
          onChange={setSmoothing}
          withNumericInput
          integer
        />
      </Section>
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
