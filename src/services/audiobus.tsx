import { WebMidi } from "webmidi"
import { createCustomReverb, createReverb } from "../audio/effects/reverb"
import { EnvelopeNode } from "../audio/nodes/envelope-node"
import { encodeAudioBufferIntoWav } from "../audio/record/wave"

import DualOscillatorInstrument from "../audio/instruments/instrument.dual-oscillator"
import OscillatorInstrument from "../audio/instruments/instrument.oscillator"
import MonotronInstrument from "../audio/instruments/instrument.monotron"

import { downloadBlobOnClient } from "../utils/save-to-device"

/**
 * AudioBus connections
 * @param {AudioContext} audioContext 
 * @returns {Object}
 */
export const createAudioComponents = async(audioContext:AudioContext) => {

    const mixer = audioContext.createGain()	 
    mixer.gain.value = 0

    const envelope = new EnvelopeNode(audioContext)
    
    // const instrument = new OscillatorInstrument( audioContext )
    const instrument = new DualOscillatorInstrument( audioContext )
    // const instrument = new MonotronInstrument( audioContext )
    instrument.volume = 0.1
    // instrument.noteOn( 0 )
    // instrument.noteOff()
    
    /*
    // const reverb = createReverb(audioContext, 0.1, false, "./assets/audio/acoustics/emt_140_dark_5.wav").then( reverb => {
    const reverb = createCustomReverb(audioContext, {} ).then( reverb => {
        instrument.output.connect( mixer )
        mixer.connect( reverb.node )
        reverb.node.connect( audioContext.destination  )
        // reverb.node.connect( mixer )
        // mixer.connect( audioContext.destination )
    })
    */

    const customReverbOptions = {
        // seconds
        duration:0.5, 

        gain : 0.8,
        // as ratios except sustain which is a level
        attack:0.001, 
        decay:0.1, 
        sustain:0.8,
        release:0.5,
        // booleans
        normalize : true,
        reverse:false,

        // noise:'white' 
        // noise:'pink'  
        noise:'white' 
    }

    // const reverb = await createReverb(audioContext, 0.9, true, "./assets/audio/acoustics/sony_walkman_fx_403_mega_bass_+_tube.irs")
    // const reverb = await createReverb(audioContext, 0.5, true, "./assets/audio/acoustics/sony_walkman_fx_403_mega_bass.wav")
    // const reverb = await createReverb(audioContext, 0.1, true, "./assets/audio/acoustics/concert-crowd.ogg")
    // const reverb = await createReverb(audioContext, 0.1, true, "./assets/audio/acoustics/ir-hall.mp3")
    const reverb = await createCustomReverb(audioContext, customReverbOptions )
    
    // await reverb.setOptions(customReverbOptions)

    // connect audio parts
    instrument.output.connect( envelope )
    envelope.connect( mixer )
    mixer.connect( reverb.node )
    reverb.node.connect( audioContext.destination  )
    // reverb.node.connect( mixer )
    // mixer.connect( audioContext.destination )

    // Can we supply an Offline context?
    const encodeOptions = {
        sampleRate:audioContext.sampleRate,
        stereo:true,
        sampleSize:16
    }

    const buffer = reverb.audioBuffer
    const blob = encodeAudioBufferIntoWav(buffer, encodeOptions)
    // force download...
    downloadBlobOnClient( blob )
    // draw to canvas




    // MIDI -----------------------------------------------------------------------
    let midiOut = null

    try{
        await WebMidi.enable()
      
        WebMidi.outputs.forEach(output => {
            console.log(output.manufacturer, output.name)
            midiOut = output
        })
            
        // Inputs
        // WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name));
        
    }catch(error){
        console.error("Could not enable MIDI", error)
        return {midiOut, mixer, instrument, reverb}
    }
    
    // Outputs
    return {midiOut, mixer, instrument, envelope, reverb}
}