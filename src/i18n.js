// 中英文切换：中文即原文与键；英文查 EN 词典（找不到则保留中文）
// 页面上的静态文字（文本节点与 title / aria-label）在首次切换时登记原文，之后按语言整体替换；动态文字由调用处用 L() 生成
import { BODIES_EN, TOUR_EN } from './data-en.js';

const KEY = 'solar.lang';
let lang = localStorage.getItem(KEY) || (/^zh\b/i.test(navigator.language) ? 'zh' : 'en');
export const isEn = () => lang === 'en';
export const getLang = () => lang;

// L('距太阳 {0} AU', r)：按当前语言取文字并代入参数
export function L(zh, ...args) {
  const s = lang === 'en' ? EN[zh] ?? zh : zh;
  return args.length ? s.replace(/\{(\d)\}/g, (_, i) => args[i]) : s;
}
// 天体文字：名称用 data.js 里的英文名；类型、简介、参数用 data-en.js
export const nameOf = (b) => (lang === 'en' ? b.def.en : b.def.name);
export const textOf = (def, field) => (lang === 'en' ? BODIES_EN[def.id]?.[field] ?? def[field] : def[field]);
export const textEn = (def, field) => BODIES_EN[def.id]?.[field] ?? def[field];
export const tourFact = (id, zh) => (lang === 'en' ? TOUR_EN[id] ?? zh : zh);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const yearMonth = (t) => { const d = new Date(t); return lang === 'en' ? `${MON[d.getMonth()]} ${d.getFullYear()}` : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`; };

const listeners = [];
export const onLang = (fn) => listeners.push(fn);
export function setLang(l) {
  lang = l;
  localStorage.setItem(KEY, l);
  applyDom();
  listeners.forEach((fn) => fn(l));
}

// ---------------------------------------------------------------- 静态文字
const HAN = /[一-鿿]/;
let reg = null;
function register() {
  reg = { text: [], attr: [], html: [] };
  const walk = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest('script, style, [data-i18n-html]') || !HAN.test(n.data) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n; (n = walk.nextNode());) reg.text.push([n, n.data]);
  for (const el of document.querySelectorAll('[title], [aria-label]'))
    for (const a of ['title', 'aria-label']) if (HAN.test(el.getAttribute(a) || '')) reg.attr.push([el, a, el.getAttribute(a)]);
  for (const el of document.querySelectorAll('[data-i18n-html]')) reg.html.push([el, el.innerHTML]);
}
export function applyDom() {
  if (!reg) register();
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  // 保留原文首尾空白，只替换中间的文字
  for (const [n, zh] of reg.text) n.data = zh.replace(/\S[\s\S]*\S|\S/, (m) => L(m.replace(/\s+/g, ' ')));
  for (const [el, a, zh] of reg.attr) el.setAttribute(a, L(zh));
  for (const [el, zh] of reg.html) el.innerHTML = lang === 'en' ? HTML_EN[el.id] ?? zh : zh;
}

// 整段替换（段内有链接等标记）
const HTML_EN = {
  brandSub: 'REAL-TIME SIMULATION',
  credits: 'Planet textures © <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>), based on NASA data · Lunar elevation NASA SVS · Stars from the Hipparcos catalogue · Milky Way outline d3-celestial · Coastlines Natural Earth',
};

const EN = {
  // 页面与顶栏
  '太阳系 · 实时模拟': 'Solar System · Real-time Simulation',
  '太阳系三维视图': '3D view of the Solar System',
  '太阳系': 'Solar System',
  '时间倒流（R）': 'Reverse time (R)', '时间倒流': 'Reverse time',
  '暂停 / 继续（空格）': 'Pause / resume (Space)', '暂停或继续': 'Pause or resume',
  '跳转日期': 'Jump to date', '时间流速': 'Time rate', '回到当前时刻': 'Back to now', '现在': 'Now',
  '性能详情': 'Performance',
  '音乐（M）': 'Music (M)', '音乐开关': 'Music on / off',
  '设置（S）': 'Settings (S)', '设置': 'Settings',
  '隐藏界面（H）': 'Hide UI (H)', '隐藏界面': 'Hide UI',
  '全屏（F）': 'Fullscreen (F)', '全屏': 'Fullscreen',
  '快捷键（?）': 'Shortcuts (?)', '快捷键': 'Keyboard shortcuts', '关闭快捷键': 'Close shortcuts',
  '切换到英文（L）': 'Switch to Chinese (L)',
  // 性能与日期弹层
  '渲染性能': 'Rendering', '平均帧时间': 'Avg frame time', '帧时间范围': 'Frame time range', '渲染分辨率': 'Render resolution', '绘制调用': 'Draw calls', '三角形': 'Triangles',
  '跳转到时间': 'Jump to time', '−1 年': '−1 yr', '−1 月': '−1 mo', '+1 月': '+1 mo', '+1 年': '+1 yr', '天象': 'Events',
  '月全食': 'Total lunar eclipse', '日全食 · 格陵兰—西班牙': 'Total solar eclipse · Greenland–Spain', '日全食 · 北非—中东': 'Total solar eclipse · North Africa–Middle East',
  '恩克彗星过近日点': 'Comet Encke at perihelion', '海尔-波普大彗星': 'Great Comet Hale-Bopp', '哈雷彗星回归': "Halley's Comet returns",
  // 信息卡与底栏
  '收起 / 展开（I）': 'Collapse / expand (I)', '收起信息卡': 'Collapse info card', '实时数据': 'Live data', '基本参数': 'Key facts',
  '全景（O）': 'Overview (O)', '全景': 'Overview', '天体': 'Bodies', '自动漫游（T）': 'Auto tour (T)', '自动漫游': 'Auto tour', '漫游': 'Tour',
  '矮行星': 'Dwarf planets', '彗星': 'Comets',
  '下次过近日点 · {0}': 'Next perihelion · {0}', '距太阳 {0} AU · {1}': '{0} AU from the Sun · {1}',
  '彗核半径约 {0} km': 'Nucleus ≈ {0} km radius', '其他天体的尺寸参照': 'Size reference for all bodies', '日球层直径约 240 AU': 'Heliosphere ≈ 240 AU across',
  '直径是地球的 {0} 倍': '{0}× Earth’s diameter', '直径是地球的 {0}%': '{0}% of Earth’s diameter',
  '环绕': 'Orbit', '返回{0}': 'Back to {0}', '跳到下次近日点': 'Jump to next perihelion', '已跳到下次过近日点': 'Jumped to the next perihelion',
  '{0}距太阳 {1} AU，彗核冻结、尚未形成彗尾——点「跳到下次近日点」即可观看': '{0} is {1} AU from the Sun: its nucleus is frozen and has no tail yet. Press “Jump to next perihelion” to see it.',
  '距太阳': 'From the Sun', '距地球': 'From Earth', '光行时间': 'Light time', '轨道速度': 'Orbital speed', '{0}距太阳': '{0}',
  // 时间条
  '已暂停': 'Paused', '已回到当前时刻': 'Back to the present',
  '实时': 'Real time', '1 分钟/秒': '1 min/s', '10 分钟/秒': '10 min/s', '1 小时/秒': '1 hr/s', '6 小时/秒': '6 hr/s', '1 天/秒': '1 day/s',
  '1 周/秒': '1 week/s', '1 月/秒': '1 month/s', '3 月/秒': '3 months/s', '1 年/秒': '1 year/s',
  // 设置抽屉
  '关闭设置': 'Close settings', '画质': 'Quality', '显示': 'Display', '音频': 'Audio', '关于': 'About', '预设': 'Presets', '细调': 'Fine-tune',
  '低': 'Low', '1K 纹理 · 性能优先': '1K textures · Speed first', '中': 'Medium', '2K 纹理 · 均衡': '2K textures · Balanced',
  '高': 'High', '4K 纹理 · 推荐': '4K textures · Recommended', '极致': 'Ultra', '原生分辨率 · 8× 抗锯齿': 'Native resolution · 8× AA', '画质：{0}': 'Quality: {0}',
  '纹理精度': 'Texture detail', '1K · 快速': '1K · Fast', '2K · 均衡': '2K · Balanced', '4K · 精细': '4K · Fine',
  '抗锯齿': 'Anti-aliasing', '关闭': 'Off', '曝光': 'Exposure', '镜头特效': 'Lens effects',
  '泛光': 'Bloom', '体积光': 'God rays', '镜头光晕': 'Lens flare', '胶片质感': 'Film look', '颗粒、暗角与轻微色散': 'Grain, vignette and slight chromatic aberration',
  '地表微细节': 'Surface micro-detail', '近距离时补充纹理之外的起伏': 'Extra relief beyond the textures up close',
  '场景': 'Scene', '轨道线': 'Orbits', '天体标签': 'Labels', '小行星带': 'Asteroid belts',
  '界面': 'Interface', '闲置时自动漫游': 'Auto tour when idle', '90 秒无操作后自动开始漫游': 'Starts the tour after 90 s without input',
  '漫游时自动隐藏界面': 'Auto-hide UI during tour', '静置 4 秒后淡出，只保留字幕与帧数': 'Fades after 4 s of inactivity, leaving captions and FPS',
  '配乐': 'Soundtrack', '背景音乐': 'Background music', '音量': 'Volume', '随天体变化': 'Follow the focused body', '聚焦不同天体时切换调性与音色': 'Changes key and timbre with the body in focus', '飞行音效': 'Flight sound effects',
  '配乐由浏览器实时合成：柔和的弦垫、低音、如星光闪烁的钟声与宇宙风，经长混响融为一体。每次播放都不重复；时间流速越快钟声越密，靠近太阳时音色更明亮。':
    'The soundtrack is synthesised live in your browser: soft string pads, bass, starlight-like bells and cosmic wind, blended in a long reverb. It never repeats; bells grow denser as time speeds up, and the timbre brightens near the Sun.',
  '行星位置按 JPL 轨道根数实时计算，月球使用解析历表，自转采用 IAU 模型；日月食在真实尺度下计算。为了看得见，画面中的天体半径被放大、距离被压缩。':
    'Planet positions are computed live from JPL orbital elements, the Moon from an analytical ephemeris and rotation from the IAU model; eclipses are computed at true scale. To keep everything visible, bodies are enlarged and distances compressed.',
  '数据与素材': 'Data & assets',
  '音乐已开启': 'Music on', '音乐已关闭': 'Music off',
  // 漫游字幕
  '上一站（←）': 'Previous stop (←)', '上一站': 'Previous stop', '停留 / 继续': 'Hold / continue', '停留或继续': 'Hold or continue',
  '下一站（→）': 'Next stop (→)', '下一站': 'Next stop', '退出漫游（T）': 'Exit tour (T)', '退出漫游': 'Exit tour',
  '自动漫游 · 第 {0} 站 / 共 {1} 站': 'Auto tour · Stop {0} of {1}', '已停留在这一站': 'Holding at this stop', '继续漫游': 'Tour resumed',
  '自动漫游开始 · 点击画面或按 T 退出': 'Auto tour started · click or press T to exit', '已退出漫游': 'Tour ended',
  // 快捷键面板
  '拖动': 'Drag', '旋转视角': 'Rotate view', '滚轮': 'Scroll', '缩放': 'Zoom', '单击': 'Click', '聚焦天体': 'Focus a body', '切换天体': 'Switch body',
  '空格': 'Space', '暂停 / 继续': 'Pause / resume', '调节时间流速': 'Change time rate', '漫游上一站 / 下一站': 'Previous / next tour stop', '中英文切换': 'Chinese / English',
  // 提示与加载
  '按 H 恢复界面': 'Press H to bring the UI back', '正在重新生成行星表面': 'Regenerating planet surfaces', '点击画面任意处即可开启音乐': 'Click anywhere to start the music',
  '正在初始化': 'Initialising',
  // 搜索、距离工具、星座
  '搜索（/）': 'Search (/)', '搜索': 'Search', '搜索天体': 'Search bodies', '搜索天体、卫星、彗星…': 'Search planets, moons, comets…', '没有找到“{0}”': 'No results for “{0}”',
  '距离工具': 'Distance tool', '关闭距离工具': 'Close distance tool', '交换起点与终点': 'Swap start and target', '起点': 'FROM', '终点': 'TO',
  '点击画面中的天体，或点此搜索': 'Click a body in the scene, or search', '选择起点': 'Choose the start…', '选择终点': 'Choose the target…', '测距': 'Measure', '距离': 'Distance',
  '星座连线': 'Constellations', '88 个星座的连线与名称': 'Lines and names of the 88 constellations', '星座连线已开启': 'Constellations on', '星座连线已关闭': 'Constellations off', '正在生成行星表面': 'Generating planet surfaces', '正在载入星表与地图数据': 'Loading star catalogue and map data',
};
