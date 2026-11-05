const MAX_FREQ_CHIPS = 9;

function updateDisplay() {
    const display = document.getElementById('activeKeysDisplay');
    const chips = [];

    const sortedKeys = Array.from(activeKeysMap.entries()).sort((a, b) => a[1].freq - b[1].freq);
    for (const [label, info] of sortedKeys) {
        chips.push({ cls: 'key', text: `${label} ${Math.round(info.freq)}Hz` });
    }

    if (isListeningToTab) {
        if (audioSyncMode === 'locked' && lockedAudioPeaks.length > 0) {
            const sortedLocked = [...lockedAudioPeaks].sort((a, b) => a.freq - b.freq);
            for (const item of sortedLocked) {
                chips.push({ cls: 'lock', text: `LK ${Math.round(item.freq)}Hz` });
            }
        } else if (audioSyncMode === 'continuous' && audioPeakSlots.length > 0) {
            const sortedAudio = [...audioPeakSlots]
                .filter(s => s.weight > 0.12)
                .sort((a, b) => a.freq - b.freq);
            for (const slot of sortedAudio) {
                chips.push({ cls: 'live', text: `${Math.round(slot.freq)}Hz` });
            }
        }
    }

    if (chips.length === 0) {
        display.innerHTML = '<span class="empty">-- NO SIGNAL --</span>';
        return;
    }

    const overflow = chips.length > MAX_FREQ_CHIPS;
    const shown = overflow ? chips.slice(0, MAX_FREQ_CHIPS - 1) : chips;
    let html = shown.map(c => `<span class="chip ${c.cls}">${c.text}</span>`).join('');
    if (overflow) html += `<span class="chip more">+${chips.length - shown.length} MORE</span>`;
    display.innerHTML = html;
}

function stopOscillator(label) {
    const osc = activeOscillators.get(label);
    if (!osc) return;
    osc.stop();
    osc.disconnect();
    activeOscillators.delete(label);
}

function toggleKey(label, freq, element) {
    initAudio();

    element.classList.toggle('active');

    if (element.classList.contains('active')) {
        activeKeysMap.set(label, { freq, element });

        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(masterGain);
        osc.start();
        activeOscillators.set(label, osc);

        joltParticles(0.12);
    } else {
        activeKeysMap.delete(label);
        stopOscillator(label);
    }

    updateDisplay();
}

document.getElementById('btnClearKeys').addEventListener('click', () => {
    for (const [label, info] of activeKeysMap.entries()) {
        info.element.classList.remove('active');
        stopOscillator(label);
    }
    activeKeysMap.clear();
    updateDisplay();
});

const pianoContainer = document.getElementById('pianoContainer');
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WHITE_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11];
const WHITE_KEY_COUNT = 52;
let whiteKeysBuilt = 0;

for (let midi = 21; midi <= 108; midi++) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const noteName = NOTE_NAMES[midi % 12];
    const isWhite = WHITE_PITCH_CLASSES.includes(midi % 12);
    const label = `${noteName}${Math.floor(midi / 12) - 1}`;

    const el = document.createElement('div');
    el.dataset.freq = freq;
    el.title = `${label} (${freq.toFixed(1)}Hz)`;

    const labelEl = document.createElement('div');
    labelEl.innerText = (isWhite && noteName === 'C') ? label : '';

    if (isWhite) {
        el.className = 'white-key';
        labelEl.className = 'white-key-label';
        whiteKeysBuilt++;
    } else {
        el.className = 'black-key';
        labelEl.className = 'black-key-label';
        el.style.left = `calc((100% / ${WHITE_KEY_COUNT}) * ${whiteKeysBuilt})`;
    }

    el.appendChild(labelEl);

    const handleInteract = (e) => {
        e.preventDefault();
        toggleKey(label, freq, el);
    };

    el.addEventListener('click', handleInteract);
    el.addEventListener('touchstart', handleInteract, { passive: false });

    pianoContainer.appendChild(el);
}
