// HDR 异常高亮扫描：回读色调映射前的场景缓冲，找出太阳以外的超亮像素（白色闪光的来源）
import { launch, open } from './open.mjs';
const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 600 });
const errors = await open(page);
await page.evaluate(() => {
  const { renderer, THREE } = solar;
  window.__hot = [];
  window.__afterRender = () => {
    const rt = solar.composer().readBuffer, w = rt.width, h = rt.height, buf = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    // 太阳盘面及其光晕在屏幕上的范围（像素）
    const cam = solar.camera, sp = new THREE.Vector3(0, 0, 0).project(cam);
    const sx = (sp.x * 0.5 + 0.5) * w, sy = (sp.y * 0.5 + 0.5) * h;
    const sr = (7 / cam.position.length() / Math.tan((cam.fov * Math.PI) / 360)) * (h / 2) * 3 + 6;
    let max = 0, mx = 0, my = 0, n = 0;
    for (let i = 0; i < w * h; i++) {
      const L = 0.3 * THREE.DataUtils.fromHalfFloat(buf[i * 4]) + 0.59 * THREE.DataUtils.fromHalfFloat(buf[i * 4 + 1]) + 0.11 * THREE.DataUtils.fromHalfFloat(buf[i * 4 + 2]);
      const x = i % w, y = (i / w) | 0;
      if (sp.z < 1 && Math.hypot(x - sx, y - sy) < sr) continue;
      if (!(L < 25)) { n++; if (!(L <= max)) { max = L; mx = x; my = h - y; } }
    }
    if (n) window.__hot.push({ scene: window.__scene, focus: solar.nav.focus?.id, flight: !!solar.nav.flight, n, max: isFinite(max) ? +max.toFixed(1) : String(max), at: [mx, my] });
  };
});
const scene = async (name, setup, ms) => {
  await page.evaluate((name, setup) => { window.__scene = name; eval(setup); }, name, setup);
  await new Promise((r) => setTimeout(r, ms));
};
for (const id of ['earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'sun', 'encke'])
  await scene(id, `solar.sim.ri = 5; solar.focusOn('${id}'); setTimeout(() => { solar.controls.autoRotate = true; solar.controls.autoRotateSpeed = 3; }, 5000);`, 11000);
await scene('全景', `document.getElementById('bOverview').click();`, 9000);
await scene('漫游', `document.getElementById('bTour').click();`, 60000);
const hot = await page.evaluate(() => __hot);
const by = {};
for (const h of hot) { const k = `${h.scene}${h.flight ? '(飞行)' : ''}`; by[k] = by[k] || { frames: 0, max: 0, sample: h }; by[k].frames++; if (!(h.max <= by[k].max)) { by[k].max = h.max; by[k].sample = h; } }
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(14), '超亮帧', String(v.frames).padStart(4), ' 最大', v.max, ' 例', JSON.stringify(v.sample));
console.log(hot.length ? '' : '未发现太阳以外的超亮像素', errors.join('\n') || 'no errors');
await browser.close();
