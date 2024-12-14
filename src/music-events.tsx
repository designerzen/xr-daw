/**
* ============================================================
 * This is the "music bar" MEDIATOR that represents ALL notes
 * - Feed it a MidiTrack instance
 * ============================================================
 * 
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useRef } from "react"
import MidiTrack from "./audio/midi/midi-track"
import { MusicEvent } from "./music-event"
import { useFrame } from "@react-three/fiber"

type TargetProps = {
    track:MidiTrack
}

export const MusicEvents = ({ track }: TargetProps) => {
    const musicEventRef = useRef<Group>(null)
    useFrame(() => {
        const now = performance.now()
        console.log(now, "RENDER loop MusicEvents MIDI File", track )
    })

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

    // MIDI Track has populated
    return (
        <group ref={musicEventRef}>
            {
                track.noteOnCommands.map((command, index) => {
                    console.info("MusicEvent", {command, track} )
                    return <MusicEvent
                                key={index} 
                                index={index}
                                pitch={command.noteNumber} 
                                velocity={command.velocity} 
                                startTime={command.startTime} 
                                duration={command.duration} 
                                color={command.velocity} />
                })
            }
        </group>)
}