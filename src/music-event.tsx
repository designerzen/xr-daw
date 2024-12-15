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
import { useRef, forwardRef, useState } from 'react'
import { Vector3 } from 'three'

type TargetProps = {
    index: number,
    pitch:number,
    velocity:number,
    startTime:number,
    programNumber:number,
    duration:number,
    color:number|string,
    onInteraction:Function
}

export const MusicEventProxy = ({ 
    index, 
    pitch,
    velocity,
    programNumber = 1,
    startTime = 0,
    duration = 1,
    onInteraction = ()=>{}
}: TargetProps, ref : React.Ref<any>) => {

    const scaleFactor = 0.2
    const randomNumber = Math.random() * 360

    const width = scaleFactor * (duration ?? 1) + 0.5
    const height = 10  * (velocity ?? 1)
    const depth = 10 //* (velocity ?? 1)

    const x = startTime * scaleFactor + index
    const y = 3 * (1 + programNumber + height / 2) - 10
    const z = -1 * 5

    const [active, setActive] = useState(false)
    const [hover, setHover] = useState(false)

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
            onClick={() => {
                //setActive(!active)
                console.info("MusicEvent CLICK", { index, pitch, velocity, programNumber, startTime, duration})
                onInteraction && onInteraction("click", { index, pitch, velocity, programNumber, startTime, duration})
            }}
            onPointerOver={() => {
                // setHover(true)
                console.info("MusicEvent HOVER", {active,  pitch, velocity})
                onInteraction && onInteraction("hover", { index, pitch, velocity, programNumber, startTime, duration})
            }}
            onPointerOut={() => {
                // setHover(false)
                console.info("MusicEvent UNHOVER", { index, pitch, velocity, programNumber, startTime, duration})
                onInteraction && onInteraction("unhover", { index, pitch, velocity, programNumber, startTime, duration})
            }}
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