# 测试说明：在 Lody 里一键登录 EverMe

这个分支让「设置 → 记忆」里的 EverMe 可以一键装好、一键登录，不再需要手动粘贴 API Key。

**需要你帮忙验证的是：一台从没装过 EverMe 的电脑，能不能只靠点按钮就全部走完。**
这条路径在我们自己的机器上没法完整测（本机已经装好并登录了），所以你跑出来的结果是第一手数据——**不管成功还是失败都有价值**。

---

## 1. 前置条件

| 项目 | 要求 | 检查命令 |
| --- | --- | --- |
| Node.js | 22.23.4+ / 24.22.1+ / 26.12.1+ 任选其一 | `node --version` |
| git | 任意近期版本 | `git --version` |
| 系统 | macOS 或 Windows 均可 | — |

> **建议用 Node 22.x。**
> 三个版本都支持，但 22 是 LTS，原生模块 `better-sqlite3` 有现成的预编译包，不需要本地编译，最省事。
>
> 版本不对的话（以 nvm 为例）：
> ```bash
> nvm install 22 && nvm use 22
> ```

不需要 `.env`，不需要 Lody 账号，不需要任何 API Key。

---

## 2. 拉代码

```bash
git clone --recurse-submodules https://github.com/Yangtze-Seventh/lody-test.git
cd lody-test
```

> `--recurse-submodules` **不能省**，仓库有 8 个子模块。

**检查点**

```bash
git branch --show-current          # 期望：feat/everme-memory-provider
ls packages/acp-extension-codex    # 期望：有文件，不是空目录
```

子模块目录是空的（忘了加参数）就补一条：

```bash
git submodule update --init --recursive
```

---

## 3. 启用 pnpm

```bash
corepack enable
```

> 报权限错误就加 `sudo`：`sudo corepack enable`

**检查点**

```bash
pnpm --version                     # 期望：10.20.0
```

---

## 4. 安装依赖

```bash
pnpm install
```

第一次会比较久，需要下载 Electron（几百 MB）。
安装前会自动做一次 Node 版本检查，版本不对会在这里直接报错停下。

---

## 5. 启动

> **先完全退出已经在运行的 Lody**（整个 app 退出，不是关窗口）。
> 这个 app 只允许一个实例运行。

**macOS / Linux**

```bash
LODY_DATA_DIR="$(pwd)/.lody-test-data" pnpm start:local
```

**Windows PowerShell**

```powershell
$env:LODY_DATA_DIR = "$PWD\.lody-test-data"
pnpm start:local
```

> `LODY_DATA_DIR` 让这次测试使用独立的数据目录，**不会影响你原有的 Lody 数据**。

这一步会先完整构建再启动，第一次同样比较久。构建完成后 Electron 窗口会自动弹出。

---

## 6. 开始测试

打开 **设置 → 记忆**。

> ### ⚠️ 点之前先确认一件事
>
> 页面上的「**获取 EverMe**」按钮会在你电脑上**真的执行**：
>
> ```
> npm install --global @everme/cli
> ```
>
> - 你**从没用过 EverMe** → 这正是要测的，放心点。
> - 你**已经在用 EverMe 并连了 Agent** → 先别点，它的 postinstall 会刷新你所有已连接的集成。请先告诉我们一声。

### 请按顺序走，并记录每一步的感受

| # | 操作 | 重点回答 |
| --- | --- | --- |
| 1 | 冷开这一页 | 上面 Nowledge Mem、下面 EverMe，两块看起来一样大吗？**光看那两句描述，你能分清该选哪个吗？** |
| 2 | 点「获取 EverMe」 | 装得上吗？过程有提示吗？**装完之后浏览器是不是自己弹出来了，还是要你再点一次？** |
| 3 | 在浏览器里登录 | 邮箱或 GitHub 都行，没账号就当场注册。**批准之后 Lody 是不是自己换成了 Agent 列表？**全程有没有让你复制粘贴 key？（不应该有） |
| 4 | 看 Agent 列表 | 列出来的是不是**你自己电脑上的 Agent**？有没有你根本没装过的东西？每行的 `Hook` / `MCP` 你看得懂吗？ |
| 5 | 连一个，再点「全部连接」 | 状态有变吗？变得够快吗？ |
| 6 | 任何一步失败 | **把报错原话截图发回来。**重点是：那句话你看得懂吗？知道下一步该干什么吗？ |

> **第 2、3 步最关键** —— 这是整条链路里唯一还没有人真正走通过的一段。

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `node-gyp` / `better-sqlite3` 编译失败 | 当前 Node 版本没有预编译包，需要本地编译 | macOS：`xcode-select --install` 后 `rm -rf node_modules && pnpm install`<br>Windows：装 Visual Studio Build Tools（C++ 工作负载）<br>**或者直接换 Node 22，基本不会走到编译** |
| `start:local must be launched through pnpm` | 直接用 node 跑了脚本 | 必须用 `pnpm start:local` |
| 窗口没出来 / 闪一下就没了 | 已有 Lody 实例在跑 | macOS / Linux：`pkill -f Lody`，然后重试 |
| 子模块目录是空的 | clone 时漏了 `--recurse-submodules` | `git submodule update --init --recursive` |
| 依赖装坏了想重来 | — | `rm -rf node_modules && pnpm install` |

### 关于测试失败

如果你顺手跑了 `pnpm test`，会看到 **10 个失败**，全部集中在：

- `packages/components/tests/runtime-provider.test.tsx`（9 个）
- `packages/components/tests/boot-shell.test.tsx`（1 个）

**这些是 Lody 官方 main 分支自带的，与本次改动无关**，已在零改动的官方代码上实测复现。这两个文件里 `memory` 一词出现 0 次。不用管它们。

---

## 8. 测完清理

```bash
rm -rf .lody-test-data            # 只删这次测试产生的数据
```

想连代码一起清掉，直接删除整个 `lody-test` 目录即可。

不想保留全局安装的 EverCLI：

```bash
npm uninstall -g @everme/cli
```

---

## 附：这个分支改了什么

| 场景 | 改动前 | 改动后 |
| --- | --- | --- |
| 没装 EverCLI | 只给一个外链，自己去装 | Lody 就地安装，装完自动接着登录 |
| 没登录 | 手动去终端拿 API Key 粘贴进来 | 系统浏览器完成 OAuth，一次点击；device code 全程留在守护进程，不经过界面 |
| 选 Agent | 展示 EverMe 的产品目录 | 展示**这台机器上 Lody 自己的 Agent 配置**；EverMe 没适配的排在最后且不给按钮 |
| 两个 Provider | 一个有标题、一个只有一句话 | 同样的 logo 尺寸、标题层级、一行描述、整行按钮——选择权交给那两句描述 |
