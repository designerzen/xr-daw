import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function FloatingObject({ geometry, color, position }: any) {
  const mesh = useRef<THREE.Mesh>(null)

  useFrame((state, delta) => {
    if (mesh.current) {
      mesh.current.rotation.x += delta * 0.5
      mesh.current.rotation.y += delta * 0.3
      mesh.current.position.y = position[1] + Math.sin(state.clock.elapsedTime + position[0]) * 0.3
    }
  })

  return (
    <mesh ref={mesh} position={position}>
      {geometry}
      <meshPhysicalMaterial 
        color={color} 
        emissive={color} 
        emissiveIntensity={0.4} 
        metalness={0.1} 
        roughness={0.2} 
      />
    </mesh>
  )
}

const objectTypes = [
  { geometry: <boxGeometry args={[1, 1, 1]} />, color: '#FF6B6B' },
  { geometry: <sphereGeometry args={[0.5, 32, 32]} />, color: '#4ECDC4' },
  { geometry: <coneGeometry args={[0.5, 1, 32]} />, color: '#FFD93D' },
  { geometry: <torusGeometry args={[0.3, 0.2, 16, 100]} />, color: '#FF8811' },
]

export function Wallpaper({ count }: { count: number }) {
  const objects = Array.from({ length: count }, (_, i) => {
    const type = objectTypes[i % objectTypes.length]
    return {
      ...type,
      key: `object-${i}`,
      position: [
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15
      ]
    }
  })

  return (
    <>
      {objects.map((obj) => (
        <FloatingObject
          key={obj.key}
          geometry={obj.geometry}
          color={obj.color}
          position={obj.position}
        />
      ))}
    </>
  )
}

