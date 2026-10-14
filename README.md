# HYMM · Bannerlord 6v6

骑马与砍杀 II：霸主的 6v6 匹配网站及专用服务器桥接插件。

## 功能

- Steam OpenID 登录、昵称和头像同步。
- 12 人匹配、45 秒就绪确认、30 秒队长竞选、双队长蛇形选人。
- 竞选开始时锁定地图，并在竞选与选人页展示；至少两人报名时取报名者中评分最高的两人，否则从全体玩家中按评分选队长。
- 随机地图与不同国家、A/B 固定名单、两轮换边与每轮三胜。
- 比赛记录、战斗统计、兵种修正评分；积分与段位信息按管理员权限展示。
- 无排位任务时自由游玩；自由游玩热身 120 秒，排位到场等待默认 300 秒。
- 管理员处理异常比赛、取消比赛、空闲切图；竞选与选人期间禁止后台切图。

## 本地运行

需要 Node.js 22.14 或更新的兼容版本（使用内置 `node:sqlite`）。在项目根目录执行：

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd start
```

已有 `.env` 时跳过复制。浏览器打开 `http://127.0.0.1:3210/`。
示例配置开启网页演示、关闭正式排位；演示不连接游戏服务器。
部分第三方图片不随源码提供，首次克隆可能显示缺图，见 [素材说明](docs/ASSETS.md)。

## Steam 与正式部署

在本机 `.env` 配置 `PUBLIC_ORIGIN`、管理员 SteamID、Steam 资料 API Key（可选）及随机生成的 `BRIDGE_TOKEN`。网站与桥接插件使用一致的桥接令牌。登录服务需要服务器能够访问 Steam；`STEAM_HTTP_PROXY` 只用于 Steam 请求。

对外部署可参考 `deploy/Caddyfile.example` 配置 HTTPS。仅临时 HTTP 测试开启 `ALLOW_INSECURE_HTTP_TEST`；示例环境文件列出了相关设置。完成身份、服务器联动与比赛流程验收后，再设置 `ENABLE_RANKED=1`。

`deploy/run-web.mjs` 可供 Windows 任务计划程序启动网站，`deploy/backup.mjs` 用于生成 SQLite 一致性备份。实际服务账户、端口、游戏启动脚本和密钥需在部署环境配置。本仓库不包含线上凭据或玩家数据。

## 游戏服插件

需要自行安装 Bannerlord Dedicated Server、.NET SDK，并提供游戏程序集路径。最近实测为 Windows 专用服 1.4.8；不包含 TaleWorlds 程序集、游戏本体或自定义地图包。

```powershell
.\game-bridge\Build.ps1 -ServerRoot 'D:\Games\Mount & Blade II Dedicated Server'
```

产物在 `game-bridge/package/ArenaBridge`。部署到游戏服 `Modules` 并在启动模块列表启用 `ArenaBridge`。将 `bridge.example.json` 复制为插件 DLL 同目录下的 `bridge.json`，填写网站地址、服务器编号及令牌；非本机通信需使用 HTTPS。修改 DLL 后需在维护时间重启游戏服。

自定义地图另行安装；部署前按实际安装内容调整 `engine.mjs` 地图池以及桥接插件地图注册列表。

## 检查

```powershell
npm.cmd run check
npm.cmd test
dotnet run --project game-bridge/tests/BridgeTests.csproj -c Release '-p:ServerRoot=D:\Games\Mount & Blade II Dedicated Server'
```

桥接测试需要游戏程序集。自动化测试不能代替多人实服验收，见 [版本记录](docs/RELEASES.md)。

## 目录与版本管理

| 路径 | 内容 |
| --- | --- |
| `server.mjs`、`engine.mjs`、`operations.mjs` | HTTP 服务、比赛状态及管理操作 |
| `combat.mjs`、`rating.mjs` | 战斗统计与积分计算 |
| `public/` | 网页界面与素材 |
| `game-bridge/` | C# 专用服务器桥接插件 |
| `test/`、`game-bridge/tests/` | 回归检查 |
| `deploy/` | 通用启动、备份及诊断工具 |

`main` 保存源码基线；后续功能建议在分支修改，检查通过后合并，并用标签标记部署版本。提交代码不会自动部署或重启游戏服务器。数据库在仓库之外独立备份。

GitHub Actions 在提交或 Pull Request 时运行网页语法和回归检查，仅授予代码读取权限。桥接编译及实服验收仍在本机执行。网页集成测试使用临时端口，按文件串行运行，避免端口竞争。

仓库公开供查看和克隆，写入权限由维护者管理；是否接受修改建议由维护者决定。目前未为项目源码指定开源许可证。字体按附带 OFL 许可证使用。
