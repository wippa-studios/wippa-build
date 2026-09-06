import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore'
import type { MaterialMode } from '../types'

const MATERIAL_MODES: MaterialMode[] = ['shaded', 'textured', 'pbr', 'normals', 'wire', 'depth']

const MATERIAL_LABELS: Record<MaterialMode, string> = {
  shaded: 'Shaded',
  textured: 'Textured',
  pbr: 'PBR',
  normals: 'Normals',
  wire: 'Wire',
  depth: 'Depth',
}

export default function Header() {
  const projectName = useStore((s) => s.projectName)
  const materialMode = useStore((s) => s.materialMode)
  const image = useStore((s) => s.image)
  const leftPanelOpen = useStore((s) => s.leftPanelOpen)
  const rightPanelOpen = useStore((s) => s.rightPanelOpen)
  const setProjectName = useStore((s) => s.setProjectName)
  const setMaterialMode = useStore((s) => s.setMaterialMode)
  const setLeftPanelOpen = useStore((s) => s.setLeftPanelOpen)
  const setRightPanelOpen = useStore((s) => s.setRightPanelOpen)
  const setExportDialogOpen = useStore((s) => s.setExportDialogOpen)
  const clearProject = useStore((s) => s.clearProject)
  const saveProject = useStore((s) => s.saveProject)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(projectName)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed) setProjectName(trimmed)
    else setDraft(projectName)
    setEditing(false)
  }

  return (
    <header className="flex items-center justify-between h-12 px-3 bg-[var(--color-surface-raised)] border-b border-[var(--color-border)] select-none shrink-0">
      {/* Left — brand */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[var(--color-brand)] text-lg leading-none">⬡</span>
        <span className="text-[var(--color-text)] font-semibold text-sm tracking-tight whitespace-nowrap">
          wippa-build
        </span>
      </div>

      {/* Center-left — project name */}
      <div className="flex items-center ml-4 min-w-0 flex-1 max-w-xs">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(projectName)
                setEditing(false)
              }
            }}
            className="bg-[var(--color-surface-overlay)] text-[var(--color-text)] text-sm px-2 py-0.5 rounded border border-[var(--color-brand)] outline-none w-full"
            aria-label="Edit project name"
          />
        ) : (
          <button
            onClick={() => {
              setDraft(projectName)
              setEditing(true)
            }}
            className="text-[var(--color-text-muted)] text-sm hover:text-[var(--color-text)] truncate cursor-text transition-colors"
            aria-label={`Project name: ${projectName}. Click to edit.`}
          >
            {projectName}
          </button>
        )}
      </div>

      {/* Center — toggle & mode controls */}
      <div className="flex items-center gap-1 mx-2">
        {/* Left panel toggle */}
        <button
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
          className={`p-1.5 rounded text-xs transition-colors ${
            leftPanelOpen
              ? 'bg-[var(--color-surface-overlay)] text-[var(--color-text)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
          aria-label={leftPanelOpen ? 'Hide left panel' : 'Show left panel'}
          aria-pressed={leftPanelOpen}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <line x1="6" y1="2" x2="6" y2="14" />
          </svg>
        </button>

        {/* Right panel toggle */}
        <button
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          className={`p-1.5 rounded text-xs transition-colors ${
            rightPanelOpen
              ? 'bg-[var(--color-surface-overlay)] text-[var(--color-text)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
          aria-label={rightPanelOpen ? 'Hide right panel' : 'Show right panel'}
          aria-pressed={rightPanelOpen}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <line x1="10" y1="2" x2="10" y2="14" />
          </svg>
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

        {/* Material mode chips */}
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="Material mode">
          {MATERIAL_MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => setMaterialMode(mode)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium leading-tight transition-colors whitespace-nowrap ${
                materialMode === mode
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-overlay)]'
              }`}
              role="radio"
              aria-checked={materialMode === mode}
              aria-label={MATERIAL_LABELS[mode]}
            >
              {MATERIAL_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* Right — actions */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => clearProject()}
          className="px-2.5 py-1 rounded text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-overlay)] transition-colors"
          aria-label="New project"
        >
          New
        </button>
        {image && (
          <>
            <button
              onClick={() => saveProject()}
              className="px-2.5 py-1 rounded text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-overlay)] transition-colors"
              aria-label="Save project"
            >
              Save
            </button>
            <button
              onClick={() => setExportDialogOpen(true)}
              className="px-2.5 py-1 rounded text-xs font-medium bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)] transition-colors"
              aria-label="Export project"
            >
              Export
            </button>
          </>
        )}
      </div>
    </header>
  )
}
