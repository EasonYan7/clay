# Clay

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/简体中文-当前语言-6D4AFF?style=for-the-badge" alt="简体中文" /></a>
  <a href="./README.en.md"><img src="https://img.shields.io/badge/English-Read_in_English-EDEDF0?style=for-the-badge&amp;labelColor=26262B" alt="English" /></a>
</p>

<p align="center"><strong>把 AI 生成的 HTML 变成人人可编辑的画布。</strong><br />一款面向非技术用户的 macOS 桌面应用。</p>

<p align="center">
  <img src="docs/screenshots/editor.png" width="800" alt="Clay 编辑器界面" />
</p>

## 这是什么

AI 生成的 HTML/CSS 页面，对不写代码的人（产品经理、运营、市场）来说常常是个黑盒——想改一个字号、挪一下按钮，只能回去重新 prompt AI，越改越乱；而传统可视化工具通常又无法直接接手这些任意 HTML。

Clay 就是补这段：把任意来源的 HTML 粘贴或打开进来，拆解成一棵可点选的组件树，在可视化画布里拖拽、改样式、改文字，再导出一份干净的、原始代码几乎零改动的 HTML（或者直接出一张 PDF）。

## 核心功能

- **智能拆解**：粘贴或打开 HTML，自动解析出语义化图层树（页头、导航、卡片 1/2/3……），不是一坨匿名 `div`
- **所见即所得编辑**：点选任意元素调整字号、颜色、圆角、阴影和间距，改动实时生效，并回显当前真实值
- **中英文界面**：首次启动跟随系统语言，顶部可随时切换中文 / English；主页、编辑器、图层、历史、弹窗与系统菜单保持同一语言
- **拖拽与结构**：按住元素直接拖动换位（自动吸附，不产生绝对定位）；选中元素可以“同级复制”或“下方加空白同类”
- **双击编辑**：双击文字直接修改内容，双击图片即可替换
- **设备预览**：电脑、平板、手机三种视图一键切换
- **历史记录**：时间线式记录每一步修改，用当前界面语言给出人话描述，点哪条就跳回哪条
- **深浅色自动匹配**：根据页面本身的配色自动切换编辑器皮肤
- **直观保存**：⌘S 直接存回源文件，⇧⌘S 另存为且不改动原稿
- **外部文件同步**：源文件被其他软件修改后自动刷新；双方都有修改时先询问，不静默覆盖
- **干净导出**：原始 CSS 逐字保留，Clay 的改动单独成段；Tailwind 页面可提取为静态 CSS，交互脚本在导出时还原
- **PDF 导出**：按当前电脑、平板或手机视图生成连续单页 PDF
- **最近编辑**：主页展示最近打开过的文件，正常退出后下次仍从主页开始

## 界面一览

<table>
<tr>
<td width="50%">
<img src="docs/screenshots/home.png" alt="主页" />
<p align="center"><sub>首次使用：手绘引导页，箭头直接指向工具栏对应功能</sub></p>
</td>
<td width="50%">
<img src="docs/screenshots/history.png" alt="历史记录面板" />
<p align="center"><sub>历史记录：每一步修改都是人话描述，可以跳回任意时刻</sub></p>
</td>
</tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile.png" width="360" alt="手机设备预览" />
  <br/><sub>设备预览：一键切到手机视图，响应式样式实时生效</sub>
</p>

## 技术栈

- **Electron 33** + **electron-builder**：桌面运行与 macOS 打包
- **GrapesJS**：本地内置编辑器底座，不依赖在线加载；在其上实现导入、导出、拖拽、历史和未保存状态
- 纯原生 JavaScript 渲染层，无前端构建步骤和框架依赖
- Tailwind Play CDN 仅用于画布内实时预览，导出时尽量静态提取替换

## 本地运行

```bash
cd app
npm install
npm start
```

## 打包

```bash
cd app
npm run dist
```

产物在 `app/dist/`。默认生成当前 Mac 架构对应的应用；当前未做代码签名与公证，分发给他人需自行签名，或由对方手动允许运行。

## 测试

```bash
cd app
npm run test:editor
npm run test:fidelity
npm run test:i18n
```

三组回归分别覆盖编辑与退出行为、导入/画布/导出保真，以及中文与英文界面切换。

## 项目结构

```
app/
  main.js              # Electron 主进程：文件读写、原生对话框、PDF 渲染
  preload.js           # 主进程 ↔ 渲染进程的受控桥接
  renderer/
    app.js             # 应用装配层（状态管理、UI 接线、历史/未保存状态）
    i18n.js            # 中英文词典、语言状态与静态文案绑定
    importer.js        # HTML 解析 → 组件树，含 Tailwind 检测、语义化命名
    exporter.js        # 导出：原始 CSS 保留 + Clay 改动单独成段
    styles.css         # 设计系统，含手绘风格主页与最近编辑卡片
    vendor/            # 本地内置的 GrapesJS
  tests/               # 编辑行为、保真与多语言回归
docs/
  grapesjs-findings.md # 选型阶段对 GrapesJS 原生能力的实测记录
```

## 添加新语言

界面文案集中在 `app/renderer/i18n.js`。新增语言时扩展 `MESSAGES`，再在顶部语言切换器加入对应入口；动态文案使用 `t(key, vars)`，静态 HTML 使用 `data-i18n` 系列属性。提交前运行 `npm run test:i18n`，验证主页、编辑器内部文案和退出弹窗。

## 已知限制

- 未做代码签名/公证
- 页面若自带 `prefers-color-scheme: dark` 的深色模式变体，Clay 的样式改动目前会覆盖它
- URL 导入（粘贴链接直接拉取远程页面）尚未支持，目前仅支持本地文件或粘贴代码
