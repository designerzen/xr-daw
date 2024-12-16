
import { useRef, useState } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { Text } from "@react-three/drei"
import useTimer from "./hooks/useTimer"

import { MusicEvents } from "./music-events"

type TargetProps = {
    track: Object,
    audioContext:AudioContext|null
}

export const DAW = ({track, audioContext}: TargetProps) => {

    // starting position of the musicEventss
    const trackPosition = [0, 0, -5]
    const tempo = 90

    const {beat, timer} = useTimer( audioContext, (data)=>{ 
        console.log("tick")
    }, tempo )

    // TOCK
    useFrame(() => {
        const now = performance.now()
        // console.log(now, "RENDER loop MusicEvents MIDI File", {track} )
    })

    // MIDI Track has populated
    return (
        <group>  
            { 
                track !== null && audioContext !== null ? <MusicEvents audioContext={audioContext} track={track} position={trackPosition}/> : null
            }
        </group>)
}