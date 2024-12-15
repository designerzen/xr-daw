/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Canvas, useFrame } from "@react-three/fiber"
import { Environment, PerspectiveCamera } from "@react-three/drei"
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
  const clock = new AudioTimer( audioContext )

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

  return { audioContext, clock, midiFile }
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
  },
//  timer:{}, 
//  midiData:{}, 
//  context:{}
})

const GsapTicker = () => {
  useFrame(() => {
    gsap.ticker.tick()
  })
  return null
}


function getInput(keyboard, mouse) {
  let [x, y, z] = [0, 0, 0];
  // Checking keyboard inputs to determine movement direction
  if (keyboard["s"]) z += 1.0; // Move backward
  if (keyboard["w"]) z -= 1.0; // Move forward
  if (keyboard["d"]) x += 1.0; // Move right
  if (keyboard["a"]) x -= 1.0; // Move left
  if (keyboard[" "]) y += 1.0; // Jump

  // Returning an object with the movement and look direction
  return {
    move: [x, y, z],
    look: [mouse.x / window.innerWidth, mouse.y / window.innerHeight], // Mouse look direction
    running: keyboard["Shift"], // Boolean to determine if the player is running (Shift key pressed)
  };
}

const App = () => {

  const [started, setStarted] = useState(false)
  const [track, setTrack] = useState(null)
  const [clock, setClock] = useState(null)
  const [audioContext, setAudioContext] = useState(null)
  // const keyboard = useKeyboard()

  let active = false
  
  const cameraPosition = [0, 1.6, 2]
  const cameraRotation = [90, 0, 0]
  const cameraFieldOfView = 75

  // starting position of the musicEventss
  const trackPosition = [0, 0, -5]

  let tempo = 90

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
    setTrack(results.midiFile)
    setClock(results.clock)
     
    console.info("createClient", results)
    xrStore.enterVR()
    setStarted(true)
  }

  const {beat, timer} = useTimer( audioContext, (data)=>{
      console.info("tick @"+tempo+" BPM", {data, beat, timer})
  }, tempo )
  
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
        <PerspectiveCamera makeDefault position={cameraPosition} angle={cameraRotation} fov={cameraFieldOfView} />
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
        }}
      >
        <Uploader callback={uploadMIDIFile} />

        {/* <p>Tempo: {timer?.BPM}</p>
        <p>Beat: {beat?.bar}</p> */}
        {/* <p>progress: {progress}</p> */}

        { !started && 
                <button
                  onClick={() => createClient()}
                  style={{
                    position: "fixed",
                    bottom: "20px",
                    left: "10%",
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