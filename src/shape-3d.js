import * as THREE from 'three';
import { canvas, DISPLAY_SIZE, state } from './config.js';
import {
    createVolumeSet,
    extractVolumeSurface,
    MAIN_VOLUME,
    surfCX,
    surfCY,
    surfCZ,
    surfLineCount,
    surfLineIdx,
    surfPos,
    surfTriCount,
    surfTriIdx,
    surfVertCount,
    useVolumeDomain,
    VOL_CELLS,
    VOL_N,
    VOL_N2,
    VOL_TORUS_A,
    VOL_TORUS_R,
} from './volume-field.js';
import { NODAL_BASE, SCOPE_BG } from './render-buffers.js';
import { fieldModeCount, plateFade } from './wave-field.js';
import { smoothShare } from './nodal-renderer.js';

const SHAPE3D_SETTINGS = { auto: true, locked: false, skin: false, cut: 0 };
const shape3dInstances = [];
// All views share this buffer. They render one after the other.
const surfCol = new Float32Array(VOL_CELLS * 3);

const SHAPE3D_ORANGE = 0xff7a1a;
const SHAPE3D_GREEN = 0x3dff7a;
const KIND_CUBE = 1, KIND_SPHERE = 2, KIND_CYLINDER = 3, KIND_TORUS = 4;
export const SHAPE3D_KINDS = { cube: KIND_CUBE, sphere: KIND_SPHERE, cylinder: KIND_CYLINDER, torus: KIND_TORUS };

const CAM_HOME = { theta: 0.74, phi: 1.1, radius: 3.9 };

const tintFlags = { gold: false, clash: false, partialGold: false, partialClash: false };
function readTintFlags() {
    tintFlags.gold = state.showGoldenHarmonics && state.goldLevel > 0.01 && state.goldModeCount > 0;
    tintFlags.clash = state.showClashingHarmonics && state.clashLevel > 0.01 && state.clashModeCount > 0;
    tintFlags.partialGold = tintFlags.gold && !state.goldAllModes;
    tintFlags.partialClash = tintFlags.clash && !state.clashAllModes;
}

function gradientShare(buf, i, dx, dy, dz) {
    const gx = (buf[i + 1] - buf[i - 1]) * 0.5;
    const gy = (buf[i + VOL_N] - buf[i - VOL_N]) * 0.5;
    const gz = (buf[i + VOL_N2] - buf[i - VOL_N2]) * 0.5;
    const gm = Math.sqrt(gx * gx + gy * gy + gz * gz);
    const rx = dx - gx, ry = dy - gy, rz = dz - gz;
    return gm / (gm + Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-6);
}

export function createShape3D(opts) {
    const sandCount = opts.particles || 20000;
    const vol = opts.vol || createVolumeSet();
    let kind = 0;
    let name = 'cube';
    const cages = {};

    let canvas3d = opts.canvas;
    if (!canvas3d) {
        canvas3d = document.createElement('canvas');
        canvas3d.id = 'shape3dCanvas';
        opts.screen.insertBefore(canvas3d, opts.screen.querySelector('#chladniCanvas').nextSibling);
    }
    const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(opts.pixelRatio || Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(DISPLAY_SIZE, DISPLAY_SIZE, false);
    renderer.setClearColor(SCOPE_BG, 1);
    renderer.localClippingEnabled = true;
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 10);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x020a05, 0.2);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);
    const cam = {
        theta: CAM_HOME.theta, phi: CAM_HOME.phi, radius: CAM_HOME.radius,
        tTheta: CAM_HOME.theta, tPhi: CAM_HOME.phi, tRadius: CAM_HOME.radius,
        dragging: false, lastX: 0, lastY: 0
    };

    const px = new Float32Array(sandCount), py = new Float32Array(sandCount), pz = new Float32Array(sandCount);
    const pvx = new Float32Array(sandCount), pvy = new Float32Array(sandCount), pvz = new Float32Array(sandCount);
    const pSpeed = new Float32Array(sandCount), pFric = new Float32Array(sandCount);
    const sandPos = new Float32Array(sandCount * 3);
    const sandCol = new Float32Array(sandCount * 3);
    for (let i = 0; i < sandCount; i++) {
        pSpeed[i] = 0.011 + Math.random() * 0.006;
        pFric[i] = 0.80 + Math.random() * 0.07;
        px[i] = Math.random() * 2 - 1; py[i] = Math.random() * 2 - 1; pz[i] = Math.random() * 2 - 1;
    }

    function inside(k, x, y, z) {
        if (k === KIND_CUBE) return true;
        if (k === KIND_SPHERE) return x * x + y * y + z * z <= 1;
        if (k === KIND_CYLINDER) return x * x + z * z <= 1;
        const rho = Math.sqrt(x * x + z * z) - VOL_TORUS_R;
        return rho * rho + y * y <= VOL_TORUS_A * VOL_TORUS_A;
    }

    function reseedOutside() {
        for (let i = 0; i < sandCount; i++) {
            pvx[i] = pvy[i] = pvz[i] = 0;
            if (inside(kind, px[i], py[i], pz[i])) continue;
            let placed = false;
            for (let t = 0; t < 40 && !placed; t++) {
                const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
                if (inside(kind, x, y, z)) { px[i] = x; py[i] = y; pz[i] = z; placed = true; }
            }
            if (!placed) { px[i] = VOL_TORUS_R; py[i] = 0; pz[i] = 0; }
        }
    }

    function jolt(strength) {
        for (let i = 0; i < sandCount; i++) {
            pvx[i] += (Math.random() - 0.5) * strength;
            pvy[i] += (Math.random() - 0.5) * strength;
            pvz[i] += (Math.random() - 0.5) * strength;
        }
    }

    function lineMat(color, opacity) { return new THREE.LineBasicMaterial({ color, transparent: true, opacity }); }
    function ring(radius, color, opacity) {
        const pts = [];
        for (let s = 0; s < 96; s++) {
            const a = (s / 96) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
        }
        return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color, opacity));
    }

    (function buildCages() {
        const O = SHAPE3D_ORANGE, G = SHAPE3D_GREEN;

        const cube = new THREE.Group();
        cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.02, 2.02, 2.02)), lineMat(O, 0.55)));
        const ticks = [];
        for (let i = -9; i <= 9; i++) {
            const t = i / 10, len = (i % 5 === 0) ? 0.07 : 0.035;
            ticks.push(-1.01, t, -1.01, -1.01 + len, t, -1.01);
            ticks.push(t, -1.01, 1.01, t, -1.01 + len, 1.01);
            ticks.push(1.01, -1.01, t, 1.01, -1.01 + len, t);
        }
        const tickGeom = new THREE.BufferGeometry();
        tickGeom.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
        cube.add(new THREE.LineSegments(tickGeom, lineMat(G, 0.5)));
        cages.cube = cube;

        const sphere = new THREE.Group();
        const equator = ring(1.02, O, 0.55); equator.rotation.x = Math.PI / 2;
        const meridianA = ring(1.02, G, 0.4);
        const meridianB = ring(1.02, O, 0.3); meridianB.rotation.y = Math.PI / 2;
        sphere.add(equator, meridianA, meridianB);
        cages.sphere = sphere;

        const cylinder = new THREE.Group();
        for (const y of [-1.01, 0, 1.01]) {
            const r = ring(1.02, y === 0 ? G : O, y === 0 ? 0.25 : 0.55);
            r.rotation.x = Math.PI / 2; r.position.y = y;
            cylinder.add(r);
        }
        const struts = [];
        for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            struts.push(Math.cos(a) * 1.02, -1.01, Math.sin(a) * 1.02, Math.cos(a) * 1.02, 1.01, Math.sin(a) * 1.02);
        }
        const strutGeom = new THREE.BufferGeometry();
        strutGeom.setAttribute('position', new THREE.Float32BufferAttribute(struts, 3));
        cylinder.add(new THREE.LineSegments(strutGeom, lineMat(G, 0.3)));
        cages.cylinder = cylinder;

        const torus = new THREE.Group();
        const outer = ring(VOL_TORUS_R + VOL_TORUS_A + 0.01, O, 0.55); outer.rotation.x = Math.PI / 2;
        const inner = ring(VOL_TORUS_R - VOL_TORUS_A - 0.01, O, 0.55); inner.rotation.x = Math.PI / 2;
        torus.add(outer, inner);
        for (let k = 0; k < 8; k++) {
            const section = new THREE.Group();
            const sectionRing = ring(VOL_TORUS_A + 0.01, G, 0.32);
            sectionRing.position.x = VOL_TORUS_R;
            section.add(sectionRing);
            section.rotation.y = (k / 8) * Math.PI * 2;
            torus.add(section);
        }
        cages.torus = torus;

        for (const key in cages) { cages[key].visible = false; scene.add(cages[key]); }
    })();

    const posAttr = new THREE.BufferAttribute(surfPos, 3).setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(surfCol, 3).setUsage(THREE.DynamicDrawUsage);
    const lineIdxAttr = new THREE.BufferAttribute(surfLineIdx, 1).setUsage(THREE.DynamicDrawUsage);
    const triIdxAttr = new THREE.BufferAttribute(surfTriIdx, 1).setUsage(THREE.DynamicDrawUsage);

    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', posAttr);
    lineGeom.setAttribute('color', colAttr);
    lineGeom.setIndex(lineIdxAttr);
    lineGeom.setDrawRange(0, 0);
    const lineMesh = new THREE.LineSegments(lineGeom, new THREE.LineBasicMaterial({
        // Use normal blending. Overlapping lines then do not add up to white.
        vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false,
        clippingPlanes: [clipPlane]
    }));

    const fillGeom = new THREE.BufferGeometry();
    fillGeom.setAttribute('position', posAttr);
    fillGeom.setAttribute('color', colAttr);
    fillGeom.setIndex(triIdxAttr);
    fillGeom.setDrawRange(0, 0);
    const fillMesh = new THREE.Mesh(fillGeom, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false,
        clippingPlanes: [clipPlane]
    }));

    lineMesh.frustumCulled = fillMesh.frustumCulled = false;
    lineMesh.visible = fillMesh.visible = false;
    scene.add(fillMesh, lineMesh);

    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = spriteCanvas.height = 32;
    const spriteCtx = spriteCanvas.getContext('2d');
    const spriteGradient = spriteCtx.createRadialGradient(16, 16, 1, 16, 16, 15);
    spriteGradient.addColorStop(0, 'rgba(255,255,255,1)');
    spriteGradient.addColorStop(0.45, 'rgba(255,255,255,0.8)');
    spriteGradient.addColorStop(1, 'rgba(255,255,255,0)');
    spriteCtx.fillStyle = spriteGradient;
    spriteCtx.fillRect(0, 0, 32, 32);

    const sandPosAttr = new THREE.BufferAttribute(sandPos, 3).setUsage(THREE.DynamicDrawUsage);
    const sandColAttr = new THREE.BufferAttribute(sandCol, 3).setUsage(THREE.DynamicDrawUsage);
    const sandGeom = new THREE.BufferGeometry();
    sandGeom.setAttribute('position', sandPosAttr);
    sandGeom.setAttribute('color', sandColAttr);
    const sandPoints = new THREE.Points(sandGeom, new THREE.PointsMaterial({
        size: 0.022, map: new THREE.CanvasTexture(spriteCanvas), vertexColors: true, transparent: true,
        opacity: 0.7, depthWrite: false, clippingPlanes: [clipPlane]
    }));
    sandPoints.frustumCulled = false;
    sandPoints.renderOrder = 2;
    scene.add(sandPoints);

    if (opts.main && opts.screen) {
        const hint = document.createElement('div');
        hint.className = 'badge left hint3d';
        hint.textContent = '3D VOLUME · DRAG ORBIT · WHEEL ZOOM · DBL-CLICK RESET';
        opts.screen.appendChild(hint);
    }

    canvas3d.style.touchAction = 'none';
    canvas3d.addEventListener('pointerdown', (e) => {
        if (SHAPE3D_SETTINGS.locked) return;
        cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY;
        canvas3d.setPointerCapture(e.pointerId);
    });
    canvas3d.addEventListener('pointermove', (e) => {
        if (!cam.dragging || SHAPE3D_SETTINGS.locked) return;
        cam.tTheta -= (e.clientX - cam.lastX) * 0.0075;
        cam.tPhi = Math.max(0.15, Math.min(Math.PI - 0.15, cam.tPhi - (e.clientY - cam.lastY) * 0.0075));
        cam.lastX = e.clientX; cam.lastY = e.clientY;
    });
    const endDrag = (e) => {
        cam.dragging = false;
        try { canvas3d.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas3d.addEventListener('pointerup', endDrag);
    canvas3d.addEventListener('pointercancel', endDrag);
    canvas3d.addEventListener('wheel', (e) => {
        e.preventDefault();
        cam.tRadius = Math.max(1.8, Math.min(7, cam.tRadius + e.deltaY * 0.002));
    }, { passive: false });
    canvas3d.addEventListener('dblclick', () => {
        cam.tTheta = CAM_HOME.theta; cam.tPhi = CAM_HOME.phi; cam.tRadius = CAM_HOME.radius;
    });

    function updateCamera() {
        if (SHAPE3D_SETTINGS.auto && !SHAPE3D_SETTINGS.locked && !cam.dragging) cam.tTheta += 0.0032;
        cam.theta += (cam.tTheta - cam.theta) * 0.14;
        cam.phi += (cam.tPhi - cam.phi) * 0.14;
        cam.radius += (cam.tRadius - cam.radius) * 0.14;
        const sinPhi = Math.sin(cam.phi);
        camera.position.set(
            cam.radius * sinPhi * Math.sin(cam.theta),
            cam.radius * Math.cos(cam.phi),
            cam.radius * sinPhi * Math.cos(cam.theta)
        );
        camera.lookAt(0, 0, 0);
    }

    function updateSurface(now, hasSound) {
        const show = state.showNodalLines && hasSound;
        const skinOn = SHAPE3D_SETTINGS.skin;
        lineMesh.visible = show;
        fillMesh.visible = show && skinOn;
        if (!show) return;

        extractVolumeSurface(vol.amp);

        readTintFlags();
        const { gold: useGold, clash: useClash, partialGold, partialClash } = tintFlags;
        const tint = useGold || useClash;
        const shimmerT = now * 0.004, flickerT = now * 0.016;
        const baseR = NODAL_BASE.r / 255, baseG = NODAL_BASE.g / 255, baseB = NODAL_BASE.b / 255;
        const fade = plateFade;
        const vertCount = surfVertCount;
        const amp = vol.amp;

        for (let k = 0; k < vertCount; k++) {
            let r = baseR, g = baseG, b = baseB;
            if (tint) {
                const cx = surfCX[k] < 1 ? 1 : surfCX[k];
                const cy = surfCY[k] < 1 ? 1 : surfCY[k];
                const cz = surfCZ[k] < 1 ? 1 : surfCZ[k];
                const cell = cz * VOL_N2 + cy * VOL_N + cx;
                const gx = (amp[cell + 1] - amp[cell - 1]) * 0.5;
                const gy = (amp[cell + VOL_N] - amp[cell - VOL_N]) * 0.5;
                const gz = (amp[cell + VOL_N2] - amp[cell - VOL_N2]) * 0.5;
                const phase = surfCX[k] + surfCY[k] + surfCZ[k];

                let goldT = 0, clashT = 0;
                if (useGold) goldT = smoothShare(partialGold ? gradientShare(vol.gold, cell, gx, gy, gz) : 1) * state.goldLevel;
                if (useClash) clashT = smoothShare(partialClash ? gradientShare(vol.clash, cell, gx, gy, gz) : 1) * state.clashLevel;

                if (clashT > goldT) {
                    if (clashT > 0.02) {
                        const flicker = 0.5 + 0.5 * Math.sin(flickerT + phase * 0.5);
                        r += (1 - r) * clashT;
                        g += ((40 + 55 * flicker) / 255 - g) * clashT;
                        b += ((55 + 40 * flicker) / 255 - b) * clashT;
                    }
                } else if (goldT > 0.02) {
                    const shimmer = 0.5 + 0.5 * Math.sin(shimmerT + phase * 0.18);
                    r += (1 - r) * goldT;
                    g += ((190 + 46 * shimmer) / 255 - g) * goldT;
                    b += ((40 + 110 * shimmer) / 255 - b) * goldT;
                }
            }
            const c = k * 3;
            surfCol[c] = r * fade; surfCol[c + 1] = g * fade; surfCol[c + 2] = b * fade;
        }

        posAttr.updateRange.offset = 0; posAttr.updateRange.count = vertCount * 3; posAttr.needsUpdate = true;
        colAttr.updateRange.offset = 0; colAttr.updateRange.count = vertCount * 3; colAttr.needsUpdate = true;
        lineIdxAttr.updateRange.offset = 0; lineIdxAttr.updateRange.count = surfLineCount; lineIdxAttr.needsUpdate = true;
        if (skinOn) { triIdxAttr.updateRange.offset = 0; triIdxAttr.updateRange.count = surfTriCount; triIdxAttr.needsUpdate = true; }
        lineMesh.material.opacity = Math.max(0.3, Math.min(0.8, 0.8 - (surfLineCount - 20000) / 120000));
        lineGeom.setDrawRange(0, surfLineCount);
        fillGeom.setDrawRange(0, surfTriCount);
    }

    function updateSand(hasSound) {
        sandPoints.visible = state.showParticles;
        if (!state.showParticles) return;

        const amp = vol.amp;
        const speedMult = state.globalSpeedMultiplier;
        const gridScale = (VOL_N - 3) * 0.5;
        const gridMax = VOL_N - 2;
        readTintFlags();
        const { gold: useGold, clash: useClash, partialGold, partialClash } = tintFlags;
        const tint = hasSound && (useGold || useClash);
        const torusR = VOL_TORUS_R, torusA = VOL_TORUS_A;

        for (let i = 0; i < sandCount; i++) {
            let x = px[i], y = py[i], z = pz[i];
            let vx = pvx[i], vy = pvy[i], vz = pvz[i];
            let r = 0.80, g = 1.0, b = 0.86;

            if (hasSound) {
                let gx = ((x + 1) * gridScale + 1) | 0, gy = ((y + 1) * gridScale + 1) | 0, gz = ((z + 1) * gridScale + 1) | 0;
                gx = gx < 1 ? 1 : (gx > gridMax ? gridMax : gx);
                gy = gy < 1 ? 1 : (gy > gridMax ? gridMax : gy);
                gz = gz < 1 ? 1 : (gz > gridMax ? gridMax : gz);
                const cell = gz * VOL_N2 + gy * VOL_N + gx;

                const f = amp[cell];
                const absF = f < 0 ? -f : f;
                const dfx = (amp[cell + 1] - amp[cell - 1]) * 0.5;
                const dfy = (amp[cell + VOL_N] - amp[cell - VOL_N]) * 0.5;
                const dfz = (amp[cell + VOL_N2] - amp[cell - VOL_N2]) * 0.5;

                const sign = f >= 0 ? 1 : -1;
                const gradMag = Math.sqrt(dfx * dfx + dfy * dfy + dfz * dfz) + 1e-4;
                const step = Math.min(absF, 0.35) / gradMag * sign * pSpeed[i] * speedMult;
                vx -= dfx * step; vy -= dfy * step; vz -= dfz * step;

                const jitter = absF * 0.028 * speedMult;
                vx += (Math.random() - 0.5) * jitter;
                vy += (Math.random() - 0.5) * jitter;
                vz += (Math.random() - 0.5) * jitter;

                if (tint) {
                    let goldT = 0, clashT = 0;
                    if (useGold) goldT = smoothShare(partialGold ? gradientShare(vol.gold, cell, dfx, dfy, dfz) : 1) * state.goldLevel;
                    if (useClash) clashT = smoothShare(partialClash ? gradientShare(vol.clash, cell, dfx, dfy, dfz) : 1) * state.clashLevel;
                    if (clashT > goldT) {
                        if (clashT > 0.02) { r += (1 - r) * clashT; g += (0.25 - g) * clashT; b += (0.3 - b) * clashT; }
                    } else if (goldT > 0.02) {
                        r += (1 - r) * goldT; g += (0.82 - g) * goldT; b += (0.25 - b) * goldT;
                    }
                }
            } else {
                vx += (Math.random() - 0.5) * 0.0015 * speedMult;
                vy += (Math.random() - 0.5) * 0.0015 * speedMult;
                vz += (Math.random() - 0.5) * 0.0015 * speedMult;
            }

            const fric = pFric[i];
            vx *= fric; vy *= fric; vz *= fric;
            x += vx; y += vy; z += vz;

            if (kind === KIND_CUBE) {
                if (x < -1) { x = -1; vx *= -0.5; } else if (x > 1) { x = 1; vx *= -0.5; }
                if (y < -1) { y = -1; vy *= -0.5; } else if (y > 1) { y = 1; vy *= -0.5; }
                if (z < -1) { z = -1; vz *= -0.5; } else if (z > 1) { z = 1; vz *= -0.5; }
            } else if (kind === KIND_SPHERE) {
                const rs = x * x + y * y + z * z;
                if (rs > 1) {
                    const inv = 1 / Math.sqrt(rs);
                    const nx = x * inv, ny = y * inv, nz = z * inv;
                    const d = vx * nx + vy * ny + vz * nz;
                    vx = (vx - 2 * d * nx) * 0.5; vy = (vy - 2 * d * ny) * 0.5; vz = (vz - 2 * d * nz) * 0.5;
                    x = nx * 0.995; y = ny * 0.995; z = nz * 0.995;
                }
            } else if (kind === KIND_CYLINDER) {
                const rs = x * x + z * z;
                if (rs > 1) {
                    const inv = 1 / Math.sqrt(rs);
                    const nx = x * inv, nz = z * inv;
                    const d = vx * nx + vz * nz;
                    vx = (vx - 2 * d * nx) * 0.5; vz = (vz - 2 * d * nz) * 0.5;
                    x = nx * 0.995; z = nz * 0.995;
                }
                if (y < -1) { y = -1; vy *= -0.5; } else if (y > 1) { y = 1; vy *= -0.5; }
            } else {
                let rho = Math.sqrt(x * x + z * z);
                if (rho < 1e-4) rho = 1e-4;
                const dr = rho - torusR;
                const d2 = dr * dr + y * y;
                if (d2 > torusA * torusA) {
                    const d = Math.sqrt(d2);
                    const ux = x / rho, uz = z / rho;
                    const nx = dr * ux / d, ny = y / d, nz = dr * uz / d;
                    const dn = vx * nx + vy * ny + vz * nz;
                    vx = (vx - 2 * dn * nx) * 0.5; vy = (vy - 2 * dn * ny) * 0.5; vz = (vz - 2 * dn * nz) * 0.5;
                    const inset = 0.99 * torusA;
                    x = ux * torusR + nx * inset; y = ny * inset; z = uz * torusR + nz * inset;
                }
            }

            px[i] = x; py[i] = y; pz[i] = z;
            pvx[i] = vx; pvy[i] = vy; pvz[i] = vz;

            const i3 = i * 3;
            sandPos[i3] = x; sandPos[i3 + 1] = y; sandPos[i3 + 2] = z;
            const speedSq = vx * vx + vy * vy + vz * vz;
            const brightness = Math.max(0.22, Math.min(1, 1 - speedSq * 35000));
            sandCol[i3] = r * brightness; sandCol[i3 + 1] = g * brightness; sandCol[i3 + 2] = b * brightness;
        }
        sandPosAttr.needsUpdate = true;
        sandColAttr.needsUpdate = true;
    }

    const inst = {
        canvas: canvas3d,
        vol,
        get name() { return name; },

        setName(n) {
            if (!SHAPE3D_KINDS[n]) return;
            name = n;
            kind = SHAPE3D_KINDS[n];
            for (const key in cages) cages[key].visible = (key === n);
            reseedOutside();
            jolt(0.16);
        },

        jolt,

        resize() {
            const w = canvas3d.clientWidth;
            const s = Math.max(120, Math.min(1800, w || DISPLAY_SIZE));
            renderer.setSize(s, s, false);
        },

        applyLock() { canvas3d.style.cursor = SHAPE3D_SETTINGS.locked ? 'default' : ''; },

        render(now) {
            useVolumeDomain(name);
            const hasSound = fieldModeCount > 0;
            updateSurface(now, hasSound);
            updateSand(hasSound);
            updateCamera();

            const cp = camera.position, len = cp.length() || 1;
            clipPlane.normal.set(-cp.x / len, -cp.y / len, -cp.z / len);
            clipPlane.constant = 1.8 - 2.8 * SHAPE3D_SETTINGS.cut;
            renderer.render(scene, camera);
        }
    };
    shape3dInstances.push(inst);
    inst.applyLock();
    return inst;
}

let mainShape3D = null;
let shape3dFailed = false;

export function setShape3D(name) {
    const screenEl = canvas.parentNode;
    if (!name) {
        state.shape3d = null;
        screenEl.classList.remove('mode-3d');
        return true;
    }
    if (!mainShape3D && !shape3dFailed) {
        try {
            mainShape3D = createShape3D({ screen: screenEl, vol: MAIN_VOLUME, main: true });
        } catch (err) {
            console.warn('3D shapes disabled:', err);
            shape3dFailed = true;
            const stray = document.getElementById('shape3dCanvas');
            if (stray) stray.remove();
        }
    }
    if (!mainShape3D) return false;
    mainShape3D.setName(name);
    state.shape3d = name;
    screenEl.classList.add('mode-3d');
    mainShape3D.resize();
    return true;
}

export function renderShape3D(now) { if (mainShape3D && state.shape3d) mainShape3D.render(now); }
export function joltShape3D(strength) { if (mainShape3D) mainShape3D.jolt(strength); }
export function setShape3DAutoOrbit(on) { SHAPE3D_SETTINGS.auto = !!on; }
export function setShape3DLock(on) {
    SHAPE3D_SETTINGS.locked = !!on;
    for (let i = 0; i < shape3dInstances.length; i++) shape3dInstances[i].applyLock();
}
export function setShape3DSkin(on) { SHAPE3D_SETTINGS.skin = !!on; }
export function setShape3DCutaway(t) { SHAPE3D_SETTINGS.cut = Math.max(0, Math.min(1, t)); }
export function setShape3DLattice(level) { state.surfLineStride = Math.max(1, Math.min(3, level | 0)); }
export function resizeShape3D() { for (let i = 0; i < shape3dInstances.length; i++) shape3dInstances[i].resize(); }
