# Clay

**把 AI 生成的 HTML 变成人人可编辑的画布。** 一款 macOS 桌面应用。

<p align="center">
  <img src="docs/screenshots/editor.png" width="800" alt="Clay 编辑器界面" />
</p>

## 这是什么

用 v0、Bolt、Lovable 这类工具生成的 HTML/CSS 页面,对不写代码的人(产品经理、运营、市场)来说是个黑盒——想改一个字号、挪一下按钮,只能回去重新 prompt AI,越改越乱;而 Webflow、Framer 这类可视化工具又吃不进这些工具吐出来的任意 HTML。

Clay 就是补这段:把任意来源的 HTML 粘贴或打开进来,拆解成一棵可点选的组件树,像用 Figma 一样拖拽、改样式、改文字,再导出一份干净的、原始代码几乎零改动的 HTML(或者直接出一张 PDF)。

## 核心功能

- **智能拆解**:粘贴或打开 HTML,自动解析出语义化的中文图层树(页头/导航/卡片 1/2/3……),不是一坨匿名 div
- **所见即所得编辑**:点选任意元素改样式(字号、颜色、圆角、阴影、间距……),中文面板,改动实时生效,取值自动回显当前真实值
- **拖拽 & 结构**:按住元素直接拖动换位(自动吸附,不产生绝对定位);选中元素可以"同级复制"或"下方加空白同类"
- **双击编辑**:双击文字直接改内容,双击图片换一张
- **设备预览**:电脑 / 平板 / 手机三种视图,一键切换
- **历史记录**:Photoshop 式的时间线,每一步修改都有中文描述("调整 标题 的字号"),点哪条就跳回哪条
- **深浅色自动匹配**:根据页面本身的配色自动切换编辑器的深浅色皮肤
- **保存语义对齐 Word**:⌘S 直接存回源文件,⇧⌘S 另存为不动原稿
- **干净导出**:原始 CSS 逐字保留、Clay 的改动单独成段,不会被重新序列化成臃肿的长写属性;Tailwind 页面自动提取成静态 CSS,离线可用;页面里的交互脚本原样保留
- **PDF 导出**:整页一张连续长图,像素级还原当前选中视图(电脑用画布实际宽度、平板 768px、手机 375px)
- **拖拽打开**:直接把 HTML 文件从访达拖进窗口就能打开
- **最近编辑**:主页展示最近打开过的文件,手绘风格卡片

## 界面一览

<table>
<tr>
<td width="50%">
<img src="docs/screenshots/home.png" alt="主页" />
<p align="center"><sub>首次使用:手绘引导页,箭头直接指向工具栏对应功能</sub></p>
</td>
<td width="50%">
<img src="docs/screenshots/history.png" alt="历史记录面板" />
<p align="center"><sub>历史记录:每一步修改都是人话描述,可以跳回任意时刻</sub></p>
</td>
</tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile.png" width="360" alt="手机设备预览" />
  <br/><sub>设备预览:一键切到手机视图,响应式样式实时生效</sub>
</p>

## 技术栈

- **Electron 33** + **electron-builder**(打包 Universal 二进制,同时支持 Apple Silicon 与 Intel)
- **GrapesJS**(本地 vendored,不依赖网络)作为编辑器底座,叠加大量自研的导入 / 导出 / 拖拽 / 历史 / 脏状态逻辑
- 纯原生 JS 渲染层,无构建步骤,无框架依赖
- Tailwind Play CDN 仅用于画布内实时预览,导出时静态提取替换掉

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

产物在 `app/dist/`。当前未做代码签名与公证,分发给他人需自行处理或让对方手动允许运行。

## 项目结构

```
app/
  main.js              # Electron 主进程:文件读写、原生对话框、PDF 渲染
  preload.js           # 主进程 ↔ 渲染进程的受控桥接
  renderer/
    app.js             # 应用装配层(状态管理、UI 接线、历史/脏状态逻辑)
    importer.js         # HTML 解析 → 组件树,含 Tailwind 检测、语义化命名
    exporter.js          # 导出:原始 CSS 逐字保留 + Clay 改动单独成段
    styles.css            # 设计系统(含手绘风格的主页/最近编辑卡片)
    vendor/                # 本地 vendored 的 GrapesJS
docs/
  grapesjs-findings.md     # 选型阶段对 GrapesJS 裸用的实测缺陷记录
```

## 已知限制

- 未做代码签名/公证
- 页面若自带 `prefers-color-scheme: dark` 的深色模式变体,Clay 的样式改动目前会覆盖它
- URL 导入(粘贴链接直接拉取远程页面)尚未支持,目前仅支持本地文件 / 粘贴代码
