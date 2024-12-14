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

type TargetProps = {
    track:MidiTrack
}

export const MusicEvent = ({ track }: TargetProps) => {
    const musicEventRef = useRef<Group>(null)
    return (
        <group ref={musicEventRef}>
            {
                track.noteOnCommands.map((command, index) => {
                    return <MusicEvent 
                                key={index} 
                                pitch={command.noteNumber} 
                                velocity={command.velocity} 
                                startTime={command.startTime} 
                                duration={command.duration} 
                                color={command.velocity} />
                })
            }
        </group>)
}