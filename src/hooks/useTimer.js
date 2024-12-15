import { useState, useEffect } from 'react'
import AudioTimer from "../timing/timer.audio"

export default function useTimer( audioContext, tempo = 90 ) {
   
    const [timer, setTimer] = useState(null)
    const [beat, setBeat] = useState(null)

    let clock

    useEffect(() => {
       
        if (audioContext)
        {
          // Create timing loop
          clock = new AudioTimer( audioContext )
          clock.BPM = tempo
          clock.setCallback( ( values )=>{
            // This happens 24 times per quarter note
            // so you can set the progress of the timeline with it 
            // and ignore the other 23 events 
            // setBeat(values)
            console.info("tick @"+tempo+" BPM", values)
          })
          
          clock.startTimer()
          setTimer(clock)

          return () => {
            console.info("clock destroy")
            clock.stopTimer()
            clock = null
          }

        }else{
          // console.error("Audio Context not available for Timer yet")
        }
      
    }, [audioContext])

    return {beat, timer}
}