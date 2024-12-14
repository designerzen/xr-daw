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

import { useFrame } from '@react-three/fiber'
import { useRef, forwardRef } from 'react'

type TargetProps = {
    index: number,
    pitch:number,
    velocity:number,
    startTime:number,
    duration:number,
    color:number|string
}

export const MusicEventProxy = ({ 
    index, 
    pitch,
    velocity,
    startTime,
    duration,
    color ="orange" 
}: TargetProps, ref : React.Ref<any>) => {

    const height = 1
    const width = 1 * velocity
    const depth = 1 * duration

    // TODO : Create this colour as a function of the pitch!
    return (
        <mesh ref={ref}>
            {/* TODO: Bind the args to the geometry */}
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial color={color} />
        </mesh>)
}

export const MusicEvent = forwardRef(MusicEventProxy)