# Clay Windows A 主线升级报告

验证日期：2026-10-22（UTC+08:00）。基线：`585a7f3` / Clay 0.1.4。

## 当前交付

- **A 是后续 Windows 主线**：`C:\dev\clay-a`，分支 `win-port-a`。B 不再作为维护和交付目标；B 的目录、分支、文件和任务均未修改或删除，本轮没有运行 B。
- 双击 `C:\dev\clay-a\START-WINDOWS.cmd` 启动已重建的 A。实际程序是 `C:\dev\clay-a\app\dist\win-unpacked\Clay.exe`。
- ZIP：`C:\dev\clay-a\app\dist\Clay-0.1.4-win-x64.zip`，146,773,230 字节。SHA-256：`71eb91a95c1c39065d84037ca6f142a467024bc1de0ff6eaec7359dce06dd67b`。
- 初次验证交付时未提交、未 push；后续经用户授权，将源码、测试、本文档与截图提交到 `pissyc-pixel:win-port-a`，向上游 `EasonYan7/clay` 的 `main` 发起 PR，fork 仅承载贡献分支。安装包、原始日志及隔离用户数据仅保留本地。无新增应用依赖、原生模块、系统软件、注册表或系统设置改动。
- 源码回归和打包程序的默认 / 150% 缩放均验证；ASAR 内 8 个关键文件逐字节匹配当前源码，包括按需加载器与图标，避免交付旧 EXE 配新源码。

## 界面与体验

Windows 的系统标题栏、常驻菜单和应用工具栏合并为 **48 CSS px 的单行顶栏**。采用 Electron 的原生窗口按钮覆盖层，不手写最小化 / 最大化 / 关闭按钮；仍支持原生系统菜单、拖动区双击、最大化还原、全屏和 Windows 吸附。

- 菜单放在左上角，可点击或按 `Alt` 打开；`F10` 也接入同一入口。菜单角色和原有快捷键保留。
- 深浅主题同步到窗口按钮区域。**不修改 `nativeTheme.themeSource`**，避免切换应用外壳时意外改变导入页面的 `prefers-color-scheme`。
- 顶栏显示当前文件和保存状态；任务切换器的窗口标题同步文件名和未保存标记。首页禁用需要文档的操作，按钮增加键盘焦点反馈。
- PDF 导出显示忙碌状态，阻止重复导出；成功、取消或错误都会由 `finally` 恢复按钮状态。本轮实际验证重复请求只打开一次保存流程并生成有效 PDF。
- 记住正常窗口尺寸、最大化状态与外壳主题；启动尺寸限制在主显示器工作区内。窗口状态存放在独立的 `userData/window-state.json`，不改变文档持久化格式。
- 等待 `ready-to-show` 再显示窗口，减少先露出空白窗口的机会；没有关闭 GPU 或加入重绘轮询。最终视觉复核仍发现一次打包版默认缩放首页空帧；追加普通启动、快速最小化 / 还原及 150% 共三场、18 张不改变页面内容的桌面截图均非空，正常退出且无运行时异常。根因未被证实，不能据此宣称彻底根治，见剩余限制第 7 项。

## 本轮改动与原因

行号对应本轮最终源码，路径相对于仓库根目录。

| 文件:行 | 改动与原因 |
| --- | --- |
| `AGENTS.md:15`、`START-WINDOWS.cmd:1` | 明确 A 主线、B 仅历史参考；提供不依赖开发终端的本机构建启动入口。 |
| `app/main.js:487`、`app/main.js:538` | Windows 使用 `hidden` + `titleBarOverlay`，保留原生窗口按钮；macOS 仍是 `hiddenInset`。新增尺寸边界、窗口状态原子保存和就绪后显示。 |
| `app/main.js:555` | 全屏事件发布明确的进入 / 退出状态，resize 后再校准；增加 Alt / F10 菜单入口，不截断 Alt+Space / Alt+F4 等组合键。 |
| `app/main.js:1376`、`app/main.js:1384` | 主题与菜单 IPC 继续使用严格的主窗口 / 主 frame 验证；只接受固定主题值和有限坐标。菜单使用窗口内坐标定位。 |
| `app/main.js:1427`、`app/main.js:1446` | 借鉴 B 的 `com.clay.editor` AppUserModelID 和明确 About 版本的做法，使用 Electron 原生 About 配置；Windows 不再启动无效的后台更新定时器。 |
| `app/preload.js:4` | 在已有安全桥上增加主题、原生菜单和全屏状态订阅；不暴露 Node、Electron 对象或任意 IPC 通道。 |
| `app/renderer/index.html:13`、`app/renderer/index.html:39`、`app/renderer/index.html:191` | 菜单按钮、文件状态区域，以及轻量运行时加载入口。 |
| `app/renderer/styles.css:342` | Windows 顶栏合并、原生按钮安全区、全屏空隙修正、焦点和 PDF 忙碌反馈；macOS 原有 46px / 78px 红绿灯留位保留。 |
| `app/renderer/app.js:1546`、`app/renderer/app.js:1716` | 状态 / 窗口标题同步、首页操作可用性和外壳主题联动。文件名仍通过文本写入，避免 HTML 注入。 |
| `app/renderer/editor-runtime.js:1` | Windows 首页不解析 1,092,689 字节的 GrapesJS 脚本；首次打开文档时加载、并发复用，失败可重试并有超时。非 Windows 保持原先的同步加载顺序。 |
| `app/renderer/app.js:608`、`app/renderer/app.js:1877`、`app/renderer/app.js:2372` | 在既有异步导入边界等待引擎；加载后重新检查导航版本，防止用户返回主页后旧导入把页面抢回来。 |
| `app/renderer/app.js:2589` | Windows PDF 导出互斥与按钮恢复；原 PDF 构建、路径授权、尺寸限制和离屏渲染链不重写。 |
| `app/renderer/i18n.js:11`、`app/package.json:27` | 新增中英文窗口文案、窗口专项命令，并将原生图标纳入包内；不改依赖锁文件或 macOS 打包目标。 |
| `app/tests/platform-regression-test.js:1` | 补充窗口覆盖层、macOS 隔离、坏配置回退、小显示器约束等回归。旧外观配置期望从 `default` 更新为新需求的 `hidden`；未放宽业务断言。 |
| `app/tests/editor-runtime-regression-test.js:1`、`app/tests/windows-shell.e2e.js:1` | 新增加载去重 / 失败重试 / 超时与真实 Windows 外壳、CSS 媒体查询、导航取消、导出防重等专项。 |

此前 A 的盘符 / UNC / 特殊字符路径处理、中文文件名、首页标注边界、`Ctrl+Shift+Z`、Windows PDF `offscreen` 修复和测试清理兼容继续保留。没有吸收 B 中会破坏 Unix 反斜杠路径、UNC URL 或重做提示一致性的实现。

`app/updater.js`、`app/package-lock.json`、`app/renderer/vendor/*` 未改；没有重构编辑器。

## 实测结果

全部 Windows GUI 会话经交互计划任务进入 Session 1，并采用临时 `CLAY_USERDATA`。串行启动，先确认 A / B 均未运行，结束后按所拥有的 PID / 路径清理。未使用 `taskkill /IM electron.exe`。

| 范围 | 最终结果 | 说明 |
| --- | --- | --- |
| 共同功能链 | 26 / 26 | 中英文、中文 / 空格 / `#` / `%` 路径、相对图片 / CSS / SVG、脚本隔离、编辑、撤销重做、保存 / 另存为、重载、Ctrl+S、较大页面、PDF。 |
| Windows 外壳专项 | 9 / 9 × 两种缩放 | 真实窗口控制区、加载延迟 / 导航取消、主 frame 权限、主题不改变作品媒体查询、全屏 / 缩放安全区、PDF 去重、标题及状态。 |
| 原生输入 | 8 / 8 × 两种缩放 | 实际鼠标点击最大化 / 还原 / 最小化、拖动区双击、菜单按钮、Alt、Alt+Space、F11、Win+Left。不是仅检查配置值。 |
| npm 回归 | 13 个命令、14 次运行通过 | `test:windows-shell` 在两种缩放各跑一次；另有 windows、static、platform、updater、editor、fidelity、i18n、renderer-state、undo-canvas、main-process、production、svg。 |
| 打包程序 | 两种缩放通过 | 从新 `Clay.exe` 启动、真实文件能力桥读取测试 HTML、从 ASAR 按需加载编辑器、截图及正常关闭。文件选择由 CDP 提供测试 File，不声称已人工操作系统文件对话框。 |
| 窗口恢复 | 两次独立进程通过 | 首次设置 1370×820 正常尺寸、最大化、浅色，正常退出；第二次使用同一隔离 profile，三项均恢复。 |
| 首页绘制追加观察 | 18 / 18 帧非空 | 打包版普通启动、启动即快速窗口操作、150% 三场；分别连续截图及实际最小化 / 还原后截图。保留此前一次空帧，未宣称根因已消除。 |

**不宣称 `npm test` 全绿。** 原 `test:updates-ui` 是 macOS DMG 流程，上一轮在 Windows 上已确认不适用；本轮未改其断言，也未将它计入“通过”统计。Windows 手动检查更新的 `unsupported` 分支另有通过的回归。

测试中还确认两处容易误判的 Electron 行为：全屏进入事件回调里的 `isFullScreen()` 仍可能返回旧值；`windowControlsOverlay.visible` 在全屏时仍可能为 true。因此外壳使用主进程明确状态，而不是依赖这个可见性值。原生窗口控制区也不再依赖一次性的 JS 几何读取。

## 性能：有改善，也有取舍

同一台 Windows 机器，修改前 / 后各 3 次全新用户目录的源码启动，每次 7 个空闲进程样本。各轮取样本中位数，再取三轮中位数；只统计本次 Electron 进程，不包含 SSH / Node 探针。共享桌面未关闭其他应用，未清系统缓存，非重启冷机基准。

| 指标 | 原 A | 新 A | 解读 |
| --- | ---: | ---: | --- |
| 导航 → DOMContentLoaded | 291.6 ms | 72.5 ms | −75.1%；首页不再同步解析编辑器引擎。不是整个应用启动时间。 |
| Electron 私有内存 | 241.0 MiB | 227.1 MiB | 减少约 13.9 MiB / 5.8%。 |
| Electron 工作集 | 411.7 MiB | 398.5 MiB | 减少约 13.2 MiB / 3.2%。 |
| 首个可见窗口 | 270.7 ms | 430.3 ms | 后移约 159.6 ms；新版等待页面可绘制，避免先显示空窗。 |
| 外部探针观察到 workspace ready | 765 ms | 954 ms | 探针在发现窗口后才启动，包含探针启动 / 轮询开销；不据此宣传整体启动更快。 |
| 空闲 CPU（整机容量占比） | 0.007% | 0.008% | 均极低，三次样本不足以判定有意义差异。 |
| Electron 进程数 | 4 | 4 | 未改变进程模型或关闭 GPU。 |
| 正常关闭 | 310.1 ms | 344.0 ms | 未观察到悬挂；不声称关闭性能改善。 |

首次打开文档要支付一次引擎加载成本，后续复用。没有证明大文档帧率、长时间编辑内存或首次导入全链路加速；本轮不以这些未测指标打分。

## 截图与证据

- `win-shots/default.png`：新打包程序，无缩放参数，实际 DPR=1。
- `win-shots/scale-1.5.png`：新打包程序，传入 `--force-device-scale-factor=1.5`，实际 DPR=1.5。不是后期放大图片。
- 原始 JSON、日志、更多截图与离线 `A-UPGRADE.html` 在本机 `C:\dev\clay-a\win-validation\shell-v2-20261022\`，不纳入打包应用。
- 最终源码功能记录：`A-after-functional-5/functional.json`；外壳记录：`suites/test-windows-shell-retry-5/` 及其 scale-1.5 对应目录。
- 原生操作：`A-after-shell-3/` 与 `A-after-shell-3-scale-1.5/`；打包程序：`A-after-packaged-2/` 与 `A-after-packaged-2-scale-1.5/`。
- 空帧原始观察：`A-after-packaged-2/home-zh-CN.png`。追加绘制观察：`A-after-packaged-20/`、`A-after-packaged-21/`、`A-after-packaged-22-scale-1.5/` 中的 `paint.json` 与 18 张 PNG；采样内容颜色 504 / 969–970 种，不以 DOM 存在代替实际桌面绘制。代表性默认首页及 150% 还原截图另经目视检查。
- 性能原始数据：`A-before-performance-1..3/`、`A-after-performance-1..3/`；包内一致性：`package-verification.json`；窗口恢复：`preferences/`。
- 早期失败记录保留。窗口几何 / 全屏 / 菜单坐标问题已经复测；窗口显示残留风险单列。验证脚本也修正了 file: 资源计数、原生菜单观测方式和 `readPath` 返回字段的错误假设，没有用这些假设去修改产品接口或放宽业务断言。

## 复现与打包

正常使用：双击根目录的 `START-WINDOWS.cmd`。调试源码：

```powershell
cd C:\dev\clay-a\app
npm start
# 先退出上一次实例，再测缩放：
npm start -- --force-device-scale-factor=1.5
```

主要回归（逐条运行；GUI 在交互桌面）：

```powershell
npm run test:static
npm run test:platform
npm run test:windows
npm run test:windows-shell
npm run test:windows-shell -- --force-device-scale-factor=1.5
npm run test:main-process
npm run test:production
```

`npm run dist:win` 是默认构建入口。本机验证包使用已有 Electron 二进制和压缩工具，不下载额外签名 / 资源编辑工具：

```powershell
.\node_modules\.bin\electron-builder.cmd --win --x64 `
  '--config.electronDist=node_modules/electron/dist' `
  '--config.win.signAndEditExecutable=false'
```

配置没有永久关闭资源编辑。旧 A ZIP 已保存在本轮验证目录的 `rollback/Clay-0.1.4-before-shell.zip`，便于回退；未覆盖 B。

## 未覆盖与剩余限制

1. Windows 自动更新仍不支持；上游 DMG 不能作为 Windows 安装包。保留明确的 unsupported 提示，没有伪造更新成功。
2. 本 ZIP 是本机验证构建，未完成应用代码签名、SmartScreen、安装 / 卸载、文件关联和完整版本 / 图标资源编辑流程；资源管理器中的 EXE 资源仍可能是 Electron 的默认值。运行时窗口图标和 About 已配置，不能据此称为正式签名发行包。
3. Poppler 未安装，PDF 验证使用实际导出、结构 / 签名及现有回退检查；没有执行 Poppler 像素级底部内容检查。
4. macOS 仅通过平台模拟 / 分支回归，未在真实 Mac 上回归 GUI、PDF、DMG；不宣称 macOS 端已完整实测。
5. Windows ARM64、多显示器混合 DPI、真实 UNC / 网络盘 / 超长路径、系统高对比度、屏幕阅读器和全部物理快捷键未覆盖。UNC URL 转换有纯函数测试，不能当作网络盘实测。
6. 截图中的编辑页面是验证素材，不是重做了画布编辑器。此前文档正常退出清会话、保留最近文件的产品约定没有改变。
7. 默认缩放打包程序在启动后快速窗口操作的验证流程中，有一张首页实拍为空帧，后续语言切换 / 导入正常；同期 DOM 与资源状态正常不足以证明屏幕已绘制。三场补测 18 帧未重现（含普通启动及最小化恢复），尚不能排除偶发首屏 / 合成器时序问题，也没有证据把责任归到截图工具。暂不引入强制刷新、重绘轮询或禁用 GPU 等未经证实的绕过方案。

## 清理

已关闭本轮启动的所有 A 应用 / 测试进程，仅删除本轮创建的 15 个 `ClayA-Shell-*` 任务。最终核对 A 路径下进程数为 0、本轮任务数为 0、`git diff --check` 通过，分支仍为 `win-port-a` / `585a7f3`，ZIP 哈希未变；记录在验证目录下的 `cleanup-final.json`。保留诊断、旧 A 回退包、B 工作区和只读参考副本，未修改公共截屏工具。
