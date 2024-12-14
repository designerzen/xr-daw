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

import AudioTimer from "./timing/timer.audio"
import { loadMIDIFile, loadMIDIFileThroughClient } from "./audio/midi/midi-file"

import gsap from "gsap"
import { MusicEvents } from "./music-events"


let timer, midiData, context
// -----------------------------------------------------------------------------
// Requires a user action so useEffect cannot be used here
const createBackend = async () => {

  // Create our audio pipelines
  const audioContext = new AudioContext()
  if (audioContext.state === 'suspended') {
    audioContext.resume()
  }

  // Timing options
  let tempo = 90

  // Create timing loop
  const clock = new AudioTimer( audioContext )
  clock.BPM = tempo
  clock.setCallback( ( values )=>{
    // This happens 24 times per quarter note
    // so you can set the progress of the timeline with it 
    // and ignore the other 23 events 
    console.info("tick @"+tempo+" BPM", values)
  })

  clock.startTimer()

  // -----------------------------------------------------------------------------
  // MIDI File options
  const options = {}
  // Load in the MIDI file from the file requester (or embed the file as base 64)
  // const midiFile = await loadMIDIFileThroughClient( file, {}, (output)=>{
  //   console.info("midi file loaded", file, " BPM", output)
  // } )

  // Load in a local MIDI file from a relative URI
  const midiFile = await loadMIDIFile( "./assets/midi/midi_nyan-cat.mid", options, (values)=>{
    console.info("midi file loaded", options, {values} )
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

// Create the front and backends
const createClient = async() => {
  const results = await createBackend()
  timer = results.clock
  midiData = results.midiFile
  context = results.audioContext
  xrStore.enterVR()

  // FIXME: 
  timer.startTimer()
}

const uploadMIDIFile = async (file) => {
  const midiFile = await loadMIDIFileThroughClient( file, {}, (output)=>{
    console.info("midi file loaded", file, " BPM", output)
  } )
}

const App = () => {
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
        <PerspectiveCamera makeDefault position={[0, 1.6, 2]} fov={75} />
        <Environment preset="warehouse" />
       
        { 
          ( midiData !== undefined ) ?? <MusicEvents 
            track={midiData} 
            key={midiData.duration} />
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
        <button
          onClick={() => createBackend()}
          style={{
            position: "fixed",
            bottom: "20px",
            left: "10%",
            fontSize: "20px",
          }}
        >
          Create Backend
        </button>

        <button
          onClick={() => createClient()}
          style={{
            position: "fixed",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "20px",
          }}
        >
          Begin VR
        </button>


        <button
          onClick={() => uploadMIDIFile()}
          style={{
            position: "fixed",
            bottom: "20px",
            left: "66%",
            top: "0",
            fontSize: "20px",
          }}
        >
          Upload MIDI File
        </button>

      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />)