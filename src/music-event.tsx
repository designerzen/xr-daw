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
import { useDrag } from '@use-gesture/react'
// import { useSpring, animated } from '@react-spring/web'
import { animated, useSpring } from "@react-spring/three"
import { useThree } from '@react-three/fiber'

type TargetProps = {
    index: number,
    pitch:number,
    velocity:number,
    startTime:number,
    programNumber:number,
    duration:number,
    // color:number|string,
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
    
    const { size, viewport } = useThree()

    const scaleFactor = 10

    const width = scaleFactor * (duration ?? 1) + 0.5
    const height = 10  * (velocity ?? 1)
    const depth = 10 + pitch//* (velocity ?? 1)

    const x = startTime * scaleFactor + index
    const y = 2 * ( (programNumber) + height / 2) //- 10
    const z = -10 - depth / 2
    // const y = velocity * scaleFactor + patch
    // const z = duration * scaleFactor * 5


    // const randomNumber = Math.random() * 360
    // const color = `hsl(${randomNumber}, +  100%, 50%)`
    // const color = `hsl(${(pitch * 6)%360}, 100%, 50%)`

    // Internal state
    const [active, setActive] = useState(false)
    const [color, setColor] = useState(`hsl(${(pitch * 6)%360}, 100%, 60%)`)
    const [position, setPosition] = useState([ x, y, z])
    const [isHovering, setIsHovering] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    
    const aspect = size.width / viewport.width
  
    let planeIntersectPoint = new Vector3()

    const [spring, api] = useSpring(() => ({
        scale: 1,
        position: position,
        rotation: [0, 0, 0],
        config: { friction: 10 }
    }))
    
    const bind = useDrag(({ active, movement: [x, y], timeStamp, event }) => {
        
        if (active) 
        {
            event.ray.intersectPlane(floorPlane, planeIntersectPoint)
            setPosition([planeIntersectPoint.x, 1.5, planeIntersectPoint.z])
            // position = [planeIntersectPoint.x, 1.5, planeIntersectPoint.z]
        }

        setIsDragging(active)

        api.start({
            // position: active ? [x / aspect, -y / aspect, 0] : [0, 0, 0],
            position: position,
            scale: active ? 1.2 : 1,
            rotation: [y / aspect, x / aspect, 0]
        })
        return timeStamp
    },
    { delay: true }
    )

    console.info(index, "🎵 Event", {startTime,duration}, { x,y,z, width, height, depth, color, programNumber} )  
    // console.info(index, "MusicEvent", pitch, {width, height, depth, color, pitch, velocity, startTime, duration, position} ) 
                  
    return (
        <animated.mesh 
            {...spring}  
            {...bind()}
            castShadow 
            ref={ref} 
            position={position} 
            onPointerUp={()=>{
                onInteraction && onInteraction("up", { index, pitch, velocity, programNumber, startTime, duration})
            }}
            onPointerDown={()=>{
                onInteraction && onInteraction("down", { index, pitch, velocity, programNumber, startTime, duration})
            }}
            onClick={() => {
                //setActive(!active)
                console.info("MusicEvent CLICK", { index, pitch, velocity, programNumber, startTime, duration})
                onInteraction && onInteraction("click", { index, pitch, velocity, programNumber, startTime, duration})
            }}
            onPointerOver={() => {
                // setIsHovering(true)
                console.info("MusicEvent HOVER", {active,  pitch, velocity})
                setColor(`hsl(${(pitch * 6)%360}, 100%, 75%)`)
                onInteraction && onInteraction("hover", { index, pitch, velocity, programNumber, startTime, duration})
            }}
            onPointerOut={() => {
                // setIsHovering(false)
                console.info("MusicEvent UNHOVER", { index, pitch, velocity, programNumber, startTime, duration})
                setColor(`hsl(${(pitch * 6)%360}, 85%, 44%)`)
                onInteraction && onInteraction("unhover", { index, pitch, velocity, programNumber, startTime, duration})
            }}
        >
            <boxGeometry args={[
                width, 
                height, 
                depth
            ]} />
            <meshStandardMaterial color={color} />
        </animated.mesh>)
}

export const MusicEvent = forwardRef(MusicEventProxy)