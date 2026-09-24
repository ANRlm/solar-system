// 界面层：顶栏、信息卡、底部坞、设置抽屉、弹出层、提示与快捷键。引擎能力通过 app 接口调用

import { L, nameOf, textOf, tourFact, yearMonth, isEn, setLang, onLang, applyDom } from './i18n.js';

const $ = (id) => document.getElementById(id);

// 24×24 线性图标（描边）与实心图标
const LINE = {
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  musicOff: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4"/><path d="M12 16.8v.2"/>',
  chevron: '<path d="M6 15l6-6 6 6"/>',
  chevUp: '<path d="M6 15l6-6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  orbits: '<circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="12" r="5.6" stroke-dasharray="2.2 2.4"/><circle cx="12" cy="12" r="9.4"/><circle cx="18.6" cy="5.4" r="1.6" fill="currentColor" stroke="none"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  comet: '<circle cx="16" cy="8" r="3"/><path d="M13.8 10.2L4 20M12 7.5L6 13.5M16.5 11L10.5 17"/>',
};
const SOLID = {
  rewind: '<path d="M11 6.5v11L3.5 12zM20.5 6.5v11L13 12z"/>',
  play: '<path d="M7.5 5v14L19 12z"/>',
  pause: '<path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.6z"/>',
  prev: '<path d="M6 5h2.5v14H6zM20 5v14L9.5 12z"/>',
  next: '<path d="M15.5 5H18v14h-2.5zM4 5v14l10.5-7z"/>',
};
const icon = (n, cls = '') => (LINE[n] ? `<svg viewBox="0 0 24 24" class="${cls}">${LINE[n]}</svg>` : `<svg viewBox="0 0 24 24" class="solid ${cls}">${SOLID[n]}</svg>`);
const kv = (rows) => rows.map(([k, v]) => `<div><span>${k || '&nbsp;'}</span><b>${v}</b></div>`).join('');
const pad = (n) => String(n).padStart(2, '0');

const PRESET_INFO = {
  low: ['低', '1K 纹理 · 性能优先'],
  medium: ['中', '2K 纹理 · 均衡'],
  high: ['高', '4K 纹理 · 推荐'],
  ultra: ['极致', '原生分辨率 · 8× 抗锯齿'],
};
// 天象：真实日月食与彗星回归，跳转后聚焦相应天体；日食附食甚点经纬度，镜头对准月影
const EVENTS = [
  ['2026-03-03T11:33:00Z', '月全食', '2026-03-03', 'moon'],
  ['2026-08-12T17:46:00Z', '日全食 · 格陵兰—西班牙', '2026-08-12', 'earth', [65.2, -25.2]],
  ['2027-08-02T10:07:00Z', '日全食 · 北非—中东', '2027-08-02', 'earth', [25.5, 33.2]],
  ['2027-02-11T12:00:00Z', '恩克彗星过近日点', '2027-02-11', 'encke'],
  ['1997-04-01T00:00:00Z', '海尔-波普大彗星', '1997-04-01', 'halebopp'],
  ['2061-07-28T12:00:00Z', '哈雷彗星回归', '2061-07-28', 'halley'],
];
const QUALITY_KEYS = ['bloom', 'rays', 'flare', 'film', 'detail'];

export function createUI(app) {
  const { bodies, sim, RATES, settings } = app;
  const body = document.body;
  let entered = false, focus = null;
  applyDom(); // 登记页面上的静态中文（须在动态内容渲染之前）；英文模式下同时完成替换

  document.querySelectorAll('[data-ic]').forEach((el) => (el.innerHTML = icon(el.dataset.ic)));
  $('bRev').innerHTML = icon('rewind');
  $('bPlay').innerHTML = icon('pause', 'i-pause') + icon('play', 'i-play');

  // ---------------------------------------------------------------- 天体坞
  const swatch = (b, cls = '') => `<span class="sw ${cls}" style="--c:${b.def.color}" data-k="${b.def.kind}"${b.def.rings === 'saturn' ? ' data-ring' : ''}></span>`;
  const navBtn = (b, parent, cls) => {
    const el = document.createElement('button');
    el.className = cls;
    el.innerHTML = `${swatch(b)}<span>${nameOf(b)}</span>`;
    el.onclick = () => app.focusOn(b.id);
    b.navBtn = el;
    parent.append(el);
  };
  bodies.filter((b) => !b.parent && (b.def.kind === 'star' || b.def.kind === 'planet')).forEach((b) => navBtn(b, $('nav'), 'nb'));
  bodies.filter((b) => b.parent).forEach((b) => navBtn(b, $('moons'), 'nb mini'));
  const GROUPS = { dwarf: ['矮行星', bodies.filter((b) => b.def.kind === 'dwarf')], comet: ['彗星', bodies.filter((b) => b.def.kind === 'comet')] };
  $('nav').insertAdjacentHTML('beforeend', '<span class="vdiv"></span>');
  for (const [key, [name, list]] of Object.entries(GROUPS)) {
    const el = document.createElement('button');
    el.className = 'nb grp';
    el.dataset.grp = key;
    el.innerHTML = `${swatch(list[0])}<span>${L(name)}</span>${icon('chevUp')}`;
    el.onclick = (e) => { e.stopPropagation(); openGroup(key, el); };
    list.forEach((b) => (b.grpBtn = el));
    $('nav').append(el);
  }
  function openGroup(key, btn) {
    const pop = $('groupPop'), [name, list] = GROUPS[key];
    if (pop.classList.contains('open') && pop.dataset.grp === key) return closePops();
    closePops();
    pop.dataset.grp = key;
    pop.innerHTML = `<h4>${L(name)}</h4>` + list.map((b) => {
      const sub = b.def.kind === 'comet' ? L('下次过近日点 · {0}', yearMonth(app.nextPerihelion(b))) : L('距太阳 {0} AU · {1}', b.au.length().toFixed(1), textOf(b.def, 'type').split(' · ')[1] || '');
      return `<button class="gi${b === focus ? ' active' : ''}" data-id="${b.id}">${swatch(b)}<span><b>${nameOf(b)}</b><small>${sub}</small></span></button>`;
    }).join('');
    pop.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => { closePops(); app.focusOn(el.dataset.id); }));
    const r = btn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(innerWidth - 308, r.left + r.width / 2 - 150))}px`;
    pop.style.bottom = `${innerHeight - r.top + 10}px`;
    pop.classList.add('open');
  }

  // 时间条：宽屏在顶部居中，窄屏移入底部坞
  const narrow = matchMedia('(max-width:1180px)');
  const placeTime = () => (narrow.matches ? $('timeSlotDock') : $('timeSlotTop')).append($('timebar'));
  narrow.addEventListener('change', placeTime);
  placeTime();
  // 底部坞高度变化时更新 CSS 变量，信息卡据此避让
  new ResizeObserver(() => document.documentElement.style.setProperty('--dock-h', `${$('dock').offsetHeight}px`)).observe($('dock'));

  // ---------------------------------------------------------------- 信息卡
  const info = $('info');
  if (matchMedia('(max-width:760px)').matches) info.classList.add('collapsed');
  const toggleInfo = () => info.classList.toggle('collapsed');
  let infoWasCollapsed = info.classList.contains('collapsed');
  $('iHead').onclick = toggleInfo;

  function scaleText(b) {
    const d = b.def;
    if (d.kind === 'comet') return L('彗核半径约 {0} km', d.km);
    if (b.id === 'earth') return L('其他天体的尺寸参照');
    if (b.id === 'system') return L('日球层直径约 240 AU');
    const r = d.km / 6371;
    return r >= 1 ? L('直径是地球的 {0} 倍', r >= 10 ? r.toFixed(0) : r.toFixed(1)) : L('直径是地球的 {0}%', Math.round(r * 100));
  }
  function renderActions(b) {
    const acts = [];
    acts.push(`<button class="btn${app.isOrbiting() ? ' on' : ''}" data-act="orbit">${icon('rotate')}${L('环绕')}</button>`);
    if (b.parent) acts.push(`<button class="btn" data-act="parent">${icon('up')}${L('返回{0}', nameOf(b.parent))}</button>`);
    if (b.def.kind === 'comet') acts.push(`<button class="btn" data-act="peri">${icon('comet')}${L('跳到下次近日点')}</button>`);
    $('iActions').innerHTML = acts.join('');
    $('iActions').querySelectorAll('[data-act]').forEach((el) => (el.onclick = () => {
      const a = el.dataset.act;
      if (a === 'orbit') { app.setOrbit(!app.isOrbiting()); el.classList.toggle('on', app.isOrbiting()); }
      else if (a === 'parent') app.focusOn(b.parent.id);
      else if (a === 'peri') { app.setTime(app.nextPerihelion(b)); app.focusOn(b.id); toast(L('已跳到下次过近日点')); }
    }));
  }
  // quiet：切换语言时重绘，不播放切换动画、不弹提示
  function onFocus(b, quiet) {
    focus = b;
    const d = b.def, sw = $('iSw');
    sw.style.setProperty('--c', d.color);
    sw.dataset.k = d.kind;
    sw.toggleAttribute('data-ring', d.rings === 'saturn');
    $('bOverview').classList.toggle('on', b.id === 'system');
    // 标题用当前语言，副标题用另一种语言
    $('iName').textContent = nameOf(b);
    $('iEn').textContent = isEn() ? d.name : d.en;
    $('iType').textContent = textOf(d, 'type');
    $('iScale').textContent = scaleText(b);
    $('iDesc').textContent = textOf(d, 'desc');
    $('iStats').innerHTML = kv(textOf(d, 'stats'));
    $('iLive').innerHTML = kv(app.liveRows(b));
    renderActions(b);
    // 远离太阳的彗星还没有彗尾：提示可以跳到近日点观看
    if (!quiet && d.kind === 'comet' && b.act < 0.05 && !app.isTour()) toast(L('{0}距太阳 {1} AU，彗核冻结、尚未形成彗尾——点「跳到下次近日点」即可观看', nameOf(b), b.au.length().toFixed(1)), undefined, 5000);
    if (!quiet) {
      info.classList.remove('swap');
      void info.offsetWidth;
      info.classList.add('swap');
    }
    const fam = b.parent || b;
    let moons = 0;
    for (const [key, [name, list]] of Object.entries(GROUPS)) {
      const el = $('nav').querySelector(`[data-grp=${key}]`), cur = list.includes(b) ? b : null;
      el.classList.toggle('active', !!cur);
      el.innerHTML = `${swatch(cur || list[0])}<span>${cur ? nameOf(cur) : L(name)}</span>${icon('chevUp')}`;
    }
    for (const o of bodies) {
      o.navBtn?.classList.toggle('active', o === b);
      const show = o.parent === fam;
      if (o.parent) { o.navBtn.hidden = !show; moons += show; }
    }
    $('moons').classList.toggle('show', moons > 0);
    if (!quiet) (b.navBtn || b.grpBtn)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- 时间控制
  const fill = (el) => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
  const speed = $('speed');
  speed.max = RATES.length - 1;
  function syncTime() {
    speed.value = sim.ri;
    fill(speed);
    $('speedLbl').textContent = sim.paused ? L('已暂停') : (sim.rev ? '−' : '') + L(RATES[sim.ri][1]);
    $('speedLbl').classList.toggle('paused', sim.paused);
    $('bPlay').classList.toggle('paused', sim.paused);
    $('bRev').classList.toggle('on', sim.rev);
    app.player.speed(sim.ri);
  }
  const setRate = (i) => { sim.ri = Math.max(0, Math.min(RATES.length - 1, i)); syncTime(); };
  speed.oninput = () => setRate(+speed.value);
  $('bPlay').onclick = () => { sim.paused = !sim.paused; syncTime(); };
  $('bRev').onclick = () => { sim.rev = !sim.rev; syncTime(); };
  const goNow = () => { app.setTime(Date.now()); sim.ri = 0; sim.rev = false; sim.paused = false; syncTime(); toast(L('已回到当前时刻')); };
  $('bNow').onclick = goNow;
  $('bNow2').onclick = () => { goNow(); closePops(); };
  $('bOverview').onclick = () => app.overview();
  $('bTour').onclick = () => app.toggleTour();

  // ---------------------------------------------------------------- 弹出层（日期 / 性能）
  const pops = { datePop: ['clock'], perfPop: ['fpsPill'], groupPop: [] };
  function closePops(except) {
    for (const id in pops) if (id !== except) $(id).classList.remove('open');
  }
  for (const [id, triggers] of Object.entries(pops))
    for (const t of triggers) $(t).onclick = (e) => {
      e.stopPropagation();
      closePops(id);
      const open = $(id).classList.toggle('open');
      if (open && id === 'datePop') syncDateInput(true);
    };
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.pop')) closePops();
  });
  function syncDateInput(force) {
    const el = $('dateIn');
    if (!force && document.activeElement === el) return;
    const t = new Date(sim.t);
    el.value = `${String(t.getFullYear()).padStart(4, '0')}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
  }
  $('dateIn').onchange = (e) => { const t = new Date(e.target.value).getTime(); if (t >= app.T_MIN && t <= app.T_MAX) app.setTime(t); };
  document.querySelectorAll('[data-jump]').forEach((el) => (el.onclick = () => { app.setTime(sim.t + +el.dataset.jump * 864e5); syncDateInput(true); }));
  const renderEvents = () => ($('events').innerHTML = EVENTS.map(([, name, date], i) => `<button data-ev="${i}"><span>${L(name)}</span><small>${date}</small></button>`).join(''));
  renderEvents();
  $('events').onclick = (e) => {
    const el = e.target.closest('[data-ev]');
    if (!el) return;
    const [iso, name, , id, geo] = EVENTS[+el.dataset.ev];
    app.setTime(Date.parse(iso));
    sim.paused = false; sim.rev = false;
    setRate(1);
    app.focusOn(id, geo ? { geo, geoTilt: 30 } : {});
    closePops();
    toast(L(name));
  };

  // ---------------------------------------------------------------- 设置抽屉
  const drawer = $('drawer');
  function setDrawer(open) {
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', !open);
    body.classList.toggle('drawer-open', open);
    $('bSettings').classList.toggle('on', open);
    if (open) closePops();
  }
  $('bSettings').onclick = () => setDrawer(!drawer.classList.contains('open'));
  $('dClose').onclick = () => setDrawer(false);
  drawer.querySelectorAll('[data-tab]').forEach((t) => (t.onclick = () => {
    drawer.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === t));
    drawer.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('on', p.dataset.pane === t.dataset.tab));
  }));
  const renderPresets = () => {
    $('presets').innerHTML = Object.entries(PRESET_INFO).map(([k, [name, sub]]) => `<button data-p="${k}"${k === settings.preset ? ' class="on"' : ''}><b>${L(name)}</b><small>${L(sub)}</small></button>`).join('');
  };
  renderPresets();
  $('presets').onclick = (e) => {
    const el = e.target.closest('[data-p]');
    if (!el) return;
    app.setSetting({ ...app.PRESETS[el.dataset.p], preset: el.dataset.p }, false);
    toast(L('画质：{0}', L(PRESET_INFO[el.dataset.p][0])));
  };
  $('sScale').oninput = (e) => app.setSetting({ scale: +e.target.value });
  $('sTex').onchange = (e) => app.setSetting({ tex: +e.target.value });
  $('sMsaa').onchange = (e) => app.setSetting({ msaa: +e.target.value });
  $('sExposure').oninput = (e) => app.setSetting({ exposure: +e.target.value }, false);
  $('sVolume').oninput = (e) => app.setSetting({ volume: +e.target.value }, false);
  drawer.querySelectorAll('[data-k]').forEach((el) => (el.onchange = () => {
    const k = el.dataset.k;
    if (k === 'music' && el.checked) app.player.unlock();
    app.setSetting({ [k]: el.checked }, QUALITY_KEYS.includes(k));
    if (k === 'adaptive' && focus) app.player.mood(focus.id);
  }));

  function sync() {
    $('presets').querySelectorAll('[data-p]').forEach((el) => el.classList.toggle('on', el.dataset.p === settings.preset));
    $('sScale').value = settings.scale;
    $('vScale').textContent = `${Math.round(settings.scale * 100)}%`;
    $('sTex').value = settings.tex;
    $('sMsaa').value = settings.msaa;
    $('sExposure').value = settings.exposure;
    $('vExposure').textContent = settings.exposure.toFixed(2);
    $('sVolume').value = settings.volume;
    $('vVolume').textContent = `${Math.round(settings.volume * 100)}%`;
    drawer.querySelectorAll('input[type=range]').forEach(fill);
    drawer.querySelectorAll('[data-k]').forEach((el) => (el.checked = !!settings[el.dataset.k]));
    const on = settings.music && app.player.unlocked;
    $('bMusic').innerHTML = icon(on ? 'music' : 'musicOff');
    $('bMusic').classList.toggle('on', on);
    if (!settings.autohide) body.classList.remove('idle');
  }
  $('bMusic').onclick = () => {
    const on = !(settings.music && app.player.unlocked);
    if (on) app.player.unlock();
    app.setSetting({ music: on }, false);
    toast(L(on ? '音乐已开启' : '音乐已关闭'));
  };

  // ---------------------------------------------------------------- 漫游字幕
  const cap = $('caption');
  $('tPrev').innerHTML = icon('prev');
  $('tNext').innerHTML = icon('next');
  const syncPause = () => ($('tPause').innerHTML = app.tourPaused() ? icon('play') : icon('pause'));
  $('tPrev').onclick = () => app.tourStep(-1);
  $('tNext').onclick = () => app.tourStep(1);
  $('tPause').onclick = () => { app.tourPause(); syncPause(); toast(L(app.tourPaused() ? '已停留在这一站' : '继续漫游')); };
  $('tExit').onclick = () => app.toggleTour(false);
  let capTimer, lastStop = null;
  // 字幕文字：没有专门的字幕时取简介第一句
  function renderCaption(st) {
    const d = st.overview ? app.SYSTEM : st.body.def, first = (s) => (isEn() ? s.split(/(?<=\.)\s/)[0] : s.split('。')[0] + '。');
    $('cKick').textContent = L('自动漫游 · 第 {0} 站 / 共 {1} 站', st.index + 1, st.total);
    $('cName').textContent = isEn() ? d.en : d.name;
    $('cEn').textContent = isEn() ? d.name : d.en;
    $('cFact').textContent = st.fact ? tourFact(st.id, st.fact) : first(textOf(d, 'desc'));
  }
  function onStop(st) {
    cap.classList.remove('show');
    clearTimeout(capTimer);
    lastStop = st;
    capTimer = setTimeout(() => {
      renderCaption(st);
      syncPause();
      cap.classList.add('show');
    }, st.delay * 1000 * 0.7);
  }

  // ---------------------------------------------------------------- 其他按钮、帮助
  const toggleHide = () => body.classList.toggle('hide-ui');
  const setHelp = (open) => $('help').classList.toggle('open', open);
  $('bHide').onclick = () => { toggleHide(); toast(L('按 H 恢复界面')); };

  // ---------------------------------------------------------------- 中英文切换：原地重绘所有动态文字，时间、聚焦与设置都保持不变
  const syncLangBtn = () => ($('bLang').textContent = isEn() ? '中' : 'EN');
  syncLangBtn();
  const toggleLang = () => { setLang(isEn() ? 'zh' : 'en'); toast(isEn() ? 'Switched to English' : '已切换到中文'); };
  $('bLang').onclick = toggleLang;
  onLang(() => {
    syncLangBtn();
    for (const b of bodies) {
      if (b.navBtn) b.navBtn.lastChild.textContent = nameOf(b);
      if (b.label) b.label.lastChild.textContent = nameOf(b);
    }
    if (focus) onFocus(focus, true);
    renderPresets();
    renderEvents();
    syncTime();
    if (lastStop && cap.classList.contains('show')) renderCaption(lastStop);
    closePops();
  });
  $('bFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
  $('bHelp').onclick = () => setHelp(true);
  $('hClose').onclick = () => setHelp(false);
  $('help').onclick = (e) => e.target.id === 'help' && setHelp(false);

  // ---------------------------------------------------------------- 提示条
  let toastTimer;
  function toast(msg, progress, ms = 2200) {
    const t = $('toast');
    $('toastMsg').textContent = msg;
    t.classList.toggle('progress', progress !== undefined);
    if (progress !== undefined) $('toastBar').style.transform = `scaleX(${progress})`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    if (progress === undefined || progress >= 1) toastTimer = setTimeout(() => t.classList.remove('show'), progress >= 1 ? 900 : ms);
  }

  // ---------------------------------------------------------------- 加载与入场
  function progress(f, msg) {
    if (!entered) {
      if (msg) $('ldMsg').textContent = msg;
      $('ldBar').style.transform = `scaleX(${f})`;
      $('ldPct').textContent = `${Math.round(f * 100)}%`;
    } else toast(msg || L('正在重新生成行星表面'), f);
  }
  function ready() {
    entered = true;
    $('loader').classList.add('done');
    body.classList.remove('pre');
    app.enter();
    if (!settings.music) return;
    const unlock = () => {
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
      if (!settings.music) return;
      app.player.unlock();
      sync();
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
    setTimeout(() => settings.music && !app.player.unlocked && toast(L('点击画面任意处即可开启音乐')), 3000);
  }

  // ---------------------------------------------------------------- 键盘
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (!entered) return;
    if (app.isTour() && (k === 'ArrowRight' || k === 'ArrowLeft')) { e.preventDefault(); app.tourStep(k === 'ArrowRight' ? 1 : -1); return; }
    if (k === 'Escape') { closePops(); setDrawer(false); setHelp(false); body.classList.remove('hide-ui'); return; }
    if (k === ' ') { if (e.target.closest?.('button')) return; e.preventDefault(); $('bPlay').click(); }
    else if (k === '[' || k === ']') setRate(sim.ri + (k === ']' ? 1 : -1));
    else if (/^[0-9]$/.test(k)) app.focusOn(app.KEYS[+k]);
    else if (k === '?' || k === '/') setHelp(!$('help').classList.contains('open'));
    else {
      const act = { l: toggleLang, h: toggleHide, r: () => $('bRev').click(), t: () => app.toggleTour(), o: () => app.overview(), m: () => $('bMusic').click(), s: () => $('bSettings').click(), i: toggleInfo, f: () => $('bFull').click() }[k.toLowerCase()];
      act?.();
    }
  });

  // ---------------------------------------------------------------- 漫游时自动隐藏界面
  let lastInput = performance.now();
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'])
    addEventListener(ev, () => { lastInput = performance.now(); body.classList.remove('idle'); }, { passive: true });

  // ---------------------------------------------------------------- 每帧：FPS、时钟、实时数据
  const graph = $('graph'), g2d = graph.getContext('2d');
  const hist = new Float32Array(52);
  const perf = { n: 0, t0: performance.now(), last: performance.now(), lo: Infinity, hi: 0, fps: 0 };
  $('gpu').textContent = app.gpuName;
  let slow = 0;
  function frame(now, dt) {
    const ft = now - perf.last;
    perf.last = now;
    perf.n++;
    perf.lo = Math.min(perf.lo, ft);
    perf.hi = Math.max(perf.hi, ft);
    if (now - perf.t0 >= 500) {
      const fps = (perf.n * 1000) / (now - perf.t0);
      perf.fps = fps;
      $('fps').textContent = Math.round(fps);
      $('fps').className = fps >= 50 ? 'good' : fps >= 28 ? 'ok' : 'bad';
      hist.copyWithin(0, 1);
      hist[hist.length - 1] = fps;
      if ($('perfPop').classList.contains('open')) {
        const s = app.renderStats();
        $('ms').textContent = `${((now - perf.t0) / perf.n).toFixed(1)} ms`;
        $('msr').textContent = `${perf.lo.toFixed(1)} – ${perf.hi.toFixed(1)} ms`;
        $('res').textContent = `${s.w}×${s.h}${s.aa ? ` · ${s.aa}×AA` : ''}`;
        $('calls').textContent = s.calls;
        $('tris').textContent = s.tris > 1e6 ? `${(s.tris / 1e6).toFixed(2)} M` : `${(s.tris / 1e3).toFixed(0)} K`;
      }
      Object.assign(perf, { n: 0, t0: now, lo: Infinity, hi: 0 });
      drawGraph();
    }
    if ((slow += dt) > 0.25) {
      slow = 0;
      const t = new Date(sim.t), date = `${t.getFullYear()} · ${pad(t.getMonth() + 1)} · ${pad(t.getDate())}`, time = `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
      $('date').textContent = date;
      $('time').textContent = time;
      if (focus) $('iLive').innerHTML = kv(app.liveRows(focus));
      if ($('datePop').classList.contains('open')) syncDateInput();
      const idle = settings.autohide && app.isTour() && now - lastInput > 4000 && !drawer.classList.contains('open');
      body.classList.toggle('idle', idle);
      if (settings.idleTour && entered && !app.isTour() && now - lastInput > 90000 && !drawer.classList.contains('open')) app.toggleTour(true);
    }
    if (app.isTour()) {
      $('cBar').style.transform = `scaleX(${app.tourProgress()})`;
    }
  }
  function drawGraph() {
    const W = graph.width, H = graph.height;
    g2d.clearRect(0, 0, W, H);
    const max = Math.max(62, ...hist);
    g2d.beginPath();
    hist.forEach((f, i) => { const x = (i / (hist.length - 1)) * W, y = H - 3 - (Math.min(f, max) / max) * (H - 6); i ? g2d.lineTo(x, y) : g2d.moveTo(x, y); });
    g2d.lineWidth = 2.2;
    g2d.lineJoin = 'round';
    g2d.strokeStyle = perf.fps >= 50 ? 'rgba(143,240,184,.85)' : perf.fps >= 28 ? 'rgba(255,210,122,.85)' : 'rgba(255,125,110,.85)';
    g2d.stroke();
  }

  const safe = { dx: 0, dy: 0 };
  function updateSafe() {
    const W = innerWidth, H = innerHeight, top = 70;
    let left = 0, right = W, bottom = H - $('dock').offsetHeight - 30;
    const r = info.getBoundingClientRect(), infoOn = entered && !body.classList.contains('hide-ui') && !body.classList.contains('idle');
    const drawerOn = drawer.classList.contains('open');
    if (drawerOn) right = W - drawer.offsetWidth - 24;
    else if (infoOn && W > 760) right = r.left - 12;
    if (infoOn && W <= 760) bottom = r.top - 12;
    if (body.classList.contains('hide-ui') || body.classList.contains('idle')) { right = W; bottom = H; }
    // 漫游字幕在左下角：主体略向右让开
    if (cap.classList.contains('show') && W > 760) left = Math.min(cap.offsetWidth, W * 0.3) * 0.55;
    safe.dx = (left + right) / 2 - W / 2;
    safe.dy = (top + bottom) / 2 - H / 2;
  }
  setInterval(updateSafe, 250);

  syncTime();
  sync();
  return {
    safe,
    onFocus,
    onTour(on) {
      $('bTour').classList.toggle('on', on);
      // 漫游时字幕承担介绍，收起信息卡；退出时恢复原状
      if (on) { infoWasCollapsed = info.classList.contains('collapsed'); info.classList.add('collapsed'); }
      else info.classList.toggle('collapsed', infoWasCollapsed);
      if (!on) { clearTimeout(capTimer); cap.classList.remove('show'); }
      toast(L(on ? '自动漫游开始 · 点击画面或按 T 退出' : '已退出漫游'));
    },
    onStop,
    onOrbit(on) { $('iActions').querySelector('[data-act=orbit]')?.classList.toggle('on', on); },
    sync, progress, ready, frame, toast, syncTime,
    get fps() { return Math.round(perf.fps); },
  };
}
