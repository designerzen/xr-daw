/**
* ============================================================
 * This is the "music bar" MEDIATOR that represents ALL notes
 * - Feed it a MidiTrack instance
 * ============================================================
 * 
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useRef, useState } from "react"
import { MusicEvent } from "./music-event"
import { useFrame, useThree } from "@react-three/fiber"
import useTimer from "./hooks/useTimer"

// import AudioTimer from "./timing/timer.audio"
import MidiTrack from "./audio/midi/midi-track"
import { Text } from "@react-three/drei"
import { noteNumberToFrequency } from "./audio/tuning/frequencies"
import { Waveform } from "./waveform"

import { createAudioComponents } from "./services/audiobus"

type TargetProps = {
    track:MidiTrack,
    audioContext:AudioContext,
    position:number[]
}

export const MusicEvents = ({ track, audioContext, position=[0,0,0] }: TargetProps) => {

    const componentIsMounted = useRef<Boolean>(true)
    const musicEventsRef = useRef<Group>(null)
    // const audioBus = useRef<AudioBus>(null)
    const [audio, setAudio] = useState(null)
    const [waveformData, setWaveformData] = useState(null)
    const camera = useThree(state => state.camera)

    //const {midiOut, mixer, instrument, reverb} = await createAudioComponents(audioContext) 
    const onInteraction = (type, data) => {
       
        if (!audio)
        {
            console.error("MusicEvents NO Audio Bus", {audio, type, data} )
            return
        }

        const frequency = noteNumberToFrequency( data.pitch )
        const {instrument, mixer, envelope, midiOut} = audio
      
        switch( type)
       {
           case "hover":
                instrument.noteOn( data.pitch, data.velocity )
                mixer.gain.value = 0.8
                envelope.on()
                if (midiOut)
                {
                    midiOut.playNote(data.pitch, { velocity:data.velocity, duration:data.duration})
                }
                console.info("NOTE ON", frequency,{type, data} )
                break

            // case "click":
            case "down":
                console.info("NOTE DOWN", frequency,{type, data} )
                break

            case "up":
                console.info("NOTE UP", frequency,{type, data} )
                break

           case "unhover":
                instrument.noteOff()
                // mixer.gain.value = 0
                envelope.off()
                if (midiOut)
                {
                    midiOut.stopNote(data.pitch)
                }
                console.info("NOTE OFF", frequency,{type, data} )
                break
       }
    }

    useEffect(() => {
        return () => {
          componentIsMounted.current = false
        }
    }, [])
    

    useEffect(() => {
    
        const createAudioBus = async () => {
            const audioConnections = await createAudioComponents(audioContext) 
            // if the componnet was unmounted before the async completed
            if (componentIsMounted.current)
            {
                // set the state
                setAudio(audioConnections)
               
                const waveformAudioBuffer = audioConnections.reverb.audioBuffer
                setWaveformData(waveformAudioBuffer)
                console.log("createAudioBus useEffect", { audioConnections, waveformAudioBuffer } )
            }else{
                console.error("UNMOUNTED createAudioBus useEffect", { audioConnections} )
            }
        }
        createAudioBus()
        
        //console.log("MusicEvents useEffect", {track} )
        
        return () => {
            // audio.destroy()
            setAudio(null)
            console.log("MusicEvents useEffect cleanup", {track} )
        }
    }, [track])

    // TOCK
    useFrame(() => {
        const now = performance.now()
        // console.log(now, "RENDER loop MusicEvents MIDI File", {track} )
    })

    // let tempo = 90
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
    
    if (!audioContext)
    {
        return <Text
                    color={0xffa276}
                    font="assets/fonts/SpaceMono-Bold.ttf"
                    fontSize={0.52}
                    anchorX="center"
                    anchorY="middle"
                    position={[0, 0.67, -1.44]}
                    quaternion={[-0.4582265217274104, 0, 0, 0.8888354486549235]}
                >
                    AudioContext was not provided
                </Text>
    }
    
    // Audio Bus and connections are not loaded yet...
    if ( !audio )
    {
        //console.error("MusicEvents NO Audio Connections", audio )
        return <Text
                    color={0xffa276}
                    font="assets/fonts/SpaceMono-Bold.ttf"
                    fontSize={0.52}
                    anchorX="center"
                    anchorY="middle"
                    position={[0, 0.67, -1.44]}
                    quaternion={[-0.4582265217274104, 0, 0, 0.8888354486549235]}
                >
                    Loading Audio Bus
                </Text>
    }

    // MIDI Track has not loaded yet! 
    if (!track || !track.noteOnCommands)
    {
        //console.error("MusicEvents NO MIDI File", track )
        return <Text
                    color={0xffa276}
                    font="assets/fonts/SpaceMono-Bold.ttf"
                    fontSize={0.52}
                    anchorX="center"
                    anchorY="middle"
                    position={[0, 0.67, -1.44]}
                    quaternion={[-0.4582265217274104, 0, 0, 0.8888354486549235]}
                >
                    NO MIDI File Data available
                </Text>
    }

    // MIDI Track has populated
    return (<>
            <Waveform audioContext={audioContext} audioBuffer={waveformData} />
            
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
                    })
                }
            </group>
        </>)
}