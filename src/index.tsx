/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Environment, Gltf, PerspectiveCamera } from "@react-three/drei"
import { XR, createXRStore } from "@react-three/xr"

import ReactDOM from "react-dom/client"

import { Bullets } from "./bullets"
import { Gun } from "./gun"
import { Score } from "./score"
import { Target } from "./targets"

import { loadMIDIFile, loadMIDIFileThroughClient } from "./audio/midi/midi-file"

import gsap from "gsap"
import { MusicEvents } from "./music-events"
import { useState } from "react"
import useTimer from "./hooks/useTimer"
import AudioTimer from "./timing/timer.audio"
// import useKeyboard from "./hooks/useKeyboard"
import {useKeyboard} from 'react-aria'
import { Uploader } from "./uploader"

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
  const options = {}
  // Load in the MIDI file from the file requester (or embed the file as base 64)
  // const midiFile = await loadMIDIFileThroughClient( file, {}, (output)=>{
  //   console.info("midi file loaded", file, " BPM", output)
  // } )

  // Load in a local MIDI file from a relative URI
  const midiFile = await loadMIDIFile( "./assets/midi/midi_nyan-cat.mid", options, (values)=>{
    // console.info("midi file loaded", options, {values} )
  } )

  console.info("Midi file loaded", midiFile)

  return { audioContext, midiFile }
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

const App = () => {

  const [started, setStarted] = useState(false)
  const [track, setTrack] = useState(null)
  const [audioContext, setAudioContext] = useState(null)
  // const keyboard = useKeyboard()

  let active = false
  
  const initialCameraPosition = [0, 1.6, 2]
  const [cameraPosition, setCameraPosition] = useState(initialCameraPosition)

  const cameraRotation = [90, 0, 0]
  const cameraFieldOfView = 75

  // starting position of the musicEventss
  const trackPosition = [0, 0, -5]


  const uploadMIDIFile = async (file) => {
    const midiFile = await loadMIDIFileThroughClient( file, {}, (output)=>{
      console.info("midi file loaded", file, " raw:", output)
    } )
    setTrack(midiFile)
  }
  
  // Create the front and backends
  const createClient = async() => {

    if (started){
      console.warn("Already started")
      return
    }

    const results = await createBackend()
  
    setAudioContext(results.audioContext)

    // if track was already set from the 
    if (!track)
    {
      console.info("Using default MIDI track")
      setTrack(results.midiFile)
    }else{
      console.info("Used custom track")
    }
     
    console.info("createClient", results)
    xrStore.enterVR()

    setStarted(true)
  }

  // const {beat, timer} = useTimer( audioContext, (data)=>{
  //     // initialCameraPosition[1] += 0.5

  //     // setCameraPosition( (old)=>{
  //     //   return [ old[0], old[1]+0.5, old[2] ] 
  //     // })

  //     // camera.position.y += 0.5

  //     console.info("tick @"+tempo+" BPM", {data, camera}) 
  // }, tempo )
  
  return (
    <>
      <Canvas
        style={{
          position: "fixed",
          width: "100vw",
          height: "100vh",
        }}
      >
        <color args={[0x808080]} attach={"background"}></color>
        <PerspectiveCamera makeDefault position={initialCameraPosition} angle={cameraRotation} fov={cameraFieldOfView} />
        <Environment preset="warehouse" />
       
        { 
          track !== null && audioContext !== null ? <MusicEvents audioContext={audioContext} track={track} position={trackPosition}/> : null
        }

        {/* <Bullets /> */}
        {/* <Gltf src="assets/actors/spacestation.glb" /> */}

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
        style={{
          position: "fixed",
          display: "flex",
          width: "100vw",
          height: "100vh",
          flexDirection: "column",
          justifyContent: "space-between",
          alignItems: "center",
          color: "white",
          fontFamily: "SpaceMono-Bold, sans-serif",
        }}
      >
        <Uploader 
          label="Drag and drop MIDI file here"
          callback={uploadMIDIFile} />

        {/* <p>Tempo: {timer?.BPM}</p>
        <p>Beat: {beat?.bar}</p> */}
        {/* <p>progress: {progress}</p> */}

        { !started && 
                <button
                  onClick={() => createClient()}
                  style={{
                    position: "fixed",
                    bottom: "20px",
                    left: "20px",
                    fontSize: "20px",
                    zIndex:"303"
                  }}
                >
                  Start
                </button>
        }

      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />)