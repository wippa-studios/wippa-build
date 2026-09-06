import { useCallback } from 'react'
import { useStore } from './store/useStore'
import Header from './components/Header'
import LeftPanel from './components/LeftPanel'
import RightPanel from './components/RightPanel'
import Viewport from './components/Viewport'
import ExportDialog from './components/ExportDialog'
import { useCallback as useCallbackRef } from 'react'

export default function App() {
  const image = useStore((s) => s.image)
  const leftPanelOpen = useStore((s) => s.leftPanelOpen)
  const rightPanelOpen = useStore((s) => s.rightPanelOpen)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      useStore.getState().loadImage(file)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[var(--color-surface)]">
      <Header />
      <div className="flex flex-1 min-h-0">
        {leftPanelOpen && <LeftPanel />}
        <div
          className="flex-1 relative"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <Viewport />
          {!image && <DropZone />}
        </div>
        {rightPanelOpen && <RightPanel />}
      </div>
    </div>
  )
}

function DropZone() {
  const loadImage = useStore((s) => s.loadImage)

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) {
      loadImage(file)
    }
  }, [loadImage])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleClick = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) loadImage(file)
    }
    input.click()
  }, [loadImage])

  const loadSample = useCallback(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(256, 256, 30, 256, 256, 200)
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.5, '#888888')
    gradient.addColorStop(1, '#222222')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 512, 512)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 64px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('WIPPA', 256, 256)
    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], 'sample.png', { type: 'image/png' })
        loadImage(file)
      }
    })
  }, [loadImage])

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      <div
        className="pointer-events-auto border-2 border-dashed border-[var(--color-border)] rounded-xl p-12 text-center cursor-pointer hover:border-[var(--color-brand)] transition-colors max-w-md"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={handleClick}
      >
        <div className="text-4xl mb-4 opacity-40">⬡</div>
        <p className="text-[var(--color-text)] text-lg font-medium mb-2">
          Drop an image here
        </p>
        <p className="text-[var(--color-text-muted)] text-sm mb-4">
          or click to browse
        </p>
        <p className="text-[var(--color-text-muted)] text-xs">
          PNG, JPEG, WebP — up to 4096×4096
        </p>
        <button
          className="mt-4 text-xs text-[var(--color-brand-light)] hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            loadSample()
          }}
        >
          Try a sample image
        </button>
      </div>
    </div>
  )
}
