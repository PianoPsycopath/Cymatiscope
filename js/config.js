const canvas = document.getElementById('chladniCanvas');
const ctx = canvas.getContext('2d');
const DISPLAY_SIZE = 600;
const FIELD_SIZE = 360;
const FIELD_CELLS = FIELD_SIZE * FIELD_SIZE;
const R_BINS = 512;
const THETA_BINS = 1024;
const NUM_PARTICLES = 10000;

// 3D shapes use the square plate for the physics.
let plateShape = 'square';
let shape3d = null;
let globalSpeedMultiplier = 1.8;
let showNodalLines = false;
let showParticles = true;
let showGoldenHarmonics = true;
let showClashingHarmonics = true;

let goldLevel = 0;
let goldModeCount = 0;
let goldAllModes = false;
let goldLayerVisible = false;
let clashLevel = 0;
let clashModeCount = 0;
let clashAllModes = false;
let clashLayerVisible = false;
let lastHarmonyStr = '';
let lastHarmonyUpdate = 0;

const activeKeysMap = new Map();
let audioPeakSlots = [];
let lockedAudioPeaks = [];
let activeWaveModes = [];
let totalWaveWeight = 0;

let audioSyncMode = 'locked';
let changesPerForm = 1;
let changeCounter = 0;
let changeSensitivity = 1.445;
let minChangeGapMs = 240;
// The sign changes at each snap. A repeated chord then gives a new shape.
let formFlipSign = 1;
