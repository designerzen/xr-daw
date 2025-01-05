import { useRef, forwardRef, useState, useEffect } from 'react'
import { Color, useFrame, useThree } from '@react-three/fiber'
import { Text } from '@react-three/drei'

/**
 * Find the largest data point in the array with Math.max(), 
 * takes its inverse with Math.pow(n, -1), and multiplies 
 * each value in the array by that number. 
 * This guarantees that the largest data point will be set to 1, 
 * and the rest of the data will scale proportionally.
 * @param filteredData 
 * @returns 
 */
const normalizeData = (filteredData) => {
    // find the largest data point in the array
    const largest = Math.max(...filteredData)
    // inverted as scale
    const multiplier = Math.pow(largest, -1)
    // normalise data set
    return filteredData.map(n => n * multiplier)
}

/**
 * 
 * @param audioBuffer 
 * @param samples Number of samples we want to have in our final data set
 * @returns 
 */
const filterData = (audioBuffer: AudioBuffer, samples = 70) => {
    const rawData = audioBuffer.getChannelData(0)           // We only need to work with one channel of data
    const blockSize = Math.floor(rawData.length / samples)  // the number of samples in each subdivision
    const filteredData = []
    for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i // the location of the first sample in the block
        // rolling summary
        let sum = 0
        for (let j = 0; j < blockSize; j++) {
            sum = sum + Math.abs(rawData[blockStart + j]) // find the sum of all the samples in the block
        }
        filteredData.push(sum / blockSize) // divide the sum by the block size to get the average
    }
    return filteredData
}

type TargetProps = {
    audioContext: AudioContext,
    audioBuffer: AudioBuffer|null,
    color:Color|undefined,
    scale: number
}

export const Waveform = ({ audioContext, audioBuffer, color="0xff0000", scale=3 }: TargetProps) => {

    const componentIsMounted = useRef<Boolean>(true)
    const [waves, setWaves] = useState(false)
    const waveformRef = useRef()

    useEffect(() => {
        return () => {
          componentIsMounted.current = false
        }
    }, [])

    useEffect(() => {
        const waveData = normalizeData(filterData(audioBuffer, 70))
        if (componentIsMounted.current)
        {
            // set the state
            setWaves(waveData)
            console.info("created waves", { waveData} )
        }else{
            console.error("UNMOUNTED waveform useEffect" )
        }
        
    }, [audioBuffer])

    useFrame(() => {
        if (waveformRef.current)
        {
            waveformRef.current.rotation.x += 0.01
        }
    })
    

    // Still loading / rendering
    if (!waves)
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
                    Waveform generating...
                </Text>
    }

    return (
        <group ref={waveformRef}>
        {
            waves.map( (wave,index)=>{
                <mesh position={[0,index,0]} >
                    { /* The Cylinder function takes 3 arguments: top radius, bottom radius, and height. attach="geometry"  */ }
                    <cylinderGeometry args={[wave * scale, wave * scale, 1]} />
                    <meshStandardMaterial color={color} />
                </mesh>
            })
        }
        </group>
    )
}
