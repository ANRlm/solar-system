// 配乐质检：离线渲染 120 秒（中途切换情绪、触发飞行音效），检查电平、削波、爆音，并输出频谱图
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal'] });
const page = await browser.newPage();
await page.goto('file://' + process.cwd() + '/solar-system.html');
await page.waitForFunction(() => window.solar?.Music, { timeout: 60000 });

const res = await page.evaluate(async () => {
  const SR = 48000, DUR = 120, off = new OfflineAudioContext(2, SR * DUR, SR);
  const m = new solar.Music(off, 20260924);
  m.start(0, 0.8);
  m.scheduleUntil(40);
  m.setMood('giant', 40);
  m.whoosh(4, 58);
  m.scheduleUntil(80);
  m.setMood('sun', 80);
  m.setBrightness(1, 80);
  m.scheduleUntil(DUR);
  const buf = await off.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  let peak = 0, sum = 0, dc = 0, clip = 0, maxD = 0, clicks = 0;
  const secRms = [];
  for (let i = 0, acc = 0; i < n; i++) {
    const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    peak = Math.max(peak, a);
    if (a > 0.999) clip++;
    const x = (L[i] + R[i]) / 2;
    sum += x * x; acc += x * x; dc += x;
    if (i) { const d = Math.abs(L[i] - L[i - 1]); maxD = Math.max(maxD, d); if (d > 0.05) clicks++; }
    if ((i + 1) % SR === 0) { secRms.push(Math.sqrt(acc / SR)); acc = 0; }
  }
  // 频谱图：FFT 4096，对数频率 30 Hz–16 kHz
  const N = 4096, H = 1024, W = 1200, ROWS = 360, frames = Math.floor((n - N) / H);
  const img = new Uint8ClampedArray(W * ROWS * 4);
  const win = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const re = new Float32Array(N), im = new Float32Array(N);
  const fft = () => {
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
        }
      }
    }
  };
  const col = (v) => [Math.min(255, v * 3 * 255), Math.min(255, Math.max(0, v * 3 - 1) * 255), Math.min(255, Math.max(0, v * 3 - 2) * 255 + v * 90)];
  for (let x = 0; x < W; x++) {
    const f = Math.floor((x / W) * frames) * H;
    for (let i = 0; i < N; i++) { re[i] = ((L[f + i] + R[f + i]) / 2) * win[i]; im[i] = 0; }
    fft();
    for (let y = 0; y < ROWS; y++) {
      const hz = 30 * Math.pow(16000 / 30, 1 - y / (ROWS - 1)), k = Math.round((hz / SR) * N);
      const db = 20 * Math.log10(Math.hypot(re[k], im[k]) / (N / 4) + 1e-9);
      const [r, g, b] = col(Math.min(1, Math.max(0, (db + 100) / 80)));
      const o = (y * W + x) * 4;
      img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255;
    }
  }
  return { peak, rms: Math.sqrt(sum / n), dc: dc / n, clip, maxD, clicks, secRms, img: Array.from(img), W, ROWS };
});
const db = (x) => (20 * Math.log10(x)).toFixed(1);
console.log(`峰值 ${db(res.peak)} dBFS  RMS ${db(res.rms)} dBFS  直流 ${res.dc.toExponential(1)}  削波 ${res.clip}  最大样本跳变 ${res.maxD.toFixed(4)}  跳变>0.05 ${res.clicks}`);
console.log('每 5 秒 RMS(dB):', res.secRms.filter((_, i) => i % 5 === 0).map((v) => db(v)).join(' '));
await sharp(Buffer.from(res.img), { raw: { width: res.W, height: res.ROWS, channels: 4 } }).png().toFile('/tmp/spectrogram.png');
await browser.close();
