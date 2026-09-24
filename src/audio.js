// 程序化自适应配乐：Web Audio 实时合成的太空氛围音乐
// 声部：弦垫（自定义谐波波形 + 慢速滤波）、低音、钟声（FM，经乒乓延迟）、宇宙风（带通噪声）
// 全部送入算法生成的长混响；情绪随聚焦天体切换，在和弦边界平滑过渡

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 和弦为 MIDI 音高（低音在前）；dur 每个和弦的秒数；bright 滤波亮度；bells 钟声频率（次/秒）；bellOct 钟声上移的半音数
export const MOODS = {
  warm: { dur: 20, bright: 1, bells: 0.22, bellOct: 12, chords: [[50, 57, 61, 64, 66], [47, 54, 57, 62, 64], [43, 50, 54, 59, 61], [45, 52, 59, 61, 64]] }, // Dmaj9 Bm11 Gmaj7♯11 Aadd9
  sun: { dur: 18, bright: 1.45, bells: 0.3, bellOct: 24, chords: [[48, 55, 59, 62, 64, 67], [53, 60, 64, 67, 71], [45, 52, 55, 59, 62], [43, 50, 55, 57, 62]] }, // Cmaj9 Fmaj9♯11 Am11 Gsus2
  dusk: { dur: 22, bright: 0.8, bells: 0.18, bellOct: 12, chords: [[52, 59, 62, 66, 67], [48, 55, 59, 62, 64], [45, 52, 55, 59, 62], [47, 54, 57, 61, 64]] }, // Em9 Cmaj9 Am11 Bm11
  giant: { dur: 28, bright: 0.55, bells: 0.1, bellOct: 24, chords: [[36, 43, 50, 51, 55], [32, 44, 51, 55, 58], [39, 46, 50, 55, 58], [34, 46, 53, 58, 60]] }, // Cm(add9) Abmaj9 Ebmaj7 Bb(add9)
  ice: { dur: 24, bright: 1.15, bells: 0.36, bellOct: 24, chords: [[54, 61, 64, 68, 71], [50, 57, 61, 64, 68], [45, 57, 61, 64, 69], [52, 59, 64, 66, 68]] }, // F♯m11 Dmaj7♯11 A Eadd9
};
export const MOOD_OF = {
  sun: 'sun', mercury: 'warm', venus: 'warm', earth: 'warm', moon: 'warm', mars: 'dusk',
  jupiter: 'giant', io: 'giant', europa: 'giant', ganymede: 'giant', callisto: 'giant', saturn: 'giant', titan: 'giant',
  uranus: 'ice', neptune: 'ice',
  phobos: 'dusk', deimos: 'dusk', ceres: 'warm',
  mimas: 'giant', enceladus: 'giant', tethys: 'giant', dione: 'giant', rhea: 'giant', iapetus: 'giant',
  miranda: 'ice', ariel: 'ice', umbriel: 'ice', titania: 'ice', oberon: 'ice', triton: 'ice', pluto: 'ice', charon: 'ice',
  halley: 'ice', encke: 'ice', halebopp: 'ice', swifttuttle: 'ice', tempeltuttle: 'ice', churyumov: 'ice', ponsbrooks: 'ice',
};

export class Music {
  constructor(ctx, seed = (Math.random() * 2 ** 31) | 0) {
    this.ctx = ctx;
    let s = seed || 1;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.mood = MOODS.warm;
    this.pending = null;
    this.idx = 0;
    this.voices = [];
    this.lastBell = -1;
    this.speed = 0;
    this.build();
  }

  build() {
    const c = this.ctx;
    // 主输出：去超低频 → 柔和压缩 → 限幅 → 音量
    this.out = c.createGain();
    this.out.gain.value = 0;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 28;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.08; comp.release.value = 0.6;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.25;
    this.mix = c.createGain();
    this.mix.connect(hp).connect(comp).connect(lim).connect(this.out).connect(c.destination);

    // 混响：衰减噪声脉冲，高频随时间更快衰减（模拟空气吸收），约 7 秒尾音
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(7, 2.6);
    const wet = c.createGain();
    wet.gain.value = 0.9;
    this.reverb.connect(wet).connect(this.mix);

    // 弦垫总线：高架滤波随“亮度”变化（靠近太阳时更明亮）
    this.tilt = c.createBiquadFilter();
    this.tilt.type = 'highshelf';
    this.tilt.frequency.value = 2500;
    this.tilt.gain.value = -3;
    this.padBus = c.createGain();
    this.padBus.gain.value = 1;
    this.padBus.connect(this.tilt);
    this.send(this.tilt, 0.42, 0.75);

    this.bassBus = c.createGain();
    this.send(this.bassBus, 0.8, 0.25);

    // 钟声：乒乓延迟后主要进入混响
    this.bellBus = c.createGain();
    this.send(this.bellBus, 0.22, 0.9);
    [[0.43, -0.65], [0.61, 0.65]].forEach(([time, pan]) => {
      const d = c.createDelay(2), fb = c.createGain(), lp = c.createBiquadFilter(), p = c.createStereoPanner();
      d.delayTime.value = time; fb.gain.value = 0.34; lp.frequency.value = 2800; p.pan.value = pan;
      this.bellBus.connect(d).connect(lp).connect(fb).connect(d);
      const lvl = c.createGain();
      lvl.gain.value = 0.5;
      lp.connect(p).connect(lvl);
      this.send(lvl, 0.15, 0.8);
    });

    // 宇宙风：循环噪声经缓慢扫动的带通
    const noise = c.createBuffer(2, c.sampleRate * 6, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = noise.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = this.rnd() * 2 - 1; }
    this.noise = noise;
    const src = c.createBufferSource();
    src.buffer = noise; src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.9;
    const lfo = c.createOscillator(), lfoAmt = c.createGain();
    lfo.frequency.value = 0.021; lfoAmt.gain.value = 420;
    lfo.connect(lfoAmt).connect(bp.frequency);
    this.air = c.createGain();
    this.air.gain.value = 0.02;
    src.connect(bp).connect(this.air);
    this.send(this.air, 0.3, 0.9);
    // 太阳低鸣：低通噪声，靠近太阳时淡入
    const src2 = c.createBufferSource();
    src2.buffer = noise; src2.loop = true; src2.playbackRate.value = 0.5;
    const lp2 = c.createBiquadFilter();
    lp2.type = 'lowpass'; lp2.frequency.value = 110; lp2.Q.value = 0.7;
    this.rumble = c.createGain();
    this.rumble.gain.value = 0;
    src2.connect(lp2).connect(this.rumble);
    this.send(this.rumble, 0.9, 0.3);
    this.sources = [src, src2, lfo];
    this.fxBus = c.createGain();
    this.send(this.fxBus, 0.5, 0.7);

    // 波形：弦垫用 1/n^1.35 的柔和谐波（偶次稍弱，更温暖），比锯齿波少了刺耳的高频
    const N = 40, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) im[n] = Math.pow(n, -1.35) * (n % 2 ? 1 : 0.62);
    this.padWave = c.createPeriodicWave(re, im);
  }

  send(node, dry, wet) {
    const d = this.ctx.createGain(), w = this.ctx.createGain();
    d.gain.value = dry; w.gain.value = wet;
    node.connect(d).connect(this.mix);
    node.connect(w).connect(this.reverb);
  }

  impulse(secs, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, a = 0.85 - 0.72 * t;
        y += a * (this.rnd() * 2 - 1 - y);
        d[i] = y * Math.pow(1 - t, decay) * Math.min(1, i / (c.sampleRate * 0.015));
      }
    }
    return buf;
  }

  start(now = this.ctx.currentTime, volume = 0.8) {
    this.sources.forEach((s) => s.start(now));
    this.next = now + 0.2;
    this.nextBell = now + 3;
    this.setVolume(volume, now, 3);
  }

  setVolume(v, now = this.ctx.currentTime, fade = 0.6) {
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(v, now, fade / 3);
  }

  // x∈[0,1]：靠近太阳时更明亮，并淡入低鸣
  setBrightness(x, now = this.ctx.currentTime) {
    this.tilt.gain.setTargetAtTime(-3 + 7 * x, now, 1.2);
    this.rumble.gain.setTargetAtTime(0.16 * x, now, 1.5);
  }

  // 时间流速（0 为实时，9 为 1 年/秒）：越快钟声越密
  setSpeed(i) { this.speed = i; }

  // 情绪在下一个和弦生效；若下一个和弦还很远，则提前结束当前和弦
  setMood(name, now = this.ctx.currentTime) {
    const m = MOODS[name];
    if (!m || m === (this.pending || this.mood)) return;
    this.pending = m;
    if (this.next - now > 5) {
      this.next = now + 2.5;
      for (const v of this.voices) this.release(v, this.next + 1, 5);
    }
  }

  release(v, t, fade) {
    if (v.end <= t) return;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, fade / 4);
    v.oscs.forEach((o) => o.stop(t + fade + 0.2));
    v.end = t;
  }

  scheduleUntil(until) {
    while (this.next < until) {
      if (this.pending) { this.mood = this.pending; this.pending = null; this.idx = 0; }
      const m = this.mood, chord = m.chords[this.idx++ % m.chords.length], t = this.next;
      this.chord = chord;
      this.voices = this.voices.filter((v) => v.end > t);
      chord.forEach((midi, i) => this.voices.push(this.pad(t, midi, m.dur, m.bright, (i / (chord.length - 1) - 0.5) * 1.3, 0.05 / Math.sqrt(chord.length))));
      this.voices.push(this.bass(t, chord[0], m.dur));
      this.next += m.dur;
    }
    while (this.nextBell < until) {
      const t = this.nextBell, m = this.mood, ch = this.chord || m.chords[0];
      const pool = ch.slice(1).map((n) => n + m.bellOct);
      const pick = () => { let n; do n = pool[Math.floor(this.rnd() * pool.length)]; while (n === this.lastBell && pool.length > 1); return (this.lastBell = n); };
      if (this.rnd() < 0.18) [0, 0.34, 0.68].forEach((dt, k) => this.bell(t + dt, pick(), 0.055 - k * 0.012));
      else this.bell(t, pick(), 0.04 + this.rnd() * 0.035);
      const rate = m.bells * (1 + this.speed * 0.12);
      this.nextBell += Math.max(0.9, -Math.log(1 - this.rnd()) / rate);
    }
  }

  pad(t, midi, dur, bright, pan, level) {
    const c = this.ctx, f0 = mtof(midi), attack = 6, rel = 9, end = t + dur;
    const g = c.createGain(), flt = c.createBiquadFilter(), p = c.createStereoPanner();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(level, t, attack / 3);
    g.gain.setTargetAtTime(0, end, rel / 4);
    flt.type = 'lowpass'; flt.Q.value = 0.5;
    const cut = Math.min(5200, f0 * 4 * bright);
    flt.frequency.setValueAtTime(cut * 0.45, t);
    flt.frequency.linearRampToValueAtTime(cut, t + dur * 0.55);
    flt.frequency.linearRampToValueAtTime(cut * 0.6, end + rel);
    p.pan.value = pan;
    const oscs = [-8, 0, 8].map((cents) => {
      const o = c.createOscillator();
      o.setPeriodicWave(this.padWave);
      o.frequency.value = f0;
      o.detune.value = cents + (this.rnd() - 0.5) * 4;
      o.connect(flt);
      o.start(t);
      o.stop(end + rel + 0.5);
      return o;
    });
    flt.connect(g).connect(p).connect(this.padBus);
    oscs[0].onended = () => p.disconnect();
    return { gain: g, oscs, end: end + rel };
  }

  bass(t, midi, dur) {
    const c = this.ctx, f0 = mtof(midi >= 40 ? midi - 12 : midi), end = t + dur;
    const g = c.createGain(), lp = c.createBiquadFilter();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(0.16, t, 1.6);
    g.gain.setTargetAtTime(0, end, 2);
    lp.frequency.value = 180;
    const oscs = [[f0, 'sine', 1], [f0 * 2, 'triangle', 0.18]].map(([f, type, a]) => {
      const o = c.createOscillator(), og = c.createGain();
      o.type = type; o.frequency.value = f; og.gain.value = a;
      o.connect(og).connect(lp);
      o.start(t); o.stop(end + 9);
      return o;
    });
    lp.connect(g).connect(this.bassBus);
    oscs[0].onended = () => g.disconnect();
    return { gain: g, oscs, end: end + 8 };
  }

  // FM 钟声：调制指数迅速衰减，起音明亮、尾音柔和
  bell(t, midi, vel) {
    const c = this.ctx, f0 = mtof(midi), ratio = this.rnd() < 0.5 ? 3.5 : 2, decay = 3.5 + this.rnd() * 2.5;
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), p = c.createStereoPanner();
    car.frequency.value = f0;
    mod.frequency.value = f0 * ratio;
    mg.gain.setValueAtTime(f0 * 1.6, t);
    mg.gain.exponentialRampToValueAtTime(f0 * 0.04, t + decay * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    p.pan.value = (this.rnd() - 0.5) * 1.4;
    mod.connect(mg).connect(car.frequency);
    car.connect(g).connect(p).connect(this.bellBus);
    [car, mod].forEach((o) => { o.start(t); o.stop(t + decay + 0.1); });
    car.onended = () => p.disconnect();
  }

  // 飞行音效：带通扫频的噪声呼啸
  whoosh(dur, now = this.ctx.currentTime) {
    const c = this.ctx, src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(180, now);
    bp.frequency.exponentialRampToValueAtTime(1800, now + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(260, now + dur);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.09, now + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, now + dur);
    src.connect(bp).connect(g).connect(this.fxBus);
    src.start(now, this.rnd() * 3);
    src.stop(now + dur + 0.1);
    src.onended = () => g.disconnect();
  }
}

// 播放器：管理 AudioContext 生命周期（须在用户手势中解锁）、实时调度、后台静音与设置联动
export class Player {
  constructor(settings) {
    this.s = settings;
    this.moodName = 'warm';
  }

  get unlocked() { return !!this.m; }

  unlock() {
    if (this.ctx) { if (this.s.music) this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx({ latencyHint: 'playback' });
    this.m = new Music(this.ctx);
    this.m.start(this.ctx.currentTime, 0);
    this.m.setMood(this.moodName);
    const tick = () => this.ctx.state === 'running' && this.m.scheduleUntil(this.ctx.currentTime + 4);
    tick();
    setInterval(tick, 400);
    // 后台：标签页隐藏（切标签、最小化）或窗口失去焦点（切到别的应用但浏览器窗口仍可见）
    document.addEventListener('visibilitychange', () => this.sync());
    addEventListener('blur', () => this.sync());
    addEventListener('focus', () => this.sync());
    this.sync();
  }

  // 按设置与页面可见性调整：关闭时先淡出再挂起音频上下文，节省 CPU
  sync() {
    if (!this.m) return;
    clearTimeout(this.suspendTimer);
    if (this.s.music && !document.hidden && document.hasFocus()) {
      this.ctx.resume();
      this.m.setVolume(this.s.volume * 0.9, this.ctx.currentTime, 1.5);
    } else {
      this.m.setVolume(0, this.ctx.currentTime, 0.8);
      this.suspendTimer = setTimeout(() => this.ctx.suspend(), 1500);
    }
  }

  mood(id) {
    this.moodName = this.s.adaptive ? MOOD_OF[id] || 'warm' : 'warm';
    this.m?.setMood(this.moodName);
  }

  brightness(x) {
    if (!this.m || Math.abs(x - (this.lastB ?? -1)) < 0.03) return;
    this.lastB = x;
    this.m.setBrightness(x);
  }

  speed(i) { this.m?.setSpeed(i); }

  whoosh(dur) {
    if (this.m && this.s.sfx && this.s.music && this.ctx.state === 'running') this.m.whoosh(dur);
  }
}
