/**
 * ============================================================
 * This is the "music bar" that represents ONE note that has a 
 * - duration
 * - pitch
 * - velocity
 * - start time
 * ============================================================
 * 
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 * 
 */

import { useRef } from "react"

type TargetProps = {
    musicEventIndex: number,
    pitch:number,
    velocity:number,
    startTime:number,
    duration:number,
    color:number|string
}

export const MusicEvent = ({ 
    musicEventIndex, 
    pitch,
    velocity,
    startTime,
    duration,
    color ="orange" 
}: TargetProps) => {

    const musicEventRef = useRef<Mesh>(null)

    const height = 1
    const width = 1
    const depth = 1

    // TODO : Create this colour as a function of the pitch!
    return (
        <mesh ref={musicEventRef}>
            {/* TODO: Bind the args to the geometry */}
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial color={color} />
        </mesh>)
}