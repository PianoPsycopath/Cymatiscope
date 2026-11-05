export const canvas = document.getElementById('chladniCanvas');
export const ctx = canvas.getContext('2d');
export const DISPLAY_SIZE = 600;
export const FIELD_SIZE = 360;
export const FIELD_CELLS = FIELD_SIZE * FIELD_SIZE;
export const R_BINS = 512;
export const THETA_BINS = 1024;
export const NUM_PARTICLES = 10000;

export const activeKeysMap = new Map();
export let audioPeakSlots = [];
export let activeWaveModes = [];

export const state = {
    synthVolume: 0.08,
    goldLevel: 0,
    clashLevel: 0,
    lastHarmonyUpdate: 0,
    lastHarmonyStr: '',
    totalWaveWeight: 0,
    goldModeCount: 0,
    goldAllModes: false,
    clashModeCount: 0,
    clashAllModes: false,
    goldLayerVisible: false,
    clashLayerVisible: false,
    shape3d: null,
    // The sign changes at each snap. A repeated chord then gives a new shape.
    formFlipSign: 1,
    lockedAudioPeaks: [],
    changeCounter: 0,
    // 3D shapes use the square plate for the physics.
    plateShape: 'square',
    globalSpeedMultiplier: 1.8,
    showNodalLines: true,
    showGoldenHarmonics: true,
    showClashingHarmonics: true,
    showParticles: false,
    audioSyncMode: 'continuous',
    changesPerForm: 1,
    changeSensitivity: 1.445,
    minChangeGapMs: 240,
    surfLineStride: 2,
    fileProgressCb: () => {},
    fileSpectra: null,
    fileDists: null,
    fileEvents: [],
    fileFrames: 0,
    tabAudioCtx: null,
    tabAnalyser: null,
    meterHold: 0,
    lastChordShown: null,
    isListeningToTab: false,
};