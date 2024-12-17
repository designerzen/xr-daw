import { ChangeEvent, useRef, useState } from "react"
import React from "react"

export function Uploader({ accept = "audio/midi", callback=()=>{}, label=null }: { accept?: string, callback?: (file: File) => void, label?:string})  {
  const [midiFile, setMIDIFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState("Loading...")
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const updateFile = (file) => {
    setMIDIFile(file)
    setFileName(file.name)
    callback(file)
  }

  const updateMIDIFile = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0]
      updateFile(file)
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }


  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)

    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      const file = event.dataTransfer.files[0]
      updateFile(file)
    }
  }

  return (
    <div style={{
            position: "fixed",
            inset: "0",
            fontSize: "20px",
            zIndex:"101",
            padding: "20px",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleFileDrop}
        onClick={handleUploadClick}>
     
        {midiFile ? (

          <p style={{
            position: "fixed",
            inset: "0",
            fontSize: "20px",
            left:"50%",
            top:"40%",
            textAlign:"center",
            transform:"translateX(-50%)"
        }}>
            MIDI File loaded {fileName}
        </p>
          
        ) : (
          <label htmlFor="file-input">{ label ? label : (<>Choose file or drag it here</>)}</label>
        )}
        <input
          ref={fileInputRef}
          id="file-input"
          type="file"
          accept={accept}
          style={{ display: "none" }}
          onChange={updateMIDIFile}
        />
    </div>
  )
}
