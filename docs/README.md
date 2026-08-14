# dsh-terminal 插件文档

VSCode 风格的内置终端面板：浏览器端 [xterm.js](https://xtermjs.org) + 宿主端 [node-pty](https://github.com/microsoft/node-pty)。
非侵入：不修改 dsh 框架本体，仅作为 `plugins/terminal/` 插件包挂载到 web profile。

## 结构

```
src/index.ts              宿主半端：/terminal WebSocket upgrade 路由 + 信任校验 + teardown
src/host/manager.ts       宿主半端：终端会话管理（node-pty 生命周期 / 消息路由 / 编码与 shell 选择）
src/client/index.ts       浏览器半端：槽位注册（conversation.composer.dock + conversation.input.right）
src/client/TerminalView.tsx 单个 xterm.js 实例
src/client/TerminalPanel.tsx / TerminalTitleBar.tsx / TerminalToggleButton.tsx  面板 UI
src/client/controller.ts  浏览器 ↔ 宿主 WebSocket 控制器
src/client/store.ts       会话级终端列表的 UI 状态
build.mjs                 esbuild 构建：lib/index.js（Host）+ lib/client.js（Browser module）
docs/                    本目录（插件文档）
```

## 构建与安装

```powershell
# 从仓库根目录
npm run install:plugins   # 构建 + 安装 + 挂载 plugins/ 下所有插件
# 或单独（在 plugins/terminal 下）
node build.mjs
```

挂载到 web profile（由 `npm run install:plugins` 自动完成，等价于）：

```text
注入 .dsh/profiles/web/package.json      "dsh-terminal": "link:./plugins/terminal"
注入 .dsh/profiles/web/cordis.patch.yml  - id: terminal / name: dsh-terminal
```

宿主半端改动（如本目录的编码/shell 选择）需要**重启 dsh-gui** 才会生效
（宿主进程按启动时读取 `lib/index.js`）；浏览器半端改动刷新页面即可（dev:web 构建下可热更新）。

## Shell 选择与中文（UTF-8）支持

宿主端按以下顺序决定终端 shell（`src/host/manager.ts` 的 `windowsShell()`）：

1. 环境变量 `DSH_TERMINAL_SHELL` 非空时，直接用它（完全跳过下面两条，用户全权控制）。
2. Windows 下优先 **PowerShell 7（`pwsh`）**：按 `%ProgramFiles%\PowerShell\7\pwsh.exe`、
   `%ProgramFiles(x86)%\PowerShell\7\pwsh.exe`、PATH 依次探测。`pwsh` 默认即以 UTF-8
   读写文件与控制台，`cat` 中文文件天然正确。
3. 未安装 `pwsh` 时回退到始终存在的 **Windows PowerShell 5.1（`powershell.exe`）**，
   并注入 UTF-8 引导参数（`POWERSHELL_51_UTF8_BOOTSTRAP`）：
   - `$PSDefaultParameterValues['Get-Content:Encoding']='UTF8'`：中文本地化下
     （ANSI 码页 CP936/GBK）`Get-Content`（`cat`）对无 BOM 的 UTF-8 文件默认按 GBK 解码，
     会把 `使用用户所用的语言回复` 显示成 `浣跨敤鐢ㄦ埛…` 这类乱码；此参数把默认编码固定为 UTF-8。
   - `$OutputEncoding` / `[Console]::OutputEncoding = UTF8`：让 cmdlet 与外部程序输出按 UTF-8
     编码到达 ConPTY 侧，避免二次乱码。
4. 其他平台使用 `$SHELL`（缺省 `bash`）。

> 本机实测：`powershell.exe`（5.1）不引导时 `cat` 上述 YAML 出乱码/空行，注入引导后与
> `pwsh` 一样把第 38 行正确显示为 `Reply in the language the user uses (使用用户所用的语言回复).`。

## 运维

- 终端进程随浏览器页面存活：刷新/关闭标签页即终止该页的全部终端。
- 关闭终端或插件卸载时，`TerminalManager.disposeSocket` / 会话 `dispose` 会回收 node-pty 进程。
- Windows 桌面外壳无控制台启动宿主进程时，node-pty 关闭可能打印 `AttachConsole failed` 告警，
  不影响终端功能（见主 README「已知限制」）。

## 终端尺寸同步（避免输出在第 80 列被截断/换行）

宿主 PTY 以创建时的默认几何（`controller.create(80, 24, …)`）拉起 shell，真正尺寸由
浏览器端 `TerminalView` fit 到面板宽度后再同步给宿主。`lib/client.js` 中的同步逻辑
（`fitAndSync`）要点：

- `onResize` 监听器**先于首次 `fit()` 注册**：fit 触发的尺寸变化事件必须能被转发，
  否则宿主 shell 一直停留在 80 列，超长输出（如 `cat` 宽文件）在第 80 列被截断换行。
- 每次 fit 后**显式**把 `terminal.cols/rows` 推给宿主（`resize`）：`FitAddon.fit()` 在
  尺寸未变化或首次渲染尚未测出单元格尺寸（宽高为 0）时直接返回、不触发 `onResize`，
  不能只依赖事件。
- 首帧（`requestAnimationFrame`）、`document.fonts.ready` 以及 `ResizeObserver`
  多次重试 fit，覆盖「首次渲染未测出尺寸 / 字体加载后字宽变化 / 面板或窗口尺寸变化」
  各场景。

> 若某次看到仍在 80 列截断，多半是面板本身宽度正好容纳约 80 个字符（终端按面板宽度
> 自动换行属正常行为）；此时应调宽面板/窗口，而不是期望关闭自动换行。

## 已知限制

- 同一页面只维护一个 `/terminal` WebSocket；会话切换不会自动回收上一会话的终端（v1 简化）。
- Windows PowerShell 5.1 的编码局限（外部原生命令按 OEM 码页输出等）在回退路径下仍可能存在；
  建议安装 PowerShell 7 以获得完整 UTF-8 体验。
- 中文输入：ConPTY 以 UTF-16 合成控制台输入，中英文直接键入/粘贴均可用；若个别回调式读取
  命门（如第三方 readline 模块）出现输入乱码，可考虑把 `[Console]::InputEncoding` 一并设为 UTF-8。
