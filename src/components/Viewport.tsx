import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store/useStore';

function MeshScene() {
  const meshResult = useStore((s) => s.meshResult);
  const materialMode = useStore((s) => s.materialMode);
  const imageUrl = useStore((s) => s.imageUrl);
  const depthResult = useStore((s) => s.depthResult);

  const geometry = useMemo(() => {
    if (!meshResult) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(meshResult.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(meshResult.normals, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(meshResult.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(meshResult.indices, 1));
    geo.computeBoundingSphere();

    return geo;
  }, [meshResult]);

  const imageTexture = useMemo(() => {
    if (!imageUrl) return null;
    const tex = new THREE.TextureLoader().load(imageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [imageUrl]);

  const depthTexture = useMemo(() => {
    if (!depthResult) return null;
    const { width, height, data } = depthResult;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;

    for (let i = 0; i < width * height; i++) {
      const v = Math.floor(data[i] * 255);
      pixels[i * 4] = v;
      pixels[i * 4 + 1] = v;
      pixels[i * 4 + 2] = v;
      pixels[i * 4 + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, [depthResult]);

  if (!geometry) return null;

  const offset: [number, number, number] = [-0.5, -0.5, 0];

  const solidMaterial = (() => {
    switch (materialMode) {
      case 'textured':
        return imageTexture
          ? <meshStandardMaterial map={imageTexture} roughness={0.7} />
          : <meshStandardMaterial color="#cccccc" roughness={0.7} />;
      case 'normals':
        return <meshNormalMaterial />;
      case 'depth':
        return depthTexture
          ? <meshStandardMaterial map={depthTexture} roughness={1} metalness={0} />
          : <meshStandardMaterial color="#cccccc" roughness={0.7} />;
      case 'pbr':
        return imageTexture
          ? <meshStandardMaterial map={imageTexture} roughness={0.7} />
          : <meshStandardMaterial color="#cccccc" roughness={0.7} />;
      case 'wire':
        return <meshStandardMaterial color="#cccccc" roughness={0.7} transparent opacity={0.3} />;
      case 'shaded':
      default:
        return <meshStandardMaterial color="#cccccc" roughness={0.7} />;
    }
  })();

  return (
    <group position={offset}>
      <mesh geometry={geometry}>
        {solidMaterial}
      </mesh>
      {materialMode === 'wire' && (
        <mesh geometry={geometry}>
          <meshBasicMaterial color="#6366f1" wireframe />
        </mesh>
      )}
    </group>
  );
}

function LoadingOverlay() {
  const isProcessing = useStore((s) => s.isProcessing);
  const processingMessage = useStore((s) => s.processingMessage);

  if (!isProcessing) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(26, 26, 46, 0.6)',
        zIndex: 10,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: '3px solid rgba(99, 102, 241, 0.2)',
          borderTopColor: '#6366f1',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      {processingMessage && (
        <p style={{ marginTop: 12, color: '#94a3b8', fontSize: 13 }}>
          {processingMessage}
        </p>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function Viewport() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        className="viewport-canvas"
        gl={{ antialias: true, alpha: false }}
        camera={{ position: [1.5, 1.5, 1.5], fov: 50 }}
        style={{ background: '#1a1a2e', width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={0.8} />
        <directionalLight position={[-3, 2, -1]} intensity={0.3} />

        <Grid
          args={[10, 10]}
          position={[0, 0, 0]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#3b3b5c"
          sectionSize={1}
          sectionThickness={1}
          sectionColor="#4f46e5"
          fadeDistance={15}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid
        />

        <Suspense fallback={null}>
          <MeshScene />
        </Suspense>

        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          minDistance={0.1}
          maxDistance={20}
        />
      </Canvas>
      <LoadingOverlay />
    </div>
  );
}
