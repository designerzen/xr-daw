/**
* ============================================================
 * This is the "music bar" MEDIATOR that represents ALL notes
 * - Feed it a MidiTrack instance
 * ============================================================
 * 
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useRef, useState } from "react"
import { MusicEvent } from "./music-event"
import { useFrame, useThree } from "@react-three/fiber"

import AudioTimer from "./timing/timer.audio"
import MidiTrack from "./audio/midi/midi-track"
import { Text } from "@react-three/drei"
import useTimer from "./hooks/useTimer"
import { noteNumberToFrequency } from "./audio/tuning/frequencies"
import OscillatorInstrument from "./audio/instruments/instrument.oscillator"
import { WebMidi } from "webmidi"
import { createReverb } from "./audio/effects/reverb"

type TargetProps = {
    track:MidiTrack,
    audioContext:AudioContext,
    position:number[]
}

export const MusicEvents = ({ track, audioContext, position=[0,0,0] }: TargetProps) => {
    
    if (!audioContext)
    {
        return (<></>)
    }

    const musicEventsRef = useRef<Group>(null)
    const camera = useThree(state => state.camera)

    let midiOut = null

    const instrument = new OscillatorInstrument( audioContext )
    instrument.volume = 0.1

    const mixer = audioContext.createGain()	 
    mixer.gain.value = 0
    
    // const reverb = createReverb(audioContext, 0.1, false, "./assets/audio/acoustics/emt_140_dark_5.wav").then( reverb => {
    const reverb = createReverb(audioContext, 0.1, true, "./assets/audio/acoustics/ir-hall.mp3").then( reverb => {
        instrument.output.connect( mixer )
        mixer.connect( reverb.node )
        reverb.node.connect( audioContext.destination  )
        // reverb.node.connect( mixer )
        // mixer.connect( audioContext.destination )
    })

    // instrument.noteOn( 0 )
    // instrument.noteOff()

    WebMidi
        .enable()
        .then(onEnabled)
        .catch(err => alert(err));
    
    function onEnabled() {
        
        // Inputs
        // WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name));
        
        // Outputs
        WebMidi.outputs.forEach(output => {
            console.log(output.manufacturer, output.name)
            midiOut = output
         })
    }

    let tempo = 90

    const onInteraction = (type, data) => {
       
        const frequency = noteNumberToFrequency( data.pitch )
       // oscillator.frequency.value = Math.random() * 1000
       switch( type)
       {
           case "hover":
                instrument.noteOn( data.pitch, data.velocity )
                mixer.gain.value = 0.8
                if (midiOut)
                {
                    midiOut.playNote(data.pitch, { velocity:data.velocity, duration:data.duration})
                }
                console.info("NOTE ON", frequency,{type, data} )
                break

           case "unhover":
           case "click":
                instrument.noteOff()
                mixer.gain.value = 0
                if (midiOut)
                {
                    midiOut.stopNote(data.pitch)
                }
                console.info("NOTE OFF", frequency,{type, data} )
                break
       }
    }


    // const [progress, setProgress] = useState(0)

    // const {beat, timer} = useTimer( audioContext, ()=>{}, 90 )

    // clock.setCallback( values =>{
    //     // This happens 24 times per quarter note
    //     // so you can set the progress of the timeline with it 
    //     // and ignore the other 23 events 
        
    //     const r = values.divisionsElapsed + (values.barsElapsed * 24)
    //     console.info("tick", r, {values}  )
    //     // setProgress( r )
    // })
        
    // // Timing options
    // clock.startTimer()

   // MIDI Track has not loaded yet! 
    if (!track || !track.noteOnCommands)
    {
        console.error("MusicEvents NO MIDI File", track )
        return <Text
                    color={0xffa276}
                    font="assets/SpaceMono-Bold.ttf"
                    fontSize={0.52}
                    anchorX="center"
                    anchorY="middle"
                    position={[0, 0.67, -1.44]}
                    quaternion={[-0.4582265217274104, 0, 0, 0.8888354486549235]}
                >
                    NO MIDI File
                </Text>
    }

    // TOCK
    useFrame(() => {
        const now = performance.now()
        // console.log(now, "RENDER loop MusicEvents MIDI File", {track} )
    })

    // MIDI Track has populated
    return (
        <group ref={musicEventsRef} position={position}>
            {
                track.noteOnCommands.map((command, index) => {
                     return <MusicEvent
                                index={index}
                                key={command.id} 
                                programNumber={command.programNumber}
                                pitch={command.noteNumber} 
                                velocity={command.velocity}  
                                startTime={command.percentStart} 
                                duration={command.percentDuration} 
                                onInteraction={onInteraction} 
                            />
                    //  return <MusicEvent
                    //             index={index}
                    //             key={command.id} 
                    //             pitch={command.noteNumber} 
                    //             velocity={command.velocity} 
                    //             startTime={command.startTime} 
                    //             duration={command.duration} 
                    //         />
                })
            }
        </group>)
}