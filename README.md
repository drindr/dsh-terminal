# dsh-terminal

VSCode 风格的内置终端面板，基于 [xterm.js](https://xtermjs.org)（浏览器端）+ [node-pty](https://github.com/microsoft/node-pty)（宿主端）。它是一个独立的 dsh 插件包，源文件位于本目录，宿主端与浏览器端各占一半：

- **宿主端**（`src/index.ts` + `src/host/manager.ts`）：在 `ctx.webServer` 上注册 `/terminal` WebSocket upgrade 路由，用 `node-pty` 为每个终端会话拉起一个真实 shell（Windows 默认 `powershell.exe`，其他平台默认 `bash`），把终端的输入/输出/尺寸变化在 WebSocket 上双向转发。
- **浏览器端**（`src/client/*`）：通过槽位系统在会话页下方挂一个可拖拽调高的面板，标题栏参考 VSCode，提供终端标题、下拉切换、新建/关闭当前/关闭面板；在输入栏「上下文」按钮旁（`conversation.input.right`）加一个拉起/收起按钮，并绑定 `Ctrl+\`` 快捷键。

## 功能

- `Ctrl+\`` 在会话内拉起/收起终端面板。
- 面板位于会话页下方（composer 下方），拖动顶部分隔线调整高度。
- 标题栏：终端标题下拉切换、新建终端、关闭当前终端、关闭面板。
- 输入栏右侧新增终端切换按钮（与「上下文」按钮同处工具行）。

## 构建

```powershell
cd plugins/terminal
pnpm install
pnpm run build
```

产物：`lib/index.js`（宿主端）、`lib/client.js`（浏览器端，内联 xterm.js）。

> 本仓库的 Node 是 v26，系统自带 pnpm 7.x 与之不兼容，请用仓库固定的
> `E:\Git\dsh-gui\.toolchain\pnpm.cmd`（11.7.0）代替裸 `pnpm`。

## 安装

```powershell
# 从仓库根目录；DSH_HOME 已固定为 .dsh。同样请用 .toolchain\pnpm.cmd。
dsh plugin --profile web add link:./plugins/terminal
```

然后把插件挂进 web 组合（`dsh plugin add` 只建依赖，不挂载）。在 `.dsh/profiles/web/cordis.patch.yml` 中加入一行：

```yaml
- insert:
    - id: terminal
      name: dsh-terminal
```

重启桌面外壳（`.\scripts\run.ps1` 或直接运行 `src-tauri\target\debug\dsh-gui.exe`）后生效。

## 已知限制

- 终端进程按浏览器页面存活：刷新页面或关闭标签会结束该页面下的全部终端；切换会话不会自动回收上一会话的终端（v1 简化）。
- 产品文案目前直接写死中文，未接入 `ctx.locale` 词典。
- 关闭终端时，宿主日志可能出现 node-pty 的 `AttachConsole failed` 告警：桌面外壳以无控制台方式启动宿主进程，node-pty 在 Windows 上枚举控制台子进程失败（仅影响外壳内子进程的级联清理，终端本身仍会正常关闭）。这与宿主自带终端工具的行为一致。
