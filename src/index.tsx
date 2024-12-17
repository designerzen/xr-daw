/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Environment, Gltf, Text, Text3D, PerspectiveCamera, Stars, Sky, Cloud, Clouds } from "@react-three/drei"
import { XR, createXRStore } from "@react-three/xr"

import ReactDOM from "react-dom/client"
import { suspend } from 'suspend-react'

import { Bullets } from "./bullets"
import { Gun } from "./gun"
import { Score } from "./score"
import { Target } from "./targets"
import { MusicEvents } from "./music-events"

import { loadMIDIFile, loadMIDIFileThroughClient } from "./audio/midi/midi-file"

import gsap from "gsap"
import { useEffect, useState } from "react"
import useTimer from "./hooks/useTimer"
// import useKeyboard from "./hooks/useKeyboard"
import {useKeyboard} from 'react-aria'
import { Uploader } from "./uploader"
import { DAW } from "./daw"
import { Wallpaper } from "./wallpaper"

import "./index.css"
import { MeshBasicMaterial, MeshLambertMaterial } from "three"

// -----------------------------------------------------------------------------
// Requires a user action so useEffect cannot be used here
const createBackend = async () => {

  // Create our audio pipelines
  const audioContext = new AudioContext()
  if (audioContext.state === 'suspended') {
    audioContext.resume()
  }


  // Create timing loop
  // const clock = new AudioTimer( audioContext )

  // -----------------------------------------------------------------------------
  // MIDI File options
  // const options = {}
  // Load in the MIDI file from the file requester (or embed the file as base 64)
  // const midiFile = await loadMIDIFileThroughClient( file, {}, (output)=>{
  //   console.info("midi file loaded", file, " BPM", output)
  // } )

  // // Load in a local MIDI file from a relative URI
  // const midiFile = await loadMIDIFile( "./assets/midi/midi_nyan-cat.mid", options, (values)=>{
  //   // console.info("midi file loaded", options, {values} )
  // } )

  // console.info("Midi file loaded", midiFile)

  return { audioContext }
}


// -----------------------------------------------------------------------------
// Shared data store
const xrStore = createXRStore({
  emulate: {
    controller: {
      left: {
        position: [-0.15649, 1.43474, -0.38368],
        quaternion: [
          0.14766305685043335, -0.02471366710960865, -0.0037767395842820406,
          0.9887216687202454,
        ],
      },
      right: {
        position: [0.15649, 1.43474, -0.38368],
        quaternion: [
          0.14766305685043335, 0.02471366710960865, -0.0037767395842820406,
          0.9887216687202454,
        ],
      },
    },
  },
  controller: {
    right: Gun,
  }
})

const GsapTicker = () => {
  useFrame(() => {
    gsap.ticker.tick()
  })
  return null
}


const world = import('@pmndrs/assets/hdri/sky.exr')
const fontInter = import('@pmndrs/assets/fonts/inter_regular.woff')
const fontInterBold = import('@pmndrs/assets/fonts/inter_bold.json')

const App = () => {

  const [started, setStarted] = useState(false)
  const [track, setTrack] = useState(null)
  const [audioContext, setAudioContext] = useState(null)
  // const keyboard = useKeyboard()

  const DEFAULT_MIDI_FILE = "./assets/midi/Stories_100BPM_Gmin.mid"
  // const DEFAULT_MIDI_FILE = "./assets/midi/midi_nyan-cat.mid"
  let active = false
  
  const initialCameraPosition = [0, 0, 0]
  const [cameraPosition, setCameraPosition] = useState(initialCameraPosition)

  const cameraRotation = [90, 0, 0]
  const cameraFieldOfView = 65

  const uploadMIDIFile = async (file) => {
    const midiFile = await loadMIDIFileThroughClient( file, {}, (output)=>{
      console.info("midi file loaded", file, " raw:", output)
    } )
    setTrack(midiFile)
  }
  
  const loadDefaultMIDIFile = async (options={}) => {
    // Load in a local MIDI file from a relative URI
    const midiFile = await loadMIDIFile( DEFAULT_MIDI_FILE, options, (values)=>{
      // console.info("midi file loaded", options, {values} )
    } )
    setTrack(midiFile)
  }

  // Create the front and backends
  const createClient = async() => {

    if (started){
      console.warn("Already started")
      return
    }

    if (!track)
    {
      console.info("Using default MIDI track")
      return await loadDefaultMIDIFile()
    }
      
    // Create our audio pipelines
    const context = new AudioContext()
    
    if (context.state === 'suspended') {
      context.resume()
    }

    // console.info("create Client")
    xrStore.enterVR()
    setAudioContext(context)
    setStarted(true)
  }

  useEffect(() => {
    if (track)
    {
      createClient()
      console.info("useEffect")
    }else{
      console.info("useEffect - ignored")
    }
    return ()=>{
      // clean up
    }
  }, [track])

  return (
    <>
      <Canvas
        style={{
          position: "fixed",
          width: "100vw",
          height: "100vh",
        }}
      >
        <PerspectiveCamera makeDefault position={initialCameraPosition} angle={cameraRotation} fov={cameraFieldOfView} />
        { 
          track !== null && audioContext !== null ? 
            <group>
              <DAW audioContext={audioContext} track={track}/>
              <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
              <color args={[0x101010]} attach={"background"}></color>
            </group>      
           : 
            <group>
              <Text position={[-1,-1,-7]} font={suspend(fontInter).default}>Drag MIDI File here or click to select</Text>
              <Text3D position={[-10,-1,-48]} font={suspend(fontInterBold).default}>XRDAW</Text3D>
              <Wallpaper count={50} />
              {/* https://drei.docs.pmnd.rs/staging/environment preset="warehouse" */}
           
              <color args={[0x505050]} attach={"background"}></color>
            </group>
        }
     
        <Clouds material={MeshBasicMaterial }>  
          <Cloud opacity={0.2} segments={20} bounds={[5, 1, 1]} volume={6} color="orange" />
          <Cloud opacity={0.2} seed={1} scale={2} volume={5} color="hotpink" fade={100} />
        </Clouds>
      
        <Sky distance={450000} sunPosition={[0, 1, 0]} inclination={0} azimuth={0.25}/>
             
       <Environment files={suspend(world).default} />
        {/* <Gltf src="assets/actors/spacestation.glb" /> */}
            
        {/* <Bullets /> */}

        {/* <group rotation-x={-Math.PI / 8}>
          <Target targetIdx={0} />
          <Target targetIdx={1} />
          <Target targetIdx={2} />
        </group> */}
        
        {/* <Score /> */}
      
        <GsapTicker />
        <XR store={xrStore}></XR>
      </Canvas>

      <div
        className="overlay"
        style={{
          position: "fixed",
          display: "flex",
          width: "100vw",
          height: "100vh",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "center",
          color: "black",
          fontFamily: "SpaceMono-Bold, sans-serif",
        }}
      >
        <Uploader 
          label="Drag and drop MIDI file here or press to load one from your device"
          callback={uploadMIDIFile} />

        {/* <p>Tempo: {timer?.BPM}</p>
        <p>Beat: {beat?.bar}</p> */}
        {/* <p>progress: {progress}</p> */}

        { !started && 
                <button
                  className="button-start"
                  onClick={() => loadDefaultMIDIFile()}
                  style={{
                    position: "fixed",
                    bottom: "20px",
                    left: "20px",
                    zIndex:"303"
                  }}
                >
                  Start with preset song
                </button>
        }

      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />)