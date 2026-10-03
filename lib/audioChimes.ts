import { BellPattern } from '../types';

interface ChimeNote {
  freq: number;
  durationMs: number;
  restMs?: number;
}

export const CHIME_MELODIES: Record<BellPattern, ChimeNote[]> = {
  'westminster': [
    // Westminster Chime (Full 16-Note Big Ben Quarters in F Major)
    // Phrase 1 (Quarter 1)
    { freq: 698.46, durationMs: 520, restMs: 40 },  // F5
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 523.25, durationMs: 880, restMs: 400 }, // C5
    // Phrase 2 (Quarter 2)
    { freq: 698.46, durationMs: 520, restMs: 40 },  // F5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 698.46, durationMs: 980, restMs: 500 }, // F5
    // Phrase 3 (Quarter 3)
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 698.46, durationMs: 520, restMs: 40 },  // F5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 523.25, durationMs: 880, restMs: 400 }, // C5
    // Phrase 4 (Quarter 4 Full Hour Cadence)
    { freq: 523.25, durationMs: 520, restMs: 40 },  // C5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 698.46, durationMs: 1200 },             // F5
  ],
  'japanese-school-bell': [
    // Legacy alias to full Westminster chime
    { freq: 698.46, durationMs: 520, restMs: 40 },  // F5
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 523.25, durationMs: 880, restMs: 400 }, // C5
    { freq: 698.46, durationMs: 520, restMs: 40 },  // F5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 698.46, durationMs: 980, restMs: 500 }, // F5
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 698.46, durationMs: 520, restMs: 40 },  // F5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 523.25, durationMs: 880, restMs: 400 }, // C5
    { freq: 523.25, durationMs: 520, restMs: 40 },  // C5
    { freq: 783.99, durationMs: 520, restMs: 40 },  // G5
    { freq: 880.00, durationMs: 520, restMs: 40 },  // A5
    { freq: 698.46, durationMs: 1200 },             // F5
  ],
  'college-bell': [
    { freq: 659.25, durationMs: 450, restMs: 150 },
    { freq: 830.61, durationMs: 450, restMs: 150 },
    { freq: 987.77, durationMs: 900 },
  ],
  'triple-chime': [
    { freq: 523.25, durationMs: 280, restMs: 70 },
    { freq: 659.25, durationMs: 280, restMs: 70 },
    { freq: 783.99, durationMs: 550 },
  ],
  'lunch-fanfare': [
    { freq: 523.25, durationMs: 180 },
    { freq: 659.25, durationMs: 180 },
    { freq: 783.99, durationMs: 180 },
    { freq: 1046.50, durationMs: 260 },
    { freq: 783.99, durationMs: 180 },
    { freq: 1046.50, durationMs: 480 },
  ],
  'dismissal-chime': [
    { freq: 523.25, durationMs: 150 },
    { freq: 587.33, durationMs: 150 },
    { freq: 659.25, durationMs: 150 },
    { freq: 698.46, durationMs: 150 },
    { freq: 783.99, durationMs: 150 },
    { freq: 880.00, durationMs: 150 },
    { freq: 1046.50, durationMs: 600 },
  ],
  'ding-dong': [
    { freq: 783.99, durationMs: 300, restMs: 80 },
    { freq: 659.25, durationMs: 500 },
  ],
  'marimba-cascade': [
    { freq: 1046.50, durationMs: 120 },
    { freq: 880.00, durationMs: 120 },
    { freq: 783.99, durationMs: 120 },
    { freq: 659.25, durationMs: 120 },
    { freq: 523.25, durationMs: 400 },
  ],
  'st-michael': [
    // St. Michael's Chimes (Full 16-Note Historic Cathedral Melody in F Major)
    // Phrase 1 (Descending Scale: 8-7-6-5-4-3-2-1)
    { freq: 698.46, durationMs: 320, restMs: 40 },  // F5
    { freq: 659.25, durationMs: 320, restMs: 40 },  // E5
    { freq: 587.33, durationMs: 320, restMs: 40 },  // D5
    { freq: 523.25, durationMs: 320, restMs: 40 },  // C5
    { freq: 466.16, durationMs: 320, restMs: 40 },  // Bb4
    { freq: 440.00, durationMs: 320, restMs: 40 },  // A4
    { freq: 392.00, durationMs: 320, restMs: 40 },  // G4
    { freq: 349.23, durationMs: 750, restMs: 350 }, // F4
    // Phrase 2 (Melodic Resolution: 8-2-3-4-7-5-6-1)
    { freq: 698.46, durationMs: 320, restMs: 40 },  // F5
    { freq: 392.00, durationMs: 320, restMs: 40 },  // G4
    { freq: 440.00, durationMs: 320, restMs: 40 },  // A4
    { freq: 466.16, durationMs: 320, restMs: 40 },  // Bb4
    { freq: 659.25, durationMs: 320, restMs: 40 },  // E5
    { freq: 523.25, durationMs: 320, restMs: 40 },  // C5
    { freq: 587.33, durationMs: 320, restMs: 40 },  // D5
    { freq: 349.23, durationMs: 1000 },             // F4
  ],
  'digital-synth': [
    { freq: 523.25, durationMs: 100 },
    { freq: 783.99, durationMs: 100 },
    { freq: 1046.50, durationMs: 100 },
    { freq: 1318.51, durationMs: 100 },
    { freq: 1567.98, durationMs: 350 },
  ],
  'morning-reveille': [
    { freq: 523.25, durationMs: 150 },
    { freq: 392.00, durationMs: 150 },
    { freq: 523.25, durationMs: 150 },
    { freq: 659.25, durationMs: 150 },
    { freq: 783.99, durationMs: 450 },
  ],
  'gentle-wind': [
    { freq: 587.33, durationMs: 200 },
    { freq: 659.25, durationMs: 200 },
    { freq: 783.99, durationMs: 200 },
    { freq: 880.00, durationMs: 200 },
    { freq: 1174.66, durationMs: 500 },
  ],
  'double-beep': [
    { freq: 880.00, durationMs: 180, restMs: 80 },
    { freq: 1318.51, durationMs: 350 },
  ],
  'single-long': [
    { freq: 880.00, durationMs: 1500 },
  ],
};

let activeAudioCtx: any = null;

export function playChimeWebAudio(pattern: BellPattern): boolean {
  if (typeof window === 'undefined') return false;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return false;

  try {
    if (!activeAudioCtx || activeAudioCtx.state === 'closed') {
      activeAudioCtx = new AudioCtx();
    }
    if (activeAudioCtx.state === 'suspended') {
      void activeAudioCtx.resume();
    }

    const melody = CHIME_MELODIES[pattern] || CHIME_MELODIES['college-bell'];
    let curTime = activeAudioCtx.currentTime + 0.05;

    for (const note of melody) {
      if (note.freq > 0) {
        const osc = activeAudioCtx.createOscillator();
        const gain = activeAudioCtx.createGain();

        // Sine waveform gives the pure, resonant bell-like tone
        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.freq, curTime);

        // Bell strike attack and gentle decay envelope
        const durationSec = note.durationMs / 1000;
        gain.gain.setValueAtTime(0.0001, curTime);
        gain.gain.exponentialRampToValueAtTime(0.4, curTime + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, curTime + durationSec);

        osc.connect(gain);
        gain.connect(activeAudioCtx.destination);

        osc.start(curTime);
        osc.stop(curTime + durationSec + 0.05);
      }

      curTime += (note.durationMs + (note.restMs || 0)) / 1000;
    }

    return true;
  } catch (err) {
    console.warn('[WebAudio] Could not synthesize bell preview:', err);
    return false;
  }
}
