# dsh-terminal

VSCode 风格的内置终端面板，基于 [xterm.js](https://xtermjs.org)（浏览器端）+ [node-pty](https://github.com/microsoft/node-pty)（宿主端）。它是一个独立的 dsh web 插件包，不依赖任何特定 GUI 壳，宿主端与浏览器端各占一半：

- **宿主端**（`src/index.ts` + `src/host/manager.ts`）：在 `ctx.webServer` 上注册 `/terminal` WebSocket upgrade 路由，用 `node-pty` 为每个终端会话拉起一个真实 shell，把终端的输入/输出/尺寸变化在 WebSocket 上双向转发。Windows 下优先使用 PowerShell 7（`pwsh`，已安装时），否则回退到 Windows PowerShell 5.1（`powershell.exe`）并注入 UTF-8 引导参数（详见 [docs/README.md](docs/README.md) 的「Shell 选择与中文」一节）；其他平台默认 `bash`。
- **浏览器端**（`src/client/*`）：通过槽位系统在会话页下方挂一个可拖拽调高的面板，标题栏参考 VSCode，提供终端标题、下拉切换、新建/关闭当前/关闭面板；在输入栏「上下文」按钮旁（`conversation.input.right`）加一个拉起/收起按钮，并绑定 `Ctrl+\`` 快捷键。

## 功能

- `Ctrl+\`` 在会话内拉起/收起终端面板。
- 面板位于会话页下方（composer 下方），拖动顶部分隔线调整高度。
- 标题栏：终端标题下拉切换、新建终端、关闭当前终端、关闭面板。
- 输入栏右侧新增终端切换按钮（与「上下文」按钮同处工具行）。

## 构建

在本包根目录执行：

```powershell
pnpm install
pnpm run build
```

产物：`lib/index.js`（宿主端）、`lib/client.js`（浏览器端，内联 xterm.js）。

## 安装

本插件面向 dsh 的 `web` profile，安装与宿主壳无关：

```powershell
# 在本包根目录执行；DSH_HOME 决定安装到哪个 harness home（缺省 ~/.dsh）
dsh plugin --profile web add link:.
```

`dsh plugin add` 只记录依赖，还需要在 profile 的补丁层插入 loader entry，
宿主进程启动时才会扫描到本插件的 `dsh.client` 行：

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- insert:
    - id: terminal
      name: dsh-terminal
```

挂载 id 来自 `package.json` 的 `dsh.gui.mountId`（本插件为 `terminal`）。
随后重启 dsh 宿主进程生效；浏览器半端改动刷新页面即可。

## 已知限制

- 终端进程按浏览器页面存活：刷新页面或关闭标签会结束该页面下的全部终端；切换会话不会自动回收上一会话的终端（v1 简化）。
- 产品文案目前直接写死中文，未接入 `ctx.locale` 词典。
- 关闭终端时，宿主日志可能出现 node-pty 的 `AttachConsole failed` 告警：在无控制台的宿主进程（例如由 GUI 壳托管）里，node-pty 在 Windows 上枚举控制台子进程失败（仅影响子进程的级联清理，终端本身仍会正常关闭）。
- Windows 下若不安装 PowerShell 7，中文终端回退到 `powershell.exe` + UTF-8 引导：`Get-Content`（`cat`）对无 BOM 的 UTF-8 文件能正确读入，但 Windows PowerShell 5.1 本身的其他编码局限（如外部原生命令按 OEM 码页输出）仍可能存在；遇到此类问题请安装 PowerShell 7 或设置 `DSH_TERMINAL_SHELL` 指定 shell。
