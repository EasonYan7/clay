# Clay

<p align="center">
  <a href="./README.md"><img src="https://img.shields.io/badge/简体中文-当前语言-6D4AFF?style=for-the-badge" alt="简体中文" /></a>
  <a href="./README.en.md"><img src="https://img.shields.io/badge/English-Read_in_English-EDEDF0?style=for-the-badge&amp;labelColor=26262B" alt="English" /></a>
</p>

<p align="center">
  <strong>把 AI 生成的 HTML，变成人人可编辑的画布。</strong><br />
  打开页面、直接调整、干净导出——不需要先学会写代码。
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-当前支持-111111?style=flat-square&amp;logo=apple" />
  <img alt="Electron 33" src="https://img.shields.io/badge/Electron-33-47848F?style=flat-square&amp;logo=electron&amp;logoColor=white" />
  <img alt="Local first" src="https://img.shields.io/badge/Local--first-无需账号-6D4AFF?style=flat-square" />
  <img alt="Languages" src="https://img.shields.io/badge/UI-中文%20%7C%20English-2EA44F?style=flat-square" />
</p>

<p align="center">
  <img src="docs/screenshots/editor.png" width="880" alt="Clay 可视化 HTML 编辑器" />
</p>

> [!NOTE]
> Clay 目前处于早期预览阶段，仅支持 macOS，尚未提供签名安装包。你可以按照下方步骤从源码运行。

## 为什么需要 Clay？

AI 很擅长生成页面，但一次生成通常不是终点。改一句文案、移动一张卡片、调整手机布局，都可能需要再次描述需求、等待生成，并承担其他部分被意外改写的风险。

Clay 让这一步更直接：把已有 HTML 当作设计稿打开，在画布中点选、拖动和修改，确认效果后保存回原文件，或者导出一份可继续交给开发的 HTML。

### Clay 适合你，如果你想要

- 修改 AI 生成页面中的文案、图片、颜色、字号和间距
- 不写 CSS，也能调整卡片顺序和页面结构
- 在电脑、平板和手机尺寸下检查响应式效果
- 保留现有 HTML/CSS，而不是每次重新生成整个页面
- 在设计、产品、运营与开发之间传递一份可继续编辑的文件

## 三步完成一次修改

1. **打开**：选择本地 HTML 文件，或直接粘贴 HTML 代码。
2. **编辑**：在画布中点选元素，修改内容与样式，拖动调整顺序。
3. **交付**：保存回原文件、另存为新的 HTML，或导出 PDF。

<table>
<tr>
<td width="50%">
<img src="docs/screenshots/home.png" alt="Clay 主页" />
<p align="center"><sub>打开文件或粘贴代码，最近项目随时可再次进入</sub></p>
</td>
<td width="50%">
<img src="docs/screenshots/history.png" alt="Clay 历史记录" />
<p align="center"><sub>每次修改都有可读记录，并能回到之前的状态</sub></p>
</td>
</tr>
</table>

<p align="center">
  <img src="docs/screenshots/mobile.png" width="420" alt="Clay 手机预览" />
  <br /><sub>在手机视图中检查响应式布局</sub>
</p>

## 你可以做什么

| 能力 | 用户体验 |
| --- | --- |
| 打开任意 HTML | 使用本地文件或粘贴代码，不绑定特定生成工具 |
| 语义化图层 | 自动识别页头、导航、卡片等结构，减少匿名 `div` 带来的理解成本 |
| 可视化样式 | 调整字体、颜色、边框、圆角、阴影、间距与布局 |
| 直接编辑 | 双击文字修改内容，双击图片完成替换 |
| 结构拖拽 | 在页面中移动元素，并保持正常文档布局 |
| 多设备预览 | 在电脑、平板与手机视图之间切换 |
| 修改历史 | 用人话记录操作，并跳回任意历史状态 |
| 外部文件同步 | 其他软件改动源文件后自动刷新；发生冲突时先询问 |
| 保真导出 | 尽量保留原始 CSS、页面结构与脚本，并把 Clay 改动独立输出 |
| 双语界面 | 中文与 English 覆盖主页、编辑器、弹窗和 macOS 菜单 |

## 本地优先

Clay 不要求登录账号，也不会把你打开的 HTML 主动上传到服务器。文件读取、编辑历史和保存都在本机完成。

如果原页面引用了在线字体、图片、样式或脚本，预览这些资源时仍可能访问其原始网络地址。Tailwind Play CDN 页面也可能在预览阶段使用网络。

## 快速开始

### 环境要求

- macOS
- Node.js 与 npm
- Git（用于克隆仓库）

### 从源码运行

```bash
git clone https://github.com/EasonYan7/clay.git
cd clay/app
npm install
npm start
```

启动后可点击“打开 HTML 文件”，也可以直接将 `.html` 文件拖入窗口。

### 打包 macOS 应用

```bash
cd app
npm run dist
```

构建产物位于 `app/dist/`。当前产物未做代码签名与公证，macOS 可能阻止直接打开。

## 当前支持范围

| 项目 | 状态 |
| --- | --- |
| macOS | ✅ 当前支持 |
| Windows / Linux | ⏳ 尚未适配与验证 |
| 本地 HTML 文件 | ✅ 支持 |
| 粘贴 HTML 代码 | ✅ 支持 |
| 通过 URL 导入网页 | ⏳ 暂不支持 |
| 导出 HTML / PDF | ✅ 支持 |
| 已签名安装包 | ⏳ 暂未提供 |

## 常见问题

<details>
<summary><strong>Clay 会重写我的全部代码吗？</strong></summary>
<br />
Clay 会尽量保留原始 HTML、CSS 与脚本，只把画布中的修改单独写入导出结果。复杂页面仍建议先保留源文件副本，并在导出后进行浏览器验收。
</details>

<details>
<summary><strong>可以编辑 Tailwind 页面吗？</strong></summary>
<br />
可以。Clay 会识别常见 Tailwind 页面并尽量生成可离线使用的样式。包含函数、插件或运行时逻辑的复杂配置可能无法完整静态化。
</details>

<details>
<summary><strong>为什么部分动态内容看不到？</strong></summary>
<br />
为了安全和可预测性，画布不会执行任意业务脚本。依赖 JavaScript 在运行时生成的内容，可能需要先转换为静态 HTML 再编辑。
</details>

<details>
<summary><strong>可以在 Windows 上运行吗？</strong></summary>
<br />
当前版本只在 macOS 上开发和验证。底层技术支持跨平台，但 Windows 与 Linux 仍需要适配、打包和回归测试。
</details>

## 开发与测试

```bash
cd app
npm run test:editor
npm run test:fidelity
npm run test:i18n
```

- `test:editor`：编辑、历史、拖拽、保存与退出行为
- `test:fidelity`：导入、画布渲染和导出结果保真
- `test:i18n`：中文与英文界面、动态文案和弹窗

<details>
<summary><strong>查看项目结构</strong></summary>

```text
app/
  main.js              # Electron 主进程、文件、菜单、对话框与 PDF
  preload.js           # 主进程与渲染进程之间的受控桥接
  renderer/
    app.js             # 应用状态、编辑器接线、历史与保存状态
    i18n.js            # 中英文词典和语言状态
    importer.js        # HTML 解析、Tailwind 检测与语义化命名
    exporter.js        # 面向保真的 HTML 导出
    styles.css         # Clay 界面设计系统
    vendor/            # 本地内置的 GrapesJS
  tests/               # 编辑、保真与多语言回归
docs/
  screenshots/         # README 界面截图
  grapesjs-findings.md # 编辑器选型阶段的实测记录
```

</details>

## 参与项目

Clay 仍在早期阶段，真实页面和明确的复现步骤尤其有价值。欢迎通过 [Issues](https://github.com/EasonYan7/clay/issues) 提交：

- 无法正确打开或导出的 HTML 示例
- 画布与浏览器显示不一致的情况
- 拖拽、历史、保存和文件同步问题
- Windows / Linux 适配建议
- 新语言翻译与文案改进

提交问题时，请尽量附上 macOS 版本、操作步骤、预期结果和实际结果。涉及内部页面时，请先删除敏感信息。

## 路线图

- 提供签名、公证的 macOS 安装包与 GitHub Releases
- 扩大复杂 CSS、Tailwind 配置和动态页面的保真覆盖
- 完善 Windows / Linux 支持
- 建立更完整的贡献指南与开源发布流程

## 开源状态

仓库目前公开可见，但尚未添加正式开源许可证。在许可证确定前，代码默认保留全部权利。计划在正式发布前补充许可证与贡献约定。

---

如果 Clay 对你有帮助，欢迎点一个 ⭐，也欢迎带着真实页面来提出问题。
