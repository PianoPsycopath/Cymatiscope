const HC_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const HC_CHORDS = [
    { name: '',     tones: [0, 4, 7] },
    { name: 'm',    tones: [0, 3, 7] },
    { name: 'dim',  tones: [0, 3, 6] },
    { name: 'aug',  tones: [0, 4, 8] },
    { name: 'sus2', tones: [0, 2, 7] },
    { name: 'sus4', tones: [0, 5, 7] },
    { name: 'maj7', tones: [0, 4, 7, 11] },
    { name: '7',    tones: [0, 4, 7, 10] },
    { name: 'm7',   tones: [0, 3, 7, 10] },
    { name: '5',    tones: [0, 7] }
];

function hcDetectChord(chroma) {
    let total = 0;
    for (let i = 0; i < 12; i++) total += chroma[i];
    let bestName = '';
    let bestScore = 1.0;
    for (let root = 0; root < 12; root++) {
        for (let t = 0; t < HC_CHORDS.length; t++) {
            const tpl = HC_CHORDS[t];
            let sum = 0, minTone = 1;
            for (let k = 0; k < tpl.tones.length; k++) {
                const c = chroma[(root + tpl.tones[k]) % 12];
                sum += c;
                if (c < minTone) minTone = c;
            }
            if (minTone < 0.25) continue;
            const score = (sum - 0.6 * (total - sum)) / Math.sqrt(tpl.tones.length) + 0.15 * chroma[root];
            if (score > bestScore) { bestScore = score; bestName = HC_NOTE_NAMES[root] + tpl.name; }
        }
    }
    return bestName;
}

class HarmonyChangeTracker {
    constructor(sampleRate, binCount) {
        this.binHz = (sampleRate * 0.5) / binCount;
        this.lo = Math.max(2, Math.floor(80 / this.binHz));
        this.hi = Math.min(binCount - 3, Math.ceil(2000 / this.binHz));

        this.peaks = [];
        this.raw = new Float32Array(12);
        this.cur = new Float32Array(12);
        this.ref = new Float32Array(12);
        this.hasRef = false;

        this.melodyRef = -1;
        this.melodyCand = -1;
        this.melodyCandSince = 0;
        this.chordPendingSince = 0;
        this.soundSince = 0;

        this.lastChangeTime = -1e9;
        this.label = '--';
    }

    process(db, nowMs, k, minGapMs) {
        const t = Math.max(0, Math.min(1, (k - 0.73) / (1.77 - 0.73)));
        const thr = 0.08 + 0.22 * t;
        const hold = Math.max(70, minGapMs * 0.4);

        let maxDb = -Infinity;
        for (let i = this.lo; i <= this.hi; i++) if (db[i] > maxDb) maxDb = db[i];

        const peaks = this.peaks;
        peaks.length = 0;
        if (maxDb > -72) {
            const floor = Math.max(-72, maxDb - 30);
            for (let i = this.lo; i <= this.hi; i++) {
                const v = db[i];
                if (v > floor && v >= db[i - 1] && v > db[i + 1]) {
                    const a = db[i - 1], c = db[i + 1];
                    const d = a - 2 * v + c;
                    const shift = d < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / d)) : 0;
                    const f = (i + shift) * this.binHz;
                    const amp = Math.pow(10, (v - maxDb) / 20);
                    peaks.push({ f, amp, w: amp, midi: 69 + 12 * Math.log2(f / 440) });
                }
            }
            if (peaks.length > 40) {
                peaks.sort((p, q) => q.amp - p.amp);
                peaks.length = 40;
            }
            peaks.sort((p, q) => p.f - q.f);
            for (let i = 1; i < peaks.length; i++) {
                const p = peaks[i];
                for (let j = 0; j < i; j++) {
                    const q = peaks[j];
                    const r = p.f / q.f;
                    const kk = Math.round(r);
                    if (kk >= 2 && kk <= 6 && Math.abs(Math.log2(r / kk)) * 1200 < 45 && p.amp <= 0.7 * q.amp) {
                        p.w *= 0.2;
                        break;
                    }
                }
            }
        }

        const raw = this.raw;
        raw.fill(0);
        let melody = -1, melodyW = 0;
        for (let i = 0; i < peaks.length; i++) {
            const p = peaks[i];
            const nm = Math.round(p.midi);
            raw[((nm % 12) + 12) % 12] += p.w;
            if (p.f >= 200 && p.f <= 1400 && p.w > melodyW) { melodyW = p.w; melody = nm; }
        }
        if (melodyW < 0.35) melody = -1;

        let norm = 0;
        for (let i = 0; i < 12; i++) norm += raw[i] * raw[i];
        norm = Math.sqrt(norm);

        if (norm < 1e-6) {
            this.hasRef = false;
            this.soundSince = 0;
            this.chordPendingSince = 0;
            this.melodyCand = -1;
            this.cur.fill(0);
            this.label = '--';
            return { change: null, onset: 0, threshold: thr, label: '--' };
        }
        if (this.soundSince === 0) this.soundSince = nowMs;

        const cur = this.cur;
        let curNorm = 0;
        for (let i = 0; i < 12; i++) {
            cur[i] = cur[i] * 0.6 + (raw[i] / norm) * 0.4;
            curNorm += cur[i] * cur[i];
        }
        curNorm = Math.sqrt(curNorm) || 1;

        let dist = 0;
        if (this.hasRef) {
            let dot = 0;
            for (let i = 0; i < 12; i++) dot += (cur[i] / curNorm) * this.ref[i];
            dist = Math.max(0, 1 - dot);
        }

        // A change counts only after it stays for `hold` ms. This ignores short noise.
        let fire = false;
        let fireStart = Infinity;
        if (!this.hasRef) {
            if (nowMs - this.soundSince >= hold) { fire = true; fireStart = this.soundSince; }
        } else {
            if (dist > thr) {
                if (this.chordPendingSince === 0) this.chordPendingSince = nowMs;
                else if (nowMs - this.chordPendingSince >= hold) { fire = true; fireStart = Math.min(fireStart, this.chordPendingSince); }
            } else {
                this.chordPendingSince = 0;
            }

            if (melody >= 0 && melody !== this.melodyRef) {
                if (this.melodyCand !== melody) { this.melodyCand = melody; this.melodyCandSince = nowMs; }
                else if (nowMs - this.melodyCandSince >= hold) { fire = true; fireStart = Math.min(fireStart, this.melodyCandSince); }
            } else {
                this.melodyCand = -1;
            }
        }

        let change = null;
        if (fire && nowMs - this.lastChangeTime >= minGapMs) {
            change = { onsetTime: isFinite(fireStart) ? fireStart : nowMs, strength: Math.max(1.2, dist / thr) };
            for (let i = 0; i < 12; i++) this.ref[i] = cur[i] / curNorm;
            this.hasRef = true;
            this.melodyRef = melody;
            this.melodyCand = -1;
            this.chordPendingSince = 0;
            this.lastChangeTime = nowMs;
        } else if (this.hasRef && dist < thr * 0.5) {
            // Move the reference slowly. Vibrato and decay then do not cause false changes.
            for (let i = 0; i < 12; i++) this.ref[i] += (cur[i] / curNorm - this.ref[i]) * 0.02;
        }

        let cMax = 0;
        for (let i = 0; i < 12; i++) if (cur[i] > cMax) cMax = cur[i];
        const prof = new Float32Array(12);
        for (let i = 0; i < 12; i++) prof[i] = cur[i] / cMax;
        let chord = hcDetectChord(prof);
        if (!chord) {
            let cnt = 0, idx = -1;
            for (let i = 0; i < 12; i++) if (prof[i] >= 0.5) { cnt++; idx = i; }
            chord = cnt === 1 ? HC_NOTE_NAMES[idx] : '';
        }
        const mel = this.melodyRef >= 0
            ? '♪' + HC_NOTE_NAMES[((this.melodyRef % 12) + 12) % 12] + (Math.floor(this.melodyRef / 12) - 1)
            : '';
        this.label = (chord || mel) ? [chord, mel].filter(Boolean).join(' ') : '--';

        return { change, onset: dist, threshold: thr, label: this.label };
    }
}
