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
import { useRef, forwardRef } from 'react'
import { Vector3 } from 'three'

type TargetProps = {
    index: number,
    pitch:number,
    velocity:number,
    startTime:number,
    programNumber:number,
    duration:number,
    color:number|string
}

export const MusicEventProxy = ({ 
    index, 
    pitch,
    velocity,
    programNumber = 1,
    startTime = 0,
    duration = 1
}: TargetProps, ref : React.Ref<any>) => {

    const scaleFactor = 0.2
    const randomNumber = Math.random() * 360

    const width = scaleFactor * (duration ?? 1) + 0.5
    const height = 10  * (velocity ?? 1)
    const depth = 10 //* (velocity ?? 1)

    const x = startTime * scaleFactor + index
    const y = 1 + programNumber
    const z = -1 * 5
    // const y = velocity * scaleFactor + patch
    // const z = duration * scaleFactor * 5

    // const color = `hsl(${randomNumber}, +  100%, 50%)`
    const color = `hsl(${(pitch * 6)%360}, 100%, 50%)`

    console.info(index, "MusicEvent", { x,y,z, width, height, depth, color, programNumber} )  
    // console.info(index, "MusicEvent", pitch, {width, height, depth, color, pitch, velocity, startTime, duration, position} ) 
                  
    // TODO : Create this colour as a function of the pitch!
    return (
        <mesh 
            ref={ref} 
            position={[ x, y, z]} 
        >
            <boxGeometry args={[
                width, 
                height, 
                depth
            ]} />
            <meshStandardMaterial color={color} />
        </mesh>)
}

export const MusicEvent = forwardRef(MusicEventProxy)