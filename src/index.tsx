/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Canvas, useFrame } from "@react-three/fiber"
import { Environment, Gltf, PerspectiveCamera } from "@react-three/drei"
import { XR, createXRStore } from "@react-three/xr"

import ReactDOM from "react-dom/client"

import { Bullets } from "./bullets"
import { Gun } from "./gun"
import { Score } from "./score"
import { Target } from "./targets"
import gsap from "gsap"

import AudioTimer from "./timing/timer.audio"
import { loadMIDIFile, loadMIDIFileThroughClient } from "./audio/midi/midi-file"



// -----------------------------------------------------------------------------

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
})

const GsapTicker = () => {
  useFrame(() => {
    gsap.ticker.tick()
  })
  return null
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
        <Bullets />
        <Gltf src="assets/actors/spacestation.glb" />
        <Target targetIdx={0} />
        <Target targetIdx={1} />
        <Target targetIdx={2} />
        <Score />
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
            bottom: "80px",
            left: "50%",
            fontSize: "20px",
          }}
        >
          Create Backend
        </button>

        <button
          onClick={() => xrStore.enterVR()}
          style={{
            position: "fixed",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "20px",
          }}
        >
          Enter VR
        </button>


        <button
          onClick={() => xrStore.enterVR()}
          style={{
            position: "fixed",
            bottom: "0",
            left: "0",
            top: "0",
            bottom: "0",
            fontSize: "20px",
          }}
        >
          Upload MIDI File
        </button>

      </div>
    </>
  )
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
)