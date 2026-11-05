import { state } from './config.js';

// Equal-temperament fifths are about 2 cents off. Keep the window above this value.
const KEY_TOL_CENTS = 7;
// FFT peaks are not exact. Audio uses a wider window.
const AUDIO_TOL_CENTS = 30;
const SACRED_TOL_CENTS = 20;
const SACRED_FREQS = [174, 285, 396, 417, 432, 528, 639, 741, 852, 963];
const FIFTH_FRAC = Math.log2(3 / 2);
const FOURTH_FRAC = Math.log2(4 / 3);
export const GOLD_MIN = 0.05;
const harmonyStatusEl = document.getElementById('harmonyStatus');
const clashStatusEl = document.getElementById('clashStatus');

function pairStrength(errCents, tol) {
    const s = (1 - errCents / tol) * 1.5;
    return s <= 0 ? 0 : (s >= 1 ? 1 : s);
}

const CLASH_INTERVALS = [
    { cents: 100,  weight: 1.0,  name: 'Minor 2nd' },
    { cents: 200,  weight: 0.55, name: 'Major 2nd' },
    { cents: 600,  weight: 0.9,  name: 'Tritone' },
    { cents: 1000, weight: 0.55, name: 'Minor 7th' },
    { cents: 1100, weight: 1.0,  name: 'Major 7th' }
];
const KEY_CLASH_WINDOW = 25;
const AUDIO_CLASH_WINDOW = 55;

export function analyzeHarmony(modes) {
    const n = modes.length;
    const logs = new Array(n);
    for (let i = 0; i < n; i++) {
        logs[i] = Math.log2(modes[i].freq);
        modes[i].gold = 0;
        modes[i].clash = 0;
    }

    const labels = new Set();
    const clashLabels = new Set();
    let maxStrength = 0;
    let maxClash = 0;

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const d = Math.abs(logs[i] - logs[j]);
            const octaves = Math.round(d);
            const frac = d - Math.floor(d);
            const isAudio = modes[i].audio || modes[j].audio;
            const tol = isAudio ? AUDIO_TOL_CENTS : KEY_TOL_CENTS;

            const errOct = Math.abs(d - octaves) * 1200;
            const errFifth = Math.abs(frac - FIFTH_FRAC) * 1200;
            const errFourth = Math.abs(frac - FOURTH_FRAC) * 1200;

            let err = errOct;
            let label = octaves === 0 ? 'Unison 1:1' : (octaves === 1 ? 'Octave 2:1' : `${octaves} octaves`);
            if (errFifth < err) { err = errFifth; label = 'Fifth 3:2'; }
            if (errFourth < err) { err = errFourth; label = 'Fourth 4:3'; }

            const st = pairStrength(err, tol);
            if (st > GOLD_MIN) {
                if (st > modes[i].gold) modes[i].gold = st;
                if (st > modes[j].gold) modes[j].gold = st;
                if (st > maxStrength) maxStrength = st;
                labels.add(label);
                continue;
            }

            const cents = frac * 1200;
            const win = isAudio ? AUDIO_CLASH_WINDOW : KEY_CLASH_WINDOW;
            for (let k = 0; k < CLASH_INTERVALS.length; k++) {
                const ci = CLASH_INTERVALS[k];
                const cs = ci.weight * pairStrength(Math.abs(cents - ci.cents), win);
                if (cs > GOLD_MIN) {
                    if (cs > modes[i].clash) modes[i].clash = cs;
                    if (cs > modes[j].clash) modes[j].clash = cs;
                    if (cs > maxClash) maxClash = cs;
                    clashLabels.add(ci.name);
                    break;
                }
            }
        }
    }

    for (let i = 0; i < n; i++) {
        const tol = modes[i].audio ? SACRED_TOL_CENTS * 1.75 : SACRED_TOL_CENTS;
        for (let k = 0; k < SACRED_FREQS.length; k++) {
            const err = Math.abs(logs[i] - Math.log2(SACRED_FREQS[k])) * 1200;
            const st = pairStrength(err, tol);
            if (st > GOLD_MIN) {
                if (st > modes[i].gold) modes[i].gold = st;
                if (st > maxStrength) maxStrength = st;
                labels.add(`${SACRED_FREQS[k]} Hz`);
            }
        }
    }

    return {
        maxStrength,
        maxClash,
        labels: Array.from(labels).sort(),
        clashLabels: Array.from(clashLabels).sort()
    };
}

export function updateGoldLevel(target) {
    state.goldLevel += (target - state.goldLevel) * (target > state.goldLevel ? 0.35 : 0.06);
    if (state.goldLevel < 0.003) state.goldLevel = 0;
}

export function updateClashLevel(target) {
    state.clashLevel += (target - state.clashLevel) * (target > state.clashLevel ? 0.4 : 0.08);
    if (state.clashLevel < 0.003) state.clashLevel = 0;
}

export function setHarmonyReadout(labels, clashLabels) {
    const g = (state.showGoldenHarmonics && labels && labels.length) ? labels.join(' · ') : '';
    const c = (state.showClashingHarmonics && clashLabels && clashLabels.length) ? clashLabels.join(' · ') : '';
    const key = g + '\u0001' + c;
    if (key === state.lastHarmonyStr) return;
    const now = performance.now();
    if (now - state.lastHarmonyUpdate < 120) return;
    state.lastHarmonyUpdate = now;
    state.lastHarmonyStr = key;

    if (g) {
        harmonyStatusEl.textContent = '✦ ' + g;
        harmonyStatusEl.classList.remove('hidden');
    } else {
        harmonyStatusEl.classList.add('hidden');
    }
    if (c) {
        clashStatusEl.textContent = '✖ ' + c;
        clashStatusEl.classList.remove('hidden');
    } else {
        clashStatusEl.classList.add('hidden');
    }
}
