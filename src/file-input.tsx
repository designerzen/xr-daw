'use client'

import { useState, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { SceneObjects } from './3d-scene'
import { Upload, File, X } from 'lucide-react'

interface MidiFileInfo {
  name: string;
  size: string;
  lastModified: string;
}

export default function FileInput() {
  const [isDragging, setIsDragging] = useState(false)
  const [fileInfo, setFileInfo] = useState<MidiFileInfo | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const handleFile = (file: File) => {
    const info: MidiFileInfo = {
      name: file.name,
      size: formatFileSize(file.size),
      lastModified: new Date(file.lastModified).toLocaleString()
    }
    setFileInfo(info)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' bytes'
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    else return (bytes / 1048576).toFixed(1) + ' MB'
  }

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveFile = () => {
    setFileInfo(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="relative w-full h-screen">
      {/* 3D Background */}
      <div className="absolute inset-0">
        <Canvas camera={{ position: [0, 0, 20], fov: 60 }}>
          <color attach="background" args={['#f0f0f0']} />
          <ambientLight intensity={0.8} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          <pointLight position={[-10, -10, -10]} intensity={0.5} />
          
          <SceneObjects count={50} />
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
          
          <OrbitControls enableZoom={false} enablePan={false} />
        </Canvas>
      </div>

      {/* File Input UI */}
      <div 
        className="relative z-10 flex items-center justify-center w-full h-screen"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div
          className={`
            p-8 rounded-lg backdrop-blur-md bg-white/80
            border-2 border-dashed transition-all duration-200
            ${isDragging ? 'border-green-500 scale-105' : 'border-gray-400'}
          `}
          onClick={fileInfo ? undefined : handleClick}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept=".mid,.midi"
          />
          
          {fileInfo ? (
            <div className="flex flex-col items-center gap-4 text-blue-900">
              <div className="flex items-center justify-between w-full">
                <File className="w-8 h-8" />
                <button onClick={handleRemoveFile} className="text-red-500 hover:text-red-700">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="text-center">
                <p className="text-lg font-medium">{fileInfo.name}</p>
                <p className="text-sm opacity-70">Size: {fileInfo.size}</p>
                <p className="text-sm opacity-70">Last Modified: {fileInfo.lastModified}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-blue-900">
              <Upload className="w-12 h-12" />
              <div className="text-center">
                <p className="text-lg font-medium">
                  Drop your MIDI file here, or click to select
                </p>
                <p className="text-sm opacity-70">
                  Supports MIDI format (.mid, .midi)
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

