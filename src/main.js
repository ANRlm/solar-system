import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { BODIES, OCCLUDERS, PRESETS, SYSTEM, TOUR } from './data.js';
import * as S from './shaders.js';
import { Music, Player } from './audio.js';
import { createUI } from './ui.js';
import { L, nameOf, isEn, onLang } from './i18n.js';

const V3 = THREE.Vector3;
const DEG = Math.PI / 180, AU_KM = 149597870.7, C_KMS = 299792.458, OBL = 23.4392911 * DEG;
const SUN_R = 7, SUN_I = 1.55, SUN_COL = new THREE.Color(1, 0.97, 0.92);
const UP = new V3(0, 1, 0);
const $ = (id) => document.getElementById(id);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const frame = () => new Promise((r) => requestAnimationFrame(r));

// ================================================================ 坐标与轨道力学
// 场景坐标：Y 轴指向黄道北极，(x, y, z)黄道 → (x, z, -y)
const ecl = (x, y, z, o = new V3()) => o.set(x, z, -y);
const eqv = (x, y, z, o) => ecl(x, y * Math.cos(OBL) + z * Math.sin(OBL), -y * Math.sin(OBL) + z * Math.cos(OBL), o);
const radec = (ra, dec, o = new V3()) => eqv(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), o);
// 展示尺度：距离按幂律压缩、半径放大，否则行星在画面里不到一个像素
const compress = (au) => 60 * Math.pow(au, 0.55);
const dispR = (km) => 1.5 * Math.pow(km / 6371, 0.55);
const toScene = (au, o) => { const r = au.length(); return o.copy(au).multiplyScalar(compress(r) / r); };

function kepler(a, e, I, O, w, M, o) {
  // 彗星偏心率接近 1：从 M + e·sinM 起步的牛顿迭代在近日点附近发散，E 跳到错误位置，彗星会闪现到内太阳系一帧
  // 改用 Danby 初值 E0 = M + 0.85e·sgn(sinM)（对任意 e<1 收敛），并迭代到收敛
  M -= Math.round(M / (2 * Math.PI)) * 2 * Math.PI;
  let E = M + 0.85 * e * Math.sign(Math.sin(M));
  for (let k = 0, dE = 1; k < 30 && Math.abs(dE) > 1e-12; k++) E -= dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return ecl((cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp, sw * sI * xp + cw * sI * yp, o);
}
function elements(el, T) {
  const [a, da, e, de, I, dI, L, dL, p, dp, O, dO] = el;
  const P = p + dp * T, N = O + dO * T;
  return { a: a + da * T, e: e + de * T, I: (I + dI * T) * DEG, O: N * DEG, w: (P - N) * DEG, M: ((((L + dL * T) - P) % 360) + 360) % 360 * DEG };
}
// 月球低精度解析解（Meeus），返回地心距离 km，o 为单位方向
function moonGeo(d, o) {
  const L = (218.316 + 13.176396 * d) * DEG, M = (134.963 + 13.064993 * d) * DEG, F = (93.272 + 13.22935 * d) * DEG;
  const D = (297.85 + 12.190749 * d) * DEG;
  const Ms = (357.529 + 0.98560028 * d) * DEG;
  // 主要摄动项；最后一项把“当日春分点”黄经换算到 J2000（岁差），与行星根数同一参考系
  const lon = L + (6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * M) - 0.186 * Math.sin(Ms) - 0.114 * Math.sin(2 * F) - 1.3969713 * d / 36525) * DEG;
  const lat = (5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) + 0.278 * Math.sin(M - F) + 0.173 * Math.sin(2 * D - F)) * DEG;
  ecl(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat), o);
  return 385001 - 20905 * Math.cos(M);
}

// ================================================================ 设置
const DEFAULT = matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
let settings;
try { settings = JSON.parse(localStorage.getItem('solar.settings')); } catch { settings = null; }
settings = { preset: DEFAULT, ...PRESETS[DEFAULT], exposure: 1, orbits: true, labels: true, belt: true, music: true, volume: 0.6, adaptive: true, sfx: true, autohide: true, idleTour: true, constellations: false, ...settings };
const saveSettings = () => localStorage.setItem('solar.settings', JSON.stringify(settings));

// ================================================================ 渲染器
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
renderer.setClearColor(0x000000, 1);
renderer.info.autoReset = false;
const gl = renderer.getContext();
const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 4;
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.002, 30000);
camera.position.set(-160, 240, 620);
const controls = new OrbitControls(camera, canvas);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.06, enablePan: false, rotateSpeed: 0.45, zoomSpeed: 0.9, maxDistance: 3000 });

async function inflate(b64) {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const s = new Blob([bin]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
function redTex(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat);
  Object.assign(t, { wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, needsUpdate: true });
  return t;
}

// ================================================================ 场景对象
let sphere = new THREE.SphereGeometry(1, settings.seg, settings.seg / 2);
const bodies = [], byId = {};
const tmp = new V3(), tmp2 = new V3();

function planetMaterial(def) {
  const defines = { [def.shade]: 1 };
  if (def.rings) defines.RINGSHADOW = 1;
  if (def.tint) defines.TINT = 1;
  if (settings.detail && def.shade === 'ROCK') defines.DETAIL = 1;
  if (def.lumpy) defines.LUMPY = 1;
  return new THREE.ShaderMaterial({
    vertexShader: S.PLANET_VERT, fragmentShader: S.PLANET_FRAG, defines,
    uniforms: {
      uMapA: { value: null }, uMapB: { value: null }, uRingTex: { value: null }, uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      uSunPos: { value: new V3() }, uSunCol: { value: SUN_COL }, uSunRel: { value: new V3() }, uSunRn: { value: 1 }, uSunI: { value: SUN_I },
      uRot: { value: new THREE.Matrix3() }, uCenter: { value: new V3() }, uRadius: { value: 1 },
      uBump: { value: def.bump || 0 }, uAmbient: { value: 0.0025 }, uCloudShift: { value: 0 }, uLights: { value: 4 },
      uOcc: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uOccAtm: { value: [0, 0, 0, 0] }, uOccN: { value: 0 },
      uRingN: { value: new V3() }, uRingR: { value: new THREE.Vector2() },
      uShinePos: { value: new V3() }, uShineCol: { value: new THREE.Color(0, 0, 0) },
      uLumpy: { value: new THREE.Vector4(...(def.lumpy || [1, 1, 1, 0])) }, uNeck: { value: def.neck || 0 },
    },
  });
}

// 行星环径向剖面（单位：行星半径），RGB 为 sqrt 编码的颜色，A 为不透明度
const RING_R = { saturn: [1.239, 2.335], uranus: [1.6, 2.02] };
function ringTexture(kind) {
  const N = 2048, data = new Uint8Array(N * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const oct = [16, 64, 256, 1024].map((n) => Array.from({ length: n + 1 }, rnd));
  const noise = (t) => oct.reduce((s, a, k) => { const x = t * (a.length - 1), i = Math.floor(x), f = x - i; return s + ((a[i] * (1 - f) + a[Math.min(i + 1, a.length - 1)] * f) - 0.5) / (k + 1); }, 0);
  const [r0, r1] = RING_R[kind];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), r = r0 + (r1 - r0) * t, n = noise(t), n2 = noise((t * 7.3) % 1);
    let c, a;
    if (kind === 'uranus') {
      const RS = [[1.637, 0.0015, 0.5], [1.652, 0.0015, 0.5], [1.666, 0.0015, 0.5], [1.75, 0.002, 0.6], [1.787, 0.002, 0.6], [1.846, 0.0015, 0.45], [1.863, 0.0015, 0.5], [1.89, 0.002, 0.6], [1.957, 0.0012, 0.35], [2.001, 0.004, 0.9]];
      a = Math.max(0.015 * (1 + n), ...RS.map(([rr, w, o]) => o * Math.exp(-(((r - rr) / w) ** 2))));
      c = [0.2, 0.2, 0.21];
      a *= 0.7;
    } else if (r < 1.527) { // C 环
      a = 0.07 + 0.08 * n + (r > 1.43 && r < 1.47 ? 0.08 : 0) + (r > 1.495 ? 0.1 : 0);
      c = [0.55, 0.50, 0.45];
    } else if (r < 1.951) { // B 环
      a = Math.min(0.98, 0.5 + 0.45 * smooth(1.527, 1.64, r) + 0.12 * n);
      c = [0.88, 0.79, 0.64].map((v) => v * (0.93 + 0.12 * n2));
    } else if (r < 2.027) { // 卡西尼缝
      a = 0.035 + 0.05 * Math.max(0, n) + (r > 2.0 ? 0.04 : 0);
      c = [0.5, 0.47, 0.44];
    } else if (r < 2.269) { // A 环（恩克环缝、基勒环缝）
      a = Math.abs(r - 2.2165) < 0.0028 || Math.abs(r - 2.2653) < 0.0007 ? 0.01 : 0.52 + 0.08 * n - 0.1 * smooth(2.23, 2.26, r);
      c = [0.80, 0.74, 0.65];
    } else { // F 环
      a = 0.55 * Math.exp(-(((r - 2.326) / 0.0016) ** 2));
      c = [0.85, 0.8, 0.74];
    }
    a = Math.min(1, Math.max(0, a));
    c.forEach((v, k) => (data[i * 4 + k] = Math.round(Math.pow(Math.min(1, v), 1.1) * 255)));
    data[i * 4 + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, N, 1);
  Object.assign(tex, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, needsUpdate: true });
  return tex;
}

for (const def of BODIES) {
  const b = { def, id: def.id, r: def.id === 'sun' ? SUN_R : dispR(def.km), pos: new V3(), au: new V3(), rot: new THREE.Matrix4(), eq: new THREE.Matrix4(), M: new V3(), phase: 0 };
  // IAU 自转模型：自转轴 P、赤道升交点 N（场景坐标）
  const ra = def.pole[0] * DEG, dec = def.pole[1] * DEG;
  b.P = radec(ra, dec);
  b.N = radec(ra + Math.PI / 2, 0);
  b.PN = new V3().crossVectors(b.P, b.N);
  b.eq.makeBasis(b.N, b.P, new V3().crossVectors(b.N, b.P));
  b.group = new THREE.Group();
  scene.add(b.group);
  if (def.id === 'sun') {
    b.mat = new THREE.ShaderMaterial({ vertexShader: S.PLANET_VERT, fragmentShader: S.SUN_FRAG, uniforms: { uTime: { value: 0 }, uI: { value: 7 } } });
    const K = 9;
    b.corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: S.CORONA_VERT, fragmentShader: S.CORONA_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: SUN_R * K }, uLift: { value: 0 }, uK: { value: K }, uTime: { value: 0 }, uI: { value: 2.2 } },
    }));
    b.corona.frustumCulled = false;
    b.group.add(b.corona);
  } else b.mat = planetMaterial(def);
  b.mesh = new THREE.Mesh(sphere, b.mat);
  b.mesh.scale.setScalar(b.r);
  b.group.add(b.mesh);
  if (def.atm) {
    const a = def.atm;
    b.atm = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
      vertexShader: S.ATMO_VERT, fragmentShader: S.ATMO_FRAG, defines: { STEPS: settings.atmo },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uCenter: { value: b.pos }, uSunPos: { value: new V3() }, uSunCol: { value: SUN_COL },
        uBR: { value: new V3(...a.tauR.map((t) => t / a.hr)) }, uBM: { value: new V3(...a.tauM.map((t) => t / a.hm)) },
        uR: { value: b.r }, uRa: { value: b.r * (1 + a.h) }, uHR: { value: a.hr }, uHM: { value: a.hm }, uG: { value: a.g }, uI: { value: a.I * SUN_I },
      },
    }));
    b.atm.scale.setScalar(b.r * (1 + a.h));
    b.atm.renderOrder = 1;
    b.group.add(b.atm);
  }
  if (def.rings) {
    const [r0, r1] = RING_R[def.rings];
    const geo = new THREE.RingGeometry(r0, r1, 384, 1).rotateX(-Math.PI / 2);
    const tex = ringTexture(def.rings);
    b.ring = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: S.RING_VERT, fragmentShader: S.RING_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uRingTex: { value: tex }, uRingR: { value: new THREE.Vector2(r0, r1) }, uSunPos: { value: new V3() }, uSunCol: { value: SUN_COL }, uSunI: { value: SUN_I }, uN: { value: b.P }, uPlanet: { value: new THREE.Vector4() } },
    }));
    b.ring.scale.setScalar(b.r);
    b.ring.renderOrder = 2;
    b.ring.quaternion.setFromRotationMatrix(b.eq);
    b.group.add(b.ring);
    b.mat.uniforms.uRingTex.value = tex;
    b.mat.uniforms.uRingR.value.set(r0, r1);
    b.mat.uniforms.uRingN.value = b.P;
  }
  bodies.push(b);
  byId[def.id] = b;
}
for (const b of bodies) {
  b.parent = byId[b.def.parent];
  b.occ = (OCCLUDERS[b.id] || []).map((id) => byId[id]);
}
const sun = byId.sun, earth = byId.earth, moon = byId.moon;

// ---------------------------------------------------------------- 轨道线（拖尾渐隐）
const orbitRes = new THREE.Vector2(1, 1), orbitWidth = { value: 1.2 };
function orbitLine(color, n, loop) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  geo.setAttribute('aTan', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(Float32Array.from({ length: n * 2 }, (_, i) => (i & 1 ? 1 : -1)), 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(Float32Array.from({ length: n * 2 }, (_, i) => (i >> 1) / (loop ? n : n - 1)), 1));
  const idx = [];
  for (let i = 0; i < (loop ? n : n - 1); i++) { const a = 2 * i, c = 2 * ((i + 1) % n); idx.push(a, a + 1, c, c, a + 1, c + 1); }
  geo.setIndex(idx);
  const line = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader: S.ORBIT_VERT, fragmentShader: S.ORBIT_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uPhase: { value: 0 }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0.5 }, uRes: { value: orbitRes }, uWidth: orbitWidth },
  }));
  // fn(i, out) 写入第 i 个点，可返回该点的轨道相位（非均匀采样时用于拖尾渐隐）
  const o = new V3(), tp = new V3(), tn = new V3();
  line.setPoints = (fn) => {
    const pos = geo.attributes.position.array, tan = geo.attributes.aTan.array, ph = geo.attributes.aPhase.array;
    for (let i = 0; i < n; i++) {
      const phase = fn(i, o);
      if (phase !== undefined) ph[2 * i] = ph[2 * i + 1] = phase;
      o.toArray(pos, 6 * i);
      o.toArray(pos, 6 * i + 3);
    }
    // 切线：前后两点之差（首尾在开放曲线上取单侧差分）
    for (let i = 0; i < n; i++) {
      const p = loop ? (i + n - 1) % n : Math.max(0, i - 1), q = loop ? (i + 1) % n : Math.min(n - 1, i + 1);
      tn.fromArray(pos, 6 * q).sub(tp.fromArray(pos, 6 * p)).normalize();
      tn.toArray(tan, 6 * i);
      tn.toArray(tan, 6 * i + 3);
    }
    geo.attributes.position.needsUpdate = geo.attributes.aTan.needsUpdate = geo.attributes.aPhase.needsUpdate = true;
  };
  line.frustumCulled = false;
  scene.add(line);
  return line;
}
for (const b of bodies) {
  if (b.def.el) b.orbit = orbitLine(b.def.color, 720, true);
  else if (b.def.kep) b.orbit = orbitLine(b.def.color, 1024, true);
  else if (b.def.sync) {
    const R = b.def.dist * b.parent.r;
    b.orbit = orbitLine(b.def.color, 256, true);
    b.orbit.setPoints((i, o) => { const w = (i / 256) * Math.PI * 2; o.set(-Math.cos(w) * R, 0, Math.sin(w) * R); });
    b.orbit.quaternion.setFromRotationMatrix(b.eq);
  } else if (b === moon) b.orbit = orbitLine(b.def.color, 200, false);
}
function fillPlanetOrbit(b, T) {
  const el = elements(b.def.el, T);
  b.orbit.setPoints((i, o) => { toScene(kepler(el.a, el.e, el.I, el.O, el.w, (i / 720) * Math.PI * 2, tmp), o); });
  b.orbitT = T;
}
// 彗发（面向相机的光斑，向阳侧有喷流）+ 离子尾（背向太阳的主尾与张开的射线，蓝）
// + 尘埃尾（沿轨道向后弯曲的光带，黄白）+ 尘埃粒子（铺在轨道面内、缓慢向外漂移）
const ION_RAYS = 6, DUST_N = 6000, cometPR = { value: 1 };
// 离子尾：主尾 + 若干射线合并为一个网格（aK = 0 为主尾，1..N 为射线），一次绘制
function ribbons(K, seg = 64) {
  const p = new THREE.PlaneGeometry(1, 1, 1, seg), n = p.attributes.position.count, g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3 * K), uv = new Float32Array(n * 2 * K), k = new Float32Array(n * K), idx = [];
  for (let j = 0; j < K; j++) {
    pos.set(p.attributes.position.array, j * n * 3);
    uv.set(p.attributes.uv.array, j * n * 2);
    k.fill(j, j * n, (j + 1) * n);
    for (const i of p.index.array) idx.push(i + j * n);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aK', new THREE.BufferAttribute(k, 1));
  g.setIndex(idx);
  return g;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST_N * 3), 3));
dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({ length: DUST_N * 4 }, Math.random), 4));
for (const b of bodies) if (b.def.kind === 'comet') {
  const add = (m) => { m.frustumCulled = false; return m; };
  const fx = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
  b.coma = add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    ...fx, vertexShader: S.CORONA_VERT, fragmentShader: S.COMA_FRAG,
    uniforms: { uSize: { value: 1 }, uLift: { value: b.r * 1.5 }, uI: { value: 0 }, uTime: { value: 0 }, uSunward: { value: new V3() } },
  })));
  b.group.add(b.coma);
  const shared = { uP0: { value: b.pos }, uAway: { value: new V3() }, uBack: { value: new V3() }, uVel: { value: new V3() }, uTime: { value: 0 } };
  b.tails = [[0.3, 0.55, 1], [1, 0.88, 0.7]].map((c, k) => {
    const m = add(new THREE.Mesh(k ? new THREE.PlaneGeometry(1, 1, 1, 64) : ribbons(1 + ION_RAYS), new THREE.ShaderMaterial({
      ...fx, side: THREE.DoubleSide, vertexShader: S.TAIL_VERT, fragmentShader: S.TAIL_FRAG, defines: k ? {} : { ION: 1 },
      uniforms: { ...shared, uLen: { value: 1 }, uCurve: { value: k ? 0.35 : 0 }, uW0: { value: k ? 0.012 : 0.006 }, uW1: { value: k ? 0.16 : 0.05 }, uColor: { value: new THREE.Color(...c) }, uI: { value: 0 } },
    })));
    scene.add(m);
    return m;
  });
  const du = b.tails[1].material.uniforms;
  b.dust = add(new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    ...fx, vertexShader: S.DUST_VERT, fragmentShader: S.DUST_FRAG,
    uniforms: { ...shared, uLen: du.uLen, uCurve: du.uCurve, uW1: du.uW1, uColor: du.uColor, uI: { value: 0 }, uPR: cometPR, uRes: { value: orbitRes } },
  })));
  scene.add(b.dust);
}
// 活跃度：随日距急剧下降（约 3 AU 以外几乎没有彗尾），并随彗核大小增强（海尔-波普的彗核直径约 60 km）
function cometActivity(b) {
  b.act = Math.min(5, Math.pow(1.5 / b.au.length(), 3) * Math.sqrt(b.def.km / 3));
  b.tailLen = 14 * Math.pow(b.act, 0.6);
}
// 活跃彗星的镜头：从侧面看整条彗尾；取这一侧使彗尾在画面中朝左延伸（右侧是信息卡）
function cometFrame(b) {
  const away = b.pos.clone().normalize(), side = new V3().crossVectors(UP, away).normalize();
  return { dir: side.addScaledVector(UP, 0.35).addScaledVector(away, -0.3).normalize(), dist: Math.max(b.r * 300, b.tailLen * 1.1) };
}
function updateComets(time) {
  for (const b of bodies) if (b.def.kind === 'comet') {
    const act = b.act, L = b.tailLen, on = act > 0.01;
    const [ion, dust] = b.tails.map((m) => m.material.uniforms);
    ion.uAway.value.copy(b.pos).normalize();
    ion.uBack.value.copy(b.vel).negate().addScaledVector(ion.uAway.value, b.vel.dot(ion.uAway.value)).normalize();
    ion.uVel.value.copy(b.vel);
    ion.uTime.value = time;
    ion.uLen.value = L;
    dust.uLen.value = L * 0.8;
    // 亮度随活跃度亚线性增长：中等活跃的彗星看得清，近日点附近也不会过曝成一片白
    const I = Math.sqrt(act);
    ion.uI.value = 0.4 * I;
    dust.uI.value = 0.5 * I;
    b.dust.material.uniforms.uI.value = 0.9 * I;
    b.tails.forEach((m) => (m.visible = on));
    b.dust.visible = on;
    const cu = b.coma.material.uniforms;
    cu.uSize.value = 0.15 + 0.8 * I;
    cu.uI.value = 0.08 + 0.4 * I;
    cu.uTime.value = time;
    cu.uSunward.value.copy(ion.uAway.value).negate();
  }
}
// 小天体（矮行星、彗星）轨道：按偏近点角均匀采样，高偏心率轨道在近日点附近才不会折线化
function kepElements(c) {
  const [q, e, i, O, w, tp] = c, a = q / (1 - e);
  return { a, e, I: i * DEG, O: O * DEG, w: w * DEG, n: (0.9856076686 / Math.pow(a, 1.5)) * DEG, tp: tp - 2451545 };
}
function fillKepOrbit(b) {
  const el = kepElements(b.def.kep);
  b.orbit.setPoints((i, o) => {
    const E = (i / 1024) * Math.PI * 2, M = E - el.e * Math.sin(E);
    toScene(kepler(el.a, el.e, el.I, el.O, el.w, M, tmp), o);
    return M / (Math.PI * 2);
  });
  b.orbitT = 0;
}

// ---------------------------------------------------------------- 小行星带（含木星特洛伊群）与柯伊伯带
const BELT_MAX = 30000;
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-9)) * Math.cos(2 * Math.PI * Math.random());
function makeBelt(max, orbitOf, tintA, tintB) {
  const base = new THREE.IcosahedronGeometry(1, 1), p = base.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = Math.sin(p.getX(i) * 12.9898 + p.getY(i) * 78.233 + p.getZ(i) * 37.719) * 43758.5453;
    tmp.fromBufferAttribute(p, i).multiplyScalar(0.72 + 0.5 * (k - Math.floor(k)));
    p.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  base.computeVertexNormals();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', p);
  geo.setAttribute('normal', base.attributes.normal);
  const orb = new Float32Array(max * 4), orb2 = new Float32Array(max * 4), axis = new Float32Array(max * 3), tone = new Float32Array(max);
  for (let i = 0; i < max; i++) {
    const node = Math.random() * Math.PI * 2, w = Math.random() * Math.PI * 2, [a, e, inc, M] = orbitOf(i, node, w);
    orb.set([a, e, inc, node], i * 4);
    orb2.set([w, M, 0.012 + 0.11 * Math.pow(Math.random(), 6), 1 + Math.floor(Math.random() * 6)], i * 4);
    tmp.randomDirection().toArray(axis, i * 3);
    tone[i] = Math.random();
  }
  geo.setAttribute('aOrb', new THREE.InstancedBufferAttribute(orb, 4));
  geo.setAttribute('aOrb2', new THREE.InstancedBufferAttribute(orb2, 4));
  geo.setAttribute('aAxis', new THREE.InstancedBufferAttribute(axis, 3));
  geo.setAttribute('aTone', new THREE.InstancedBufferAttribute(tone, 1));
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader: S.ROCK_VERT, fragmentShader: S.ROCK_FRAG,
    uniforms: { uDays: { value: 0 }, uDayFrac: { value: 0 }, uPx: { value: 0.001 }, uSunCol: { value: SUN_COL }, uSunI: { value: SUN_I }, uTintA: { value: new THREE.Color(...tintA) }, uTintB: { value: new THREE.Color(...tintB) } },
  }));
  // 按覆盖率做 alpha 混合：放大到最小像素尺寸的远处碎石不会在太阳辉光前形成黑点
  Object.assign(mesh.material, { transparent: true, depthWrite: false });
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
const LJ = 34.39644 * DEG;
const belt = makeBelt(BELT_MAX, (i, node, w) => {
  if (i % 11 === 0) return [5.2026, Math.abs(gauss()) * 0.05, Math.abs(gauss()) * 11 * DEG, LJ + (i % 22 === 0 ? 60 : -60) * DEG + gauss() * 13 * DEG - node - w]; // 特洛伊群：木星前后 60°
  let a;
  do a = 2.1 + Math.random() * 1.2; while ([2.5, 2.825, 2.955, 3.27].some((k) => Math.abs(a - k) < 0.025)); // 主带，避开柯克伍德空隙
  return [a, Math.min(0.3, Math.abs(gauss()) * 0.09), Math.abs(gauss()) * 7 * DEG, Math.random() * Math.PI * 2];
}, [0.05, 0.048, 0.045], [0.17, 0.13, 0.09]);
// 柯伊伯带：冥族小天体（与海王星 3:2 共振，39.4 AU）、经典冷带（42–48 AU）、离散盘
const kuiper = makeBelt(BELT_MAX / 2, (i) => {
  const r = Math.random(), M = Math.random() * Math.PI * 2;
  if (r < 0.3) return [39.4 + gauss() * 0.15, 0.1 + Math.random() * 0.2, Math.abs(gauss()) * 10 * DEG, M];
  if (r < 0.8) return [42 + Math.random() * 5.5, Math.abs(gauss()) * 0.04, Math.abs(gauss()) * 3 * DEG, M];
  return [30 + Math.random() * 45, 0.2 + Math.random() * 0.3, Math.abs(gauss()) * 18 * DEG, M];
}, [0.16, 0.1, 0.07], [0.14, 0.14, 0.15]);
belt.geometry.instanceCount = settings.asteroids;
kuiper.geometry.instanceCount = settings.asteroids / 2;

// ---------------------------------------------------------------- 星空：真实星表 + 程序化银河
const NGP = radec(192.85948 * DEG, 27.12825 * DEG), GC = radec(266.405 * DEG, -28.936 * DEG);
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
  vertexShader: S.SKY_VERT, fragmentShader: S.SKY_FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false,
  uniforms: { uSky: { value: null }, uGain: { value: 1 } },
}));
sky.renderOrder = -2;
sky.frustumCulled = false;
scene.add(sky);

let stars, starMags;
async function buildStars() {
  const raw = await inflate(__STARS__), dv = new DataView(raw.buffer), n = raw.length / 6;
  const list = Array.from({ length: n }, (_, i) => ({
    ra: (dv.getUint16(i * 6, true) / 65535) * Math.PI * 2, dec: (dv.getInt16(i * 6 + 2, true) / 32767) * Math.PI / 2,
    mag: dv.getUint8(i * 6 + 4) / 25 - 2, bv: dv.getInt8(i * 6 + 5) / 50,
  })).sort((a, b) => a.mag - b.mag);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), inten = new Float32Array(n);
  list.forEach((s, i) => {
    radec(s.ra, s.dec, tmp).toArray(pos, i * 3);
    // B−V 色指数 → 色温 → RGB（Ballesteros 公式 + 黑体近似）
    const t = 4600 * (1 / (0.92 * s.bv + 1.7) + 1 / (0.92 * s.bv + 0.62)) / 100;
    const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
    const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
    const c = [r, g, b].map((v) => Math.pow(Math.min(255, Math.max(0, v)) / 255, 2.2));
    const m = Math.max(...c);
    c.forEach((v, k) => (col[i * 3 + k] = 0.35 + 0.65 * v / m));
    inten[i] = Math.pow(10, -0.4 * (s.mag - 1) * 0.5);
  });
  starMags = list.map((s) => s.mag);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aI', new THREE.BufferAttribute(inten, 1));
  stars = new THREE.Points(geo, new THREE.ShaderMaterial({
    // 不标记 transparent：留在不透明队列里按 renderOrder 先于行星绘制，才会被行星遮挡
    vertexShader: S.STAR_VERT, fragmentShader: S.STAR_FRAG, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPR: { value: 1 }, uGain: { value: 1.1 } },
  }));
  stars.renderOrder = -1;
  stars.frustumCulled = false;
  scene.add(stars);
}
const starCount = (lim) => { let i = 0; while (i < starMags.length && starMags[i] <= lim) i++; return i; };

// 星座连线（默认关闭）：与恒星同在无穷远处、先于行星绘制；名称标在 d3-celestial 给出的位置
const CONST = __CONST__;
const constLines = (() => {
  const s = CONST.segs, pos = new Float32Array((s.length / 2) * 3);
  for (let i = 0; i < s.length / 2; i++) radec((((s[i * 2] % 360) + 360) % 360) * DEG, s[i * 2 + 1] * DEG, tmp).toArray(pos, i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.LineSegments(g, new THREE.ShaderMaterial({
    vertexShader: S.CONST_VERT, fragmentShader: S.CONST_FRAG, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0.07, 0.11, 0.2) } },
  }));
  m.renderOrder = -1;
  m.frustumCulled = false;
  scene.add(m);
  return m;
})();
const constNames = CONST.names.map(([zh, en, lon, lat]) => ({ zh, en, dir: radec((((lon % 360) + 360) % 360) * DEG, lat * DEG) }));

// ================================================================ GPU 程序化纹理生成
let landTex, milkyTex, texRTs = [];
// 真实贴图：色彩按 sRGB 解码为线性；高程、云量是数据而非颜色，保持原值
const realTex = {};
async function loadRealTextures() {
  await Promise.all(Object.entries(__TEX__).map(async ([name, b64]) => {
    const img = new Image();
    img.src = `data:image/webp;base64,${b64}`;
    await img.decode();
    const t = new THREE.Texture(img);
    Object.assign(t, {
      colorSpace: /height|clouds/.test(name) ? THREE.NoColorSpace : THREE.SRGBColorSpace,
      wrapS: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, needsUpdate: true,
    });
    realTex[name] = t;
  }));
}
let busy = false;
async function generateTextures() {
  busy = true;
  ui.progress(0, L('正在生成行星表面'));
  const base = settings.tex, jobs = [];
  for (const b of bodies) if (b.def.gen) {
    const [name, k, two] = b.def.gen, w = Math.max(512, base * k);
    jobs.push({ b, name, w, h: w / 2 });
    if (two) jobs.push({ b, name, w, h: w / 2, passB: true });
  }
  jobs.push({ name: 'SKY', w: Math.max(2048, base), h: Math.max(1024, base / 2) });
  const total = jobs.reduce((s, j) => s + j.w * j.h, 0);
  let done = 0;
  const old = texRTs;
  texRTs = [];
  const quad = new FullScreenQuad();
  for (const j of jobs) {
    const rt = new THREE.WebGLRenderTarget(j.w, j.h, {
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping,
      generateMipmaps: true, depthBuffer: false, anisotropy: maxAniso,
    });
    quad.material = new THREE.ShaderMaterial({
      vertexShader: S.FS_VERT, fragmentShader: S.GEN_FRAG, depthTest: false, depthWrite: false,
      defines: { [j.name]: 1, RELIEF: (j.b?.def.relief ?? 1).toFixed(3), ...(j.passB && { PASS_B: 1 }) },
      uniforms: {
        uMask: { value: j.name === 'SKY' ? milkyTex : landTex }, uNGP: { value: NGP }, uGC: { value: GC },
        uGrade: { value: new THREE.Vector2(...(j.b?.def.grade || [1, 1])) },
        uFeat: { value: j.b?.def.icy?.[0] ?? 0 }, uCol1: { value: new V3(...(j.b?.def.icy?.[1] || [0.5, 0.5, 0.5])) }, uCol2: { value: new V3(...(j.b?.def.icy?.[2] || [0.4, 0.4, 0.4])) },
        uCrat: { value: j.b?.def.icy?.[3] ?? 1 }, uSeed: { value: j.b?.def.icy?.[4] ?? 3 + bodies.indexOf(j.b) * 1.37 },
        ...Object.fromEntries(['uReal', 'uReal2', 'uReal3'].map((k, i) => [k, { value: realTex[j.b?.def.real?.[i]] || null }])),
      },
    });
    // 分条渲染：避免单次绘制过长触发 GPU 看门狗，同时让进度条动起来
    const rows = Math.max(8, Math.floor(1.2e6 / j.w));
    for (let y = 0; y < j.h; y += rows) {
      const hh = Math.min(rows, j.h - y);
      rt.scissor.set(0, y, j.w, hh);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      quad.render(renderer);
      done += j.w * hh;
      ui.progress(done / total);
      await frame();
    }
    rt.scissorTest = false;
    renderer.setRenderTarget(null);
    quad.material.dispose();
    texRTs.push(rt);
    if (j.name === 'SKY') sky.material.uniforms.uSky.value = rt.texture;
    else {
      const u = j.b.mat.uniforms;
      u[j.passB ? 'uMapB' : 'uMapA'].value = rt.texture;
      u.uTexel.value.set(1 / j.w, 1 / j.h);
    }
  }
  quad.dispose();
  old.forEach((rt) => rt.dispose());
  // 源贴图只在生成阶段使用，释放显存（图像仍在内存里，换画质时会自动重新上传）
  Object.values(realTex).forEach((t) => t.dispose());
  busy = false;
}

// ================================================================ 后期处理
const sunUV = new THREE.Vector2(0.5, 0.5);
class GodRaysPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    const opt = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opt);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opt);
    this.pre = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: S.FS_VERT, fragmentShader: S.RAY_PRE, uniforms: { tDiffuse: { value: null }, uSun: { value: sunUV }, uAspect: { value: 1 } } }));
    this.blur = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: S.FS_VERT, fragmentShader: S.RAY_BLUR, defines: { SAMPLES: settings.raySamples }, uniforms: { tDiffuse: { value: null }, uSun: { value: sunUV }, uDensity: { value: 1 }, uDecay: { value: 0.96 } } }));
  }
  setSize(w, h) {
    this.rtA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.rtB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.pre.material.uniforms.uAspect.value = w / h;
  }
  setSamples(n) { this.blur.material.defines.SAMPLES = n; this.blur.material.needsUpdate = true; }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.blur.material.uniforms, n = this.blur.material.defines.SAMPLES;
    this.pre.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.rtA);
    this.pre.render(renderer);
    // 两级径向模糊：长光束 + 短距离平滑
    [[this.rtA, this.rtB, 0.97, 0.12], [this.rtB, this.rtA, 0.3, 0.5]].forEach(([src, dst, dens, end]) => {
      u.tDiffuse.value = src.texture; u.uDensity.value = dens; u.uDecay.value = Math.pow(end, 1 / n);
      renderer.setRenderTarget(dst);
      this.blur.render(renderer);
    });
  }
}
const raysPass = new GodRaysPass();
const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.25, 1.15);
// 泛光最后一步原本把结果加法混合回输入缓冲——那是全分辨率 4×MSAA 半浮点缓冲，混合一次要整块读写并重新解析（约 5 ms / 帧）。
// 跳过这一步，改由合成通道采样泛光纹理相加（rgb·a，与原先 SRC_ALPHA/ONE 的加法混合等价）
const bloomQuad = bloomPass.fsQuad, drawBloom = bloomQuad.render.bind(bloomQuad);
bloomQuad.render = (r) => bloomQuad.material !== bloomPass.blendMaterial && drawBloom(r);
const finalPass = new ShaderPass(new THREE.ShaderMaterial({
  vertexShader: S.FS_VERT, fragmentShader: S.FINAL_FRAG,
  uniforms: {
    tDiffuse: { value: null }, tRays: { value: raysPass.rtA.texture }, tBloom: { value: bloomPass.renderTargetsHorizontal[0].texture }, uBloom: { value: 1 }, uSun: { value: sunUV }, uRes: { value: new THREE.Vector2() },
    uAspect: { value: 1 }, uSunVis: { value: 0 }, uFlare: { value: 1 }, uRays: { value: 1 }, uExposure: { value: 1 },
    uTime: { value: 0 }, uGrain: { value: 0.03 }, uVig: { value: 0.35 }, uCA: { value: 0.012 },
    uOccl: { value: [0, 1, 2, 3].map(() => new V3()) },
  },
}));
let composer;
function buildComposer() {
  if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
  // 后续通道只读颜色，不需要解析多重采样深度（省掉一次全分辨率深度 blit）
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(settings.msaa, maxSamples), resolveDepthBuffer: false });
  composer = new EffectComposer(renderer, rt);
  [new RenderPass(scene, camera), raysPass, bloomPass, finalPass].forEach((p) => composer.addPass(p));
  resize();
}
function resize() {
  const pr = Math.min(devicePixelRatio, settings.pr) * settings.scale;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  composer.setPixelRatio(pr);
  composer.setSize(innerWidth, innerHeight);
  finalPass.uniforms.uAspect.value = camera.aspect;
  finalPass.uniforms.uRes.value.set(innerWidth * pr, innerHeight * pr);
  belt.material.uniforms.uPx.value = kuiper.material.uniforms.uPx.value = (2 * Math.tan((camera.fov * DEG) / 2)) / (innerHeight * pr);
  if (stars) stars.material.uniforms.uPR.value = pr;
  cometPR.value = pr;
  orbitRes.set(innerWidth * pr, innerHeight * pr);
  orbitWidth.value = 1.1 * Math.max(1, pr);
}

// ================================================================ 模拟
const RATES = [[1, '实时'], [60, '1 分钟/秒'], [600, '10 分钟/秒'], [3600, '1 小时/秒'], [21600, '6 小时/秒'], [86400, '1 天/秒'], [604800, '1 周/秒'], [2629800, '1 月/秒'], [7889400, '3 月/秒'], [31557600, '1 年/秒']];
const T_MIN = Date.UTC(1000, 0, 1), T_MAX = Date.UTC(2999, 11, 31);
const sim = { t: Date.now(), ri: 4, paused: false, rev: false };
const daysOf = (t) => t / 864e5 + 2440587.5 - 2451545;

// 高倍速时自转（及同步卫星、月球的绕转）每帧转过的角度过大会产生频闪。
// 每个天体维护一个视觉时间 tv：正常速度下与真实时间一致；超速时以上限角速度匀速前进；
// 降速后跳过整圈并在半圈内追上真实相位。
const SPIN_CAP = Math.PI; // 弧度/秒，即每秒最多半圈
function visualDays(b, d, step, dt, jump) {
  // 卫星由 W 驱动公转：再限制为每秒最多移动 12 个自身半径，否则内侧小卫星每帧跳过好几个直径，看起来是一闪一闪的白点
  const cap = b.parent ? Math.min(SPIN_CAP, (12 * b.r) / (b.def.dist * b.parent.r)) : SPIN_CAP;
  const w = Math.abs(b.def.W[1]) * DEG, max = (cap / w) * dt;
  if (jump || b.tv === undefined) return (b.tv = d);
  if (Math.abs(step) > max) return (b.tv += Math.sign(step) * max);
  let diff = d - b.tv;
  const P = (2 * Math.PI) / w;
  diff -= Math.round(diff / P) * P;
  b.tv = d - diff + Math.max(-max, Math.min(max, diff));
  return b.tv;
}
function tritonPole(b, T) {
  const N = (359.28 + 54.308 * T) * DEG;
  const ra = (299.36 - 32.35 * Math.sin(N) - 6.28 * Math.sin(2 * N) - 2.08 * Math.sin(3 * N)) * DEG;
  const dec = (41.17 + 22.55 * Math.cos(N) + 2.1 * Math.cos(2 * N) + 0.55 * Math.cos(3 * N)) * DEG;
  radec(ra, dec, b.P);
  radec(ra + Math.PI / 2, 0, b.N);
  b.PN.crossVectors(b.P, b.N);
  b.eq.makeBasis(b.N, b.P, tmp.crossVectors(b.N, b.P));
  b.orbit.quaternion.setFromRotationMatrix(b.eq);
  return 22.25 * Math.sin(N) + 6.73 * Math.sin(2 * N) + 2.05 * Math.sin(3 * N);
}
function updateBodies(d, step = 0, dt = 0, jump = true) {
  const T = d / 36525;
  for (const b of bodies) {
    const wx = b.def.triton ? tritonPole(b, T) : 0;
    // 自转：本初子午线方向 M = N·cosW + (P×N)·sinW
    const W = ((b.def.W[0] + wx + b.def.W[1] * visualDays(b, d, step, dt, jump)) % 360) * DEG;
    b.M.copy(b.N).multiplyScalar(Math.cos(W)).addScaledVector(b.PN, Math.sin(W));
    b.rot.makeBasis(b.M, b.P, tmp.crossVectors(b.M, b.P));
    if (b.def.el) {
      const el = elements(b.def.el, T);
      kepler(el.a, el.e, el.I, el.O, el.w, el.M, b.au);
      toScene(b.au, b.pos);
      b.phase = el.M / (Math.PI * 2);
      b.a = el.a;
      if (b.orbitT === undefined || Math.abs(T - b.orbitT) > 0.05) fillPlanetOrbit(b, T);
    } else if (b.def.kep) {
      const el = kepElements(b.def.kep), M = el.n * (d - el.tp);
      kepler(el.a, el.e, el.I, el.O, el.w, M, b.au);
      toScene(b.au, b.pos);
      b.phase = (((M / (Math.PI * 2)) % 1) + 1) % 1;
      b.a = el.a;
      // 速度方向（数值差分），用于尘埃尾的弯曲
      b.vel = (b.vel || new V3()).subVectors(kepler(el.a, el.e, el.I, el.O, el.w, M + el.n * 0.5, tmp), b.au).normalize();
      if (b.def.kind === 'comet') cometActivity(b);
      if (b.orbitT === undefined) fillKepOrbit(b);
    }
  }
  const km = moonGeo(moon.tv, tmp);
  moon.km = km;
  moon.au.copy(earth.au).addScaledVector(tmp, km / AU_KM);
  moon.pos.copy(earth.pos).addScaledVector(tmp, moon.def.dist * earth.r);
  for (const b of bodies) if (b.def.sync) {
    b.pos.copy(b.parent.pos).addScaledVector(b.M, -b.def.dist * b.parent.r);
    b.au.copy(b.parent.au);
    b.phase = (((b.def.W[0] + b.def.W[1] * b.tv) % 360) + 360) % 360 / 360;
  }
  for (const b of bodies) {
    b.group.position.copy(b.pos);
    b.mesh.quaternion.setFromRotationMatrix(b.rot);
  }
}

// 真实日心位置（km）。日食阴影在真实尺度下计算，否则放大的天体会让日月食每月都发生
function realKm(b, o) {
  o.copy(b.parent ? b.parent.au : b.au).multiplyScalar(AU_KM);
  if (b.def.sync) o.addScaledVector(b.M, -b.def.a);
  else if (b === moon) o.copy(b.au).multiplyScalar(AU_KM);
  return o;
}
const kmA = new V3(), kmB = new V3();
function updateUniforms(d, time) {
  for (const b of bodies) {
    const u = b.mat.uniforms;
    if (b === sun) { u.uTime.value = time; b.corona.material.uniforms.uTime.value = time; continue; }
    u.uRot.value.setFromMatrix4(b.rot);
    u.uCenter.value.copy(b.pos);
    u.uRadius.value = b.r;
    realKm(b, kmA);
    u.uSunRel.value.copy(kmA).negate().divideScalar(b.def.km);
    u.uSunRn.value = sun.def.km / b.def.km;
    u.uOccN.value = b.occ.length;
    b.occ.forEach((o, i) => {
      realKm(o, kmB).sub(kmA).divideScalar(b.def.km);
      u.uOcc.value[i].set(kmB.x, kmB.y, kmB.z, o.def.km / b.def.km);
      u.uOccAtm.value[i] = o === earth ? 1 : 0;
    });
    if (b.ring) b.ring.material.uniforms.uPlanet.value.set(b.pos.x, b.pos.y, b.pos.z, b.r);
    if (b.atm) b.atm.material.side = camera.position.distanceTo(b.pos) < b.r * (1 + b.def.atm.h) ? THREE.BackSide : THREE.FrontSide;
  }
  earth.mat.uniforms.uCloudShift.value = (d * 0.011) % 1;
  // 地照：从月球看到的地球被照亮的比例
  const lit = 0.5 * (1 + tmp.copy(earth.pos).negate().normalize().dot(tmp2.subVectors(moon.pos, earth.pos).normalize()));
  moon.mat.uniforms.uShinePos.value.copy(earth.pos);
  moon.mat.uniforms.uShineCol.value.setRGB(0.3, 0.42, 0.62).multiplyScalar(0.035 * lit * SUN_I);
  for (const m of [belt, kuiper]) {
    m.material.uniforms.uDays.value = d;
    m.material.uniforms.uDayFrac.value = d - Math.floor(d);
    m.visible = settings.belt;
  }
  // 轨道线
  for (const b of bodies) if (b.orbit) {
    const near = !b.parent || camera.position.distanceTo(b.parent.pos) < b.parent.r * (b.parent === earth ? 70 : 45);
    b.orbit.visible = settings.orbits && near;
    // 漫游时淡化轨道线，让画面更干净
    b.orbit.material.uniforms.uAlpha.value = (nav.focus === b ? 0.9 : b.parent ? 0.35 : 0.45) * (nav.tour ? 0.4 : 1);
    b.orbit.material.uniforms.uPhase.value = b.phase;
    if (b.def.sync) b.orbit.position.copy(b.parent.pos);
  }
  if (moon.orbit.visible) {
    moon.orbit.setPoints((i, o) => { moonGeo(moon.tv - 27.32 * (1 - i / 199), o); o.multiplyScalar(moon.def.dist * earth.r); });
    moon.orbit.position.copy(earth.pos);
    moon.orbit.material.uniforms.uPhase.value = 0.9999;
  }
}

// ================================================================ 太阳可见度（镜头光晕 / 体积光 / 自动曝光）
const camDir = new V3(), camRight = new V3(), camUp = new V3(), sunNdc = new V3();
const oDir = new V3(), oRel = new V3();
function occluded(from, to, skip) {
  const len = oDir.subVectors(to, from).length();
  oDir.divideScalar(len);
  for (const b of bodies) {
    if (b === skip) continue;
    const t = oRel.subVectors(b.pos, from).dot(oDir);
    if (t > 0 && t < len && oRel.addScaledVector(oDir, -t).lengthSq() < b.r * b.r) return true;
  }
  return false;
}
let sunVis = 0, exposure = 1, sunClose = 0;
function updateSunFx(dt) {
  camera.getWorldDirection(camDir);
  camRight.setFromMatrixColumn(camera.matrixWorld, 0);
  camUp.setFromMatrixColumn(camera.matrixWorld, 1);
  const p = sunNdc.set(0, 0, 0).project(camera);
  sunUV.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
  const dist = camera.position.length();
  const frac = SUN_R / dist / Math.tan((camera.fov * DEG) / 2);
  let vis = 0, onScreen = 0;
  if (camDir.dot(tmp2.copy(camera.position).negate()) > 0) {
    const pt = new V3();
    for (let k = 0; k < 19; k++) {
      const a = (k / 12) * Math.PI * 2 + (k >= 12 ? 0.3 : 0), r = k === 18 ? 0 : SUN_R * (k < 12 ? 0.85 : 0.45);
      pt.copy(camRight).multiplyScalar(Math.cos(a) * r).addScaledVector(camUp, Math.sin(a) * r);
      if (!occluded(camera.position, pt, sun)) vis += 1 / 19;
    }
    onScreen = vis * (1 - smooth(1, 1 + 2 * frac, Math.max(Math.abs(p.x), Math.abs(p.y))));
    vis *= 1 - smooth(0.95, 1.3, Math.max(Math.abs(p.x), Math.abs(p.y)));
  }
  sunVis += (vis - sunVis) * Math.min(1, dt * 7);
  const u = finalPass.uniforms;
  // 体积光遮挡圆盘：取屏幕上最大的 4 个位于太阳前方的天体
  const th = Math.tan((camera.fov * DEG) / 2), occ = [];
  for (const b of bodies) {
    if (b === sun) continue;
    const d = camera.position.distanceTo(b.pos);
    if (d > dist || camDir.dot(tmp.subVectors(b.pos, camera.position)) <= 0) continue;
    const q = tmp.copy(b.pos).project(camera);
    occ.push([q.x * 0.5 + 0.5, q.y * 0.5 + 0.5, (b.r / (d * th)) * 0.5]);
  }
  occ.sort((a, b) => b[2] - a[2]);
  u.uOccl.value.forEach((v, i) => (occ[i] ? v.set(...occ[i]) : v.set(0, 0, 0)));
  u.uSunVis.value = sunVis * (1 - smooth(0.2, 0.6, frac)) * smooth(0.004, 0.02, frac);
  // 太阳在镜头后方时投影点会镜像到画面内，必须关掉；离画面较远时贡献也可忽略，整个跳过以省下三次全屏渲染
  const inFront = camDir.dot(tmp2.copy(camera.position).negate()) > 0;
  const nearView = inFront ? 1 - smooth(1.2, 2.2, Math.max(Math.abs(p.x), Math.abs(p.y))) : 0;
  u.uRays.value = settings.rays ? 0.9 * (1 - smooth(0.25, 0.8, frac)) * nearView : 0;
  raysPass.enabled = u.uRays.value > 0.002;
  // 靠近太阳时像真实相机一样压低曝光，才能看清米粒组织与黑子
  const close = smooth(0.1, 0.4, frac) * onScreen;
  sunClose = close;
  const target = 1 - 0.95 * close;
  bloomPass.strength = 0.6 * (1 - 0.55 * close);
  exposure += (target - exposure) * Math.min(1, dt * 2.5);
  u.uExposure.value = exposure * settings.exposure;
}

// ================================================================ 相机：跟随、飞行、漫游
const nav = { focus: null, flight: null, tour: null, overview: false };
// 全景：镜头仍以太阳为中心，但界面上不选中任何天体，信息卡显示整个太阳系
const system = { id: 'system', def: SYSTEM };
function focusOn(id, opt = {}) {
  const b = byId[id];
  if (b.def.kind === 'comet' && b.act > 0.05 && !opt.dir && !opt.dist) opt = { ...cometFrame(b), ...opt };
  // 竖屏时水平视角很窄，按宽高比拉远，保证天体完整入镜
  const dist = (opt.dist || (b === sun ? 52 : b.r * (b.def.view || 4.4))) * Math.max(1, 0.95 / camera.aspect);
  const toSun = b === sun ? new V3(0.35, 0.3, 1).normalize() : tmp.copy(b.pos).negate().normalize().clone();
  // opt.geo = [纬度, 经度]：镜头正对天体表面该点（如日食的食甚点）
  // geoTilt：绕竖直轴偏开若干度，避免月球这类前景天体挡住镜头
  const geoDir = opt.geo && new V3(Math.cos(opt.geo[1] * DEG) * Math.cos(opt.geo[0] * DEG), Math.sin(opt.geo[0] * DEG), -Math.sin(opt.geo[1] * DEG) * Math.cos(opt.geo[0] * DEG)).applyMatrix4(b.rot).applyAxisAngle(UP, (opt.geoTilt || 0) * DEG);
  const dir = opt.dir || geoDir || toSun.applyAxisAngle(UP, opt.angle ?? 0.95).addScaledVector(UP, 0.3).normalize();
  const from = camera.position.clone();
  const dur = opt.dur || Math.min(5.5, 2 + from.distanceTo(b.pos) / 160);
  const off = dir.multiplyScalar(dist);
  nav.flight = { b, from, fromT: controls.target.clone(), off, t: 0, dur, lift: flightLift(from, tmp.copy(b.pos).add(off), b) };
  nav.focus = b;
  nav.overview = !!opt.overview;
  controls.enabled = false;
  controls.autoRotate = false;
  const card = nav.overview ? system : b;
  ui.onFocus(card);
  player.mood(card.id);
  if (from.distanceTo(b.pos) > dist * 3) player.whoosh(dur);
}
// 飞行路径 P(e) = lerp(起点, 终点, e) + lift·sin(πe)。默认向上抬起一段弧；若途中离某个天体太近，
// 就沿垂直于路径的方向把 lift 推离它，避免镜头贴着卫星掠过（大圆盘在一两帧内扫过画面，形同闪屏）
const fp = new V3(), fq = new V3();
function flightLift(a, b, target) {
  const lift = new V3().copy(UP).multiplyScalar(a.distanceTo(b) * 0.16);
  for (let it = 0; it < 6; it++) {
    let worst = null, depth = 0;
    for (const o of bodies) {
      if (o === target || o === nav.focus) continue;
      const clear = o.r * 4 + 0.5;
      for (let k = 1; k < 24; k++) {
        const e = k / 24;
        fp.lerpVectors(a, b, e).addScaledVector(lift, Math.sin(Math.PI * e));
        const d = fp.distanceTo(o.pos);
        if (clear - d > depth) { depth = clear - d; worst = { o, p: fp.clone(), s: Math.sin(Math.PI * e) }; }
      }
    }
    if (!worst) break;
    const away = fq.subVectors(worst.p, worst.o.pos), axis = tmp2.subVectors(b, a).normalize();
    away.addScaledVector(axis, -away.dot(axis));
    if (away.lengthSq() < 1e-6) away.copy(UP);
    lift.addScaledVector(away.normalize(), (depth + 0.5) / Math.max(worst.s, 0.2));
  }
  return lift;
}
function updateCamera(dt) {
  const f = nav.flight;
  if (f) {
    f.t = Math.min(1, f.t + dt / f.dur);
    const e = ease(f.t), end = tmp.copy(f.b.pos).add(f.off);
    camera.position.lerpVectors(f.from, end, e).addScaledVector(f.lift, Math.sin(Math.PI * e));
    controls.target.lerpVectors(f.fromT, f.b.pos, ease(Math.min(1, f.t * 1.35)));
    camera.lookAt(controls.target);
    if (f.t >= 1) {
      nav.flight = null;
      controls.enabled = true;
      controls.minDistance = f.b.r * (f.b === sun ? 1.4 : 1.12);
      controls.update();
    }
    return;
  }
  if (nav.focus) {
    const delta = tmp.subVectors(nav.focus.pos, controls.target);
    camera.position.add(delta);
    controls.target.copy(nav.focus.pos);
  }
  const tour = nav.tour;
  if (tour) {
    // 镜头运动：绕竖直轴缓慢环绕，并按比例推近 / 拉远
    const m = tour.motion, off = tmp.subVectors(camera.position, controls.target);
    off.applyAxisAngle(UP, m.orbit * DEG * dt).multiplyScalar(Math.pow(m.push || 1, dt));
    camera.position.copy(controls.target).add(off);
    if (!tour.paused && (tour.t += dt) > TOUR_STOP) nextStop(1);
  }
  controls.update(dt);
}

// ================================================================ 自动漫游：电影化镜头序列
const TOUR_STOP = 15;
// 当前最活跃的彗星（都远离太阳时返回空，跳过这一站）
function activeComet() {
  let best = null;
  for (const b of bodies) if (b.def.kind === 'comet' && b.act > 0.05 && (!best || b.act > best.act)) best = b;
  return best;
}
function shot(id, kind) {
  const b = id === 'comet' ? activeComet() : id === 'overview' ? sun : byId[id];
  if (!b) return null;
  const toSun = b === sun ? new V3(0.35, 0.3, 1).normalize() : b.pos.clone().negate().normalize();
  const around = (deg, elev) => toSun.clone().applyAxisAngle(UP, deg * DEG).addScaledVector(UP, elev).normalize();
  const base = b === sun ? 52 : b.r * (b.def.view || 4.4);
  switch (kind) {
    case 'push': return { b, dir: around(40, 0.2), dist: base * 1.7, motion: { orbit: 1.5, push: 0.96 } };
    case 'crescent': return { b, dir: around(118, 0.22), dist: base * 1.05, motion: { orbit: 1.6 } };
    case 'backlit': return { b, dir: around(148, 0.42), dist: base * 1.3, motion: { orbit: 1.1 } };
    case 'flyby': return { b, dir: around(38, 0.08), dist: b.r * 2.3, motion: { orbit: 4.5 } };
    case 'system': return { b, dir: around(42, 0.5), dist: base * 2.8, motion: { orbit: 1.8 } };
    case 'heart': { // 冥王星：心形的汤博区被照亮时对准它（取心形区与太阳方向之间），否则拍冥王星与冥卫一的全景
      const g = new V3(Math.cos(176 * DEG) * Math.cos(22 * DEG), Math.sin(22 * DEG), -Math.sin(176 * DEG) * Math.cos(22 * DEG)).applyMatrix4(b.rot);
      if (g.dot(toSun) > -0.15) return { b, dir: g.add(toSun).normalize(), dist: base * 1.3, motion: { orbit: 0.8 } };
      return { b, dir: around(42, 0.5), dist: base * 2.8, motion: { orbit: 1.8 } };
    }
    case 'moonParent': { // 卫星在前景，母星在背景
      const out = b.pos.clone().sub(b.parent.pos).normalize();
      return { b, dir: out.applyAxisAngle(UP, 26 * DEG).addScaledVector(UP, 0.12).normalize(), dist: b.r * 5.5, motion: { orbit: 1.1 } };
    }
    case 'comet': return { b, ...cometFrame(b), motion: { orbit: 1 } };
    case 'overview': return { b: sun, dir: new V3(-0.25, 0.55, 1).normalize(), dist: 760, motion: { orbit: 1.2 } };
    default: return { b, dir: around(55, 0.3), dist: base, motion: { orbit: 3 } };
  }
}
function nextStop(step) {
  const t = nav.tour;
  for (let k = 0; k < TOUR.length; k++) {
    t.i = (t.i + step + TOUR.length) % TOUR.length;
    const [id, kind, fact] = TOUR[t.i], p = shot(id, kind);
    if (!p) continue;
    const dur = Math.min(5.5, 2.4 + camera.position.distanceTo(p.b.pos) / 160);
    focusOn(p.b.id, { dir: p.dir, dist: p.dist, dur, overview: id === 'overview' });
    Object.assign(t, { t: 0, motion: p.motion });
    ui.onStop({ index: t.i, total: TOUR.length, body: p.b, overview: id === 'overview', id, fact, delay: dur });
    return;
  }
}
function toggleTour(on = !nav.tour) {
  if (on === !!nav.tour) return;
  if (on) {
    nav.tour = { i: -1, t: 0, paused: false, prevRi: sim.ri, motion: { orbit: 0 } };
    sim.ri = 3; // 1 小时/秒：自转与卫星运动清晰可见
    ui.syncTime();
    nextStop(1);
  } else {
    sim.ri = nav.tour.prevRi;
    nav.tour = null;
    ui.syncTime();
  }
  controls.autoRotate = false;
  ui.onTour(on);
}
// 用户主动选择天体时退出漫游
function pick(id, opt) {
  if (nav.tour) toggleTour(false);
  focusOn(id, opt);
}

// ---------------------------------------------------------------- 拾取
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; if (nav.tour) toggleTour(false); });
canvas.addEventListener('wheel', () => nav.tour && toggleTour(false), { passive: true });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const px = (2 * Math.tan((camera.fov * DEG) / 2)) / innerHeight;
  let best = null, bt = Infinity;
  for (const b of bodies) {
    if (b.labelHidden && b.parent) continue;
    const R = Math.max(b.r, 14 * px * camera.position.distanceTo(b.pos));
    const hit = raycaster.ray.intersectSphere(new THREE.Sphere(b.pos, R), tmp);
    const t = hit ? hit.distanceTo(camera.position) : Infinity;
    if (t < bt) { bt = t; best = b; }
  }
  if (best && ui.pickTarget(best)) return;
  if (best && (best !== nav.focus || nav.overview)) pick(best.id);
});

// ================================================================ 界面
const labelsEl = $('labels');
// 选中天体：距离工具在等待目标时交给它，否则飞过去
const choose = (b) => ui.pickTarget(b) || pick(b.id);
for (const b of bodies) {
  b.label = document.createElement('div');
  b.label.className = 'label' + (b.parent ? ' moon' : '');
  b.label.innerHTML = `<i style="background:${b.def.color}"></i>${nameOf(b)}`;
  b.label.onclick = () => choose(b);
  labelsEl.append(b.label);
}
for (const c of constNames) {
  c.el = document.createElement('div');
  c.el.className = 'cname';
  labelsEl.append(c.el);
}
const nameConsts = () => constNames.forEach((c) => (c.el.textContent = isEn() ? c.en : c.zh));
nameConsts();
onLang(nameConsts);
function updateConstellations() {
  const on = settings.constellations;
  constLines.visible = on;
  for (const c of constNames) {
    let show = on;
    if (show) {
      const p = tmp.copy(camera.position).addScaledVector(c.dir, 1e4).project(camera);
      show = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      if (show) c.el.style.transform = `translate(${((p.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px,${((-p.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%,-50%)`;
    }
    if (c.shown !== show) c.el.classList.toggle('on', (c.shown = show));
  }
}

// 距离工具：两天体之间的虚线与中点标签；距离按真实位置计算（realKm），不受画面压缩影响
const distLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3()]), new THREE.LineDashedMaterial({ color: 0xffd9a0, dashSize: 1, gapSize: 1, transparent: true, opacity: 0.9, depthWrite: false }));
distLine.frustumCulled = false;
distLine.visible = false;
scene.add(distLine);
const distTag = document.createElement('div');
distTag.className = 'dtag';
labelsEl.append(distTag);
function measure(a, b) {
  const km = realKm(a, kmA).distanceTo(realKm(b, kmB)), au = km / AU_KM;
  return { km, au, rows: [[L('距离'), `${au.toFixed(au >= 0.1 ? 3 : 5)} AU`], ['', fmtKm(km)], [L('光行时间'), fmtLight(km / C_KMS)]] };
}
function updateDistance() {
  const pair = ui.distPair();
  distLine.visible = !!pair;
  distTag.classList.toggle('on', !!pair);
  if (!pair) return;
  const [a, b] = pair, p = distLine.geometry.attributes.position;
  p.setXYZ(0, a.pos.x, a.pos.y, a.pos.z);
  p.setXYZ(1, b.pos.x, b.pos.y, b.pos.z);
  p.needsUpdate = true;
  distLine.computeLineDistances();
  const len = a.pos.distanceTo(b.pos);
  distLine.material.dashSize = len / 70;
  distLine.material.gapSize = len / 110;
  const m = tmp.addVectors(a.pos, b.pos).multiplyScalar(0.5).project(camera), { au, km } = measure(a, b);
  const txt = au >= 0.01 ? `${au.toFixed(au >= 10 ? 1 : 2)} AU` : fmtKm(km);
  if (distTag.textContent !== txt) distTag.textContent = txt;
  distTag.style.visibility = m.z < 1 ? '' : 'hidden';
  distTag.style.transform = `translate(${((m.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px,${((-m.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px) translate(-50%,-50%)`;
}
function updateLabels() {
  const w = innerWidth, h = innerHeight, th = Math.tan((camera.fov * DEG) / 2), placed = [];
  const order = [...bodies].sort((a, b) => (b === nav.focus) - (a === nav.focus) || (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || b.r - a.r);
  for (const b of order) {
    const d = camera.position.distanceTo(b.pos);
    const p = tmp.copy(b.pos).project(camera);
    const pxR = (b.r / (d * th)) * (h / 2);
    let show = settings.labels && p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    if (show && b.parent) show = camera.position.distanceTo(b.parent.pos) < b.parent.r * (b.parent === earth ? 70 : 45);
    if (show && b === nav.focus && pxR > 70) show = false;
    if (show && occluded(camera.position, b.pos, b)) show = false;
    const x = (p.x * 0.5 + 0.5) * w, y = (-p.y * 0.5 + 0.5) * h + Math.max(pxR, 2) + 8;
    const lw = nameOf(b).length * (isEn() ? 7.5 : 13) + 22;
    if (show && placed.some((r) => Math.abs(r[0] - x) < (r[2] + lw) / 2 && Math.abs(r[1] - y) < 18)) show = false;
    if (show) { placed.push([x, y, lw]); b.label.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,0)`; }
    b.label.classList.toggle('on', show);
    b.labelHidden = !show;
  }
}

// 实时数据（信息卡）
const fmtKm = (km) => (isEn()
  ? km >= 1e9 ? `${(km / 1e9).toFixed(2)} billion km` : km >= 1e6 ? `${(km / 1e6).toFixed(1)} million km` : `${Math.round(km).toLocaleString('en-US')} km`
  : km >= 1e8 ? `${(km / 1e8).toFixed(2)} 亿 km` : `${Math.round(km).toLocaleString('zh-CN')} km`);
const fmtLight = (s) => {
  const [S, M, H] = isEn() ? ['s', 'min', 'h'] : ['秒', '分', '时'];
  return s < 60 ? `${s.toFixed(1)} ${S}` : s < 3600 ? `${Math.floor(s / 60)} ${M} ${Math.round(s % 60)} ${S}` : `${Math.floor(s / 3600)} ${H} ${Math.round((s % 3600) / 60)} ${M}`;
};
function liveRows(b) {
  if (b === system) return bodies.filter((o) => o.def.kind === 'planet').map((o) => [L('{0}距太阳', nameOf(o)), `${o.au.length().toFixed(3)} AU`]);
  const rows = [], rSun = b.au.length();
  if (b !== sun) rows.push([L('距太阳'), `${rSun.toFixed(3)} AU`], ['', fmtKm(rSun * AU_KM)]);
  if (b === moon) rows.push([L('距地球'), fmtKm(moon.km)], [L('光行时间'), fmtLight(moon.km / C_KMS)]);
  else if (b !== earth) {
    const de = tmp.subVectors(b.au, earth.au).length();
    rows.push([L('距地球'), `${de.toFixed(3)} AU`], [L('光行时间'), fmtLight((de * AU_KM) / C_KMS)]);
  }
  if (b.a) rows.push([L('轨道速度'), `${(29.7847 * Math.sqrt(2 / rSun - 1 / b.a)).toFixed(2)} km/s`]);
  return rows;
}
// 彗星下次过近日点的时刻（毫秒）
function nextPerihelion(b) {
  const el = kepElements(b.def.kep), P = (2 * Math.PI) / el.n, d = daysOf(sim.t);
  const k = Math.ceil((d - el.tp) / P + 1e-6);
  return (el.tp + k * P + 2451545 - 2440587.5) * 864e5;
}

// ---------------------------------------------------------------- 画质设置
function applySettings(prev) {
  const ch = (k) => prev[k] !== settings[k];
  if (ch('seg')) {
    const old = sphere;
    sphere = new THREE.SphereGeometry(1, settings.seg, settings.seg / 2);
    for (const b of bodies) { b.mesh.geometry = sphere; if (b.atm) b.atm.geometry = sphere; }
    old.dispose();
  }
  if (ch('atmo')) for (const b of bodies) if (b.atm) { b.atm.material.defines.STEPS = settings.atmo; b.atm.material.needsUpdate = true; }
  if (ch('detail')) for (const b of bodies) if (b.def.shade === 'ROCK') {
    if (settings.detail) b.mat.defines.DETAIL = 1; else delete b.mat.defines.DETAIL;
    b.mat.needsUpdate = true;
  }
  if (ch('raySamples')) raysPass.setSamples(settings.raySamples);
  if (ch('stars')) stars.geometry.setDrawRange(0, starCount(settings.stars));
  if (ch('asteroids')) { belt.geometry.instanceCount = settings.asteroids; kuiper.geometry.instanceCount = settings.asteroids / 2; }
  if (ch('msaa')) buildComposer();
  else if (ch('scale') || ch('pr')) resize();
  applyFx();
  if (ch('tex')) generateTextures();
  saveSettings();
  player.sync();
  ui.sync();
}
function applyFx() {
  bloomPass.enabled = settings.bloom;
  finalPass.uniforms.uBloom.value = settings.bloom ? 1 : 0;
  raysPass.enabled = settings.rays;
  const u = finalPass.uniforms;
  u.uFlare.value = settings.flare ? 0.5 : 0;
  u.uGrain.value = settings.film ? 0.02 : 0;
  u.uVig.value = settings.film ? 0.38 : 0.18;
  u.uCA.value = settings.film ? 0.004 : 0;
}
function setSetting(patch, custom = true) {
  const prev = { ...settings };
  Object.assign(settings, patch);
  if (custom) settings.preset = 'custom';
  applySettings(prev);
}

const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const gpuName = (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
  .replace(/^ANGLE \((.*?),\s*(ANGLE Metal Renderer:\s*)?(.*?)(,.*)?\)$/, '$3').replace(/\s*\(0x[0-9a-f]+\)/i, '');
function renderStats() {
  const sz = renderer.getDrawingBufferSize(tmp2);
  return { w: sz.x, h: sz.y, aa: settings.msaa ? Math.min(settings.msaa, maxSamples) : 0, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
}

// ================================================================ 界面与配乐
const player = new Player(settings);
const ui = createUI({
  bodies, sim, RATES, settings, PRESETS, SYSTEM, T_MIN, T_MAX, gpuName, measure, player, liveRows, renderStats, nextPerihelion,
  KEYS: ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon'],
  focusOn: pick,
  overview: () => { const p = shot('overview', 'overview'); pick('sun', { dir: p.dir, dist: p.dist, overview: true }); },
  toggleTour: (on) => toggleTour(on),
  isTour: () => !!nav.tour,
  tourStep: (k) => nav.tour && nextStop(k),
  tourPause: () => nav.tour && (nav.tour.paused = !nav.tour.paused),
  tourPaused: () => !!nav.tour?.paused,
  tourProgress: () => (nav.tour ? Math.min(1, nav.tour.t / TOUR_STOP) : 0),
  setSetting,
  // 跳转时间后立即更新天体位置，随后的聚焦才能按新日期计算镜头方向
  setTime: (t) => { sim.t = Math.min(T_MAX, Math.max(T_MIN, t)); updateBodies(daysOf(sim.t)); },
  isOrbiting: () => controls.autoRotate && !nav.tour,
  setOrbit: (on) => { if (nav.tour) toggleTour(false); controls.autoRotate = on; controls.autoRotateSpeed = 0.35; },
  enter: () => focusOn('earth', { dur: 6.5 }),
});

// ================================================================ 主循环
let last = performance.now(), lastD = null;
const view = { x: 0, y: 0 };
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!sim.paused) sim.t = Math.min(T_MAX, Math.max(T_MIN, sim.t + dt * 1000 * RATES[sim.ri][0] * (sim.rev ? -1 : 1)));
  const d = daysOf(sim.t);
  // 非连续的时间变化（跳转日期、回到现在）直接同步视觉时间
  const step = lastD === null ? 0 : d - lastD, expected = sim.paused ? 0 : (dt * RATES[sim.ri][0]) / 86400;
  updateBodies(d, step, dt, lastD === null || Math.abs(step) > expected * 2 + 1e-6);
  lastD = d;
  updateCamera(dt);
  // 画面构图避让界面：平移投影中心，使聚焦天体位于未被遮挡区域的中央
  view.x += (-ui.safe.dx - view.x) * Math.min(1, dt * 3);
  view.y += (-ui.safe.dy - view.y) * Math.min(1, dt * 3);
  camera.setViewOffset(innerWidth, innerHeight, view.x, view.y, innerWidth, innerHeight);
  camera.updateMatrixWorld();
  updateUniforms(d, now / 1000);
  updateComets(now / 1000);
  updateSunFx(dt);
  finalPass.uniforms.uTime.value = now / 1000;
  updateLabels();
  updateConstellations();
  updateDistance();
  ui.frame(now, dt);
  player.brightness(sunClose);
  renderer.info.reset();
  composer.render(dt);
  window.__afterRender?.(); // 仅供自动化测试（逐帧检测）使用
}

(async function init() {
  ui.progress(0, L('正在载入星表与地图数据'));
  const [land, milky] = await Promise.all([inflate(__LAND__), inflate(__MILKY__), buildStars(), loadRealTextures()]);
  const mask = new Uint8Array(2048 * 1024);
  for (let i = 0; i < mask.length; i++) mask[i] = ((land[i >> 3] >> (i & 7)) & 1) * 255;
  landTex = redTex(mask, 2048, 1024);
  milkyTex = redTex(milky, 1024, 512);
  stars.geometry.setDrawRange(0, starCount(settings.stars));
  buildComposer();
  addEventListener('resize', resize);
  applyFx();
  updateBodies(daysOf(sim.t));
  controls.target.set(0, 0, 0);
  camera.lookAt(0, 0, 0);
  await generateTextures();
  await renderer.compileAsync(scene, camera);
  // 场景先在加载页后面开始渲染，点击“进入”后开场飞行
  requestAnimationFrame(loop);
  ui.ready();
})();

// 调试接口（自动化测试用）
window.solar = { Music, ui, player, stats: renderStats, renderer, composer: () => composer, THREE, belt, kuiper, get starsObj() { return stars; }, get busy() { return busy; }, focusOn: pick, settings, setSetting, PRESETS, sim, byId, camera, controls, nav, get fps() { return String(ui.fps || '--'); } };
