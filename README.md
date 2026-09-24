# 太阳系 · 实时模拟

**在线体验：<https://anrlm.github.io/solar-system/>**

浏览器里实时运行的太阳系：按真实轨道根数计算天体位置，电影级光影与后期，自适应配乐，整个页面是一个可离线打开的 HTML 文件。

A real-time, cinematic Solar System in a single offline HTML file — planet positions from real orbital elements, procedural adaptive soundtrack, Chinese / English UI (press <kbd>L</kbd>).

## 特性

- **真实天象**：行星用 JPL 近似轨道根数，矮行星与彗星用 JPL 小天体数据库根数；月球用 Meeus 解析历表；自转与极轴用 IAU 模型；日月食在真实尺度下计算
- **39 个天体**：太阳、八大行星、21 颗卫星、谷神星、冥王星与 7 颗著名彗星；彗星的离子尾与尘埃尾随日距生长
- **画面**：真实贴图叠加程序化细节、大气散射、土星环阴影、体积光、泛光、镜头光晕、ACES 色调映射；四档画质预设，实时帧数
- **自动漫游**：19 站电影化镜头，闲置 90 秒自动开始
- **配乐**：Web Audio 实时合成，随聚焦天体切换调性与音色
- **中英文切换**：顶栏按钮或 <kbd>L</kbd> 键，首次访问跟随浏览器语言

快捷键：拖动旋转、滚轮缩放、单击聚焦；<kbd>O</kbd> 全景、<kbd>T</kbd> 漫游、<kbd>空格</kbd> 暂停、<kbd>[</kbd> <kbd>]</kbd> 调速、<kbd>?</kbd> 全部快捷键。

## 构建

```bash
npm install
npm run build        # 输出 solar-system.html（约 10 MB，内联全部代码与贴图）
npm test             # 天文校验、冒烟、配乐、界面流程（需要本机 Chrome）
```

源码在 `src/`：`main.js` 引擎、`shaders.js` 着色器、`ui.js` 界面、`audio.js` 配乐、`data.js` / `data-en.js` 天体资料、`i18n.js` 中英文。
推送到 `main` 后由 GitHub Actions 构建并发布到 Pages。

## 数据与素材

- 行星贴图 © [Solar System Scope](https://www.solarsystemscope.com/textures/)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，基于 NASA 数据（转为 WebP，见 `tools/fetch-textures.mjs`）
- 月球高程：NASA Scientific Visualization Studio
- 恒星：Hipparcos 星表；银河轮廓：[d3-celestial](https://github.com/ofrohn/d3-celestial)
- 海岸线：Natural Earth（经 [world-atlas](https://github.com/topojson/world-atlas)）
- 渲染：[three.js](https://threejs.org/)

## 许可证

代码以 [MIT](LICENSE) 许可证发布。第三方素材（上方“数据与素材”所列贴图与数据）保留其各自的许可证，例如行星贴图须按 CC BY 4.0 署名。
