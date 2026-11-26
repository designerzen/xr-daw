import type { Impact, Profile } from './synth';

// Original chiptune-style cues: short pulse/triangle phrases, not game recordings.
const note = (frequency: number, at = 0, duration = .065, wave: OscillatorType = 'square', endFrequency?: number) =>
  ({ frequency, at, duration, wave, endFrequency });
function impact(notes: NonNullable<Impact['notes']>, level = .65, noise = .015): Impact {
  return { notes, modes: [], decay: .012, brightness: 6500, noise, bounce: .025, level };
}
function game(id: string, name: string, down: Impact, up: Impact): Profile {
  return { id: `game-${id}`, name, samples: 0, down, up };
}
export const gameProfiles: Profile[] = [
  game('8bit-select', '8-bit Select', impact([note(880, 0, .035), note(1320, .035, .045)]), impact([note(660, 0, .025, 'triangle')], .35)),
  game('arcade-confirm', 'Arcade Confirm', impact([note(523.25, 0, .055), note(659.25, .045, .055), note(1046.5, .09, .11)]), impact([note(1568, 0, .035, 'triangle')], .32)),
  game('menu-back', 'Menu Back', impact([note(880, 0, .045), note(440, .04, .075)]), impact([note(220, 0, .03, 'triangle')], .3)),
  game('menu-error', 'Menu Error', impact([note(146.83, 0, .075, 'sawtooth'), note(138.59, .09, .09, 'sawtooth')], .55, .05), impact([note(110, 0, .04, 'triangle')], .3)),
  game('coin-pickup', 'Coin Pickup', impact([note(987.77, 0, .045), note(1318.51, .045, .16)]), impact([note(1975.53, 0, .025, 'triangle')], .23)),
  game('game-start', 'Game Start', impact([note(392, 0, .055), note(523.25, .05, .055), note(659.25, .10, .055), note(783.99, .15, .13)]), impact([note(1046.5, 0, .045, 'triangle')], .3)),
  game('power-up', 'Power Up', impact([note(220, 0, .065, 'square', 440), note(440, .06, .065, 'square', 880), note(880, .12, .12, 'square', 1760)]), impact([note(1760, 0, .04, 'triangle')], .28)),
  game('pause-blip', 'Pause Blip', impact([note(659.25, 0, .05, 'triangle'), note(523.25, .07, .08, 'triangle')]), impact([note(659.25, 0, .03, 'triangle')], .3)),
  game('console-confirm', 'Console Confirm', impact([note(523.25, 0, .10, 'triangle'), note(783.99, 0, .10, 'triangle'), note(1046.5, .07, .14, 'sine')], .6), impact([note(1318.51, 0, .04, 'sine')], .28)),
  game('pixel-toggle', 'Pixel Toggle', impact([note(440, 0, .075, 'square', 880)], .6), impact([note(880, 0, .065, 'square', 440)], .45)),
];
