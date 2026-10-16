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

## HYMM 军械库（测试版）

网页军械库覆盖六国 42 个兵种、306 件原版适配服装。Steam 玩家可按兵种免费保存外观，或恢复该兵种的游戏内配装。数据独立保存在 SQLite 的 `armory_profiles` 表；不修改官方账号库存、货币或赛季积分。

插件配置 `enableArmory: true` 后，每 5 秒异步获取在线玩家的配装，并在原版出生流程前覆盖该连接的服装选择，保留原始装备和非服装外观。自由游玩及排位均适用；保存后下一次出生查看，已出生角色不即时换装。未配装的兵种沿用游戏内选择。网页目前使用部位示意图，不包含三维预览、游戏模型或贴图。实服多人显示、换边和切图仍需玩家验收。

升级游戏后可运行 `python tools/export-armory.py "游戏安装目录"` 重新导出原版 ID、中文名称及兼容关系，再运行测试。目录来自 `mpcosmetics.xml`、`mpclassdivisions.xml`、`mpcharacters.xml` 和 `mpitems.xml`，不开放任意装备 ID。停用时将 `enableArmory` 设为 `false` 并重启游戏服。

HYMM 的兵种例外在 `game-bridge/armory-overrides.json` 中维护，并嵌入插件。当前仅给帝国军团步兵额外开放缨饰珠宝战场王冠及华丽军团鳞甲；目录生成后只扩展指定兵种，插件仅扩展外观替换关系。修改例外时需重新导出目录、构建插件并一并部署。

## 检查

```powershell
npm.cmd run check
npm.cmd test
dotnet run --project game-bridge/tests/BridgeTests.csproj -c Release '-p:ServerRoot=D:\Games\Mount & Blade II Dedicated Server'
```

插件检查包含后台写入、慢磁盘/网络、快照隔离、重试恢复与原版接口适配测试。`node game-bridge/tests/integration.mjs` 另行启动临时本地网站和数据库，验证两轮结算及重复回传，不连接线上服务器；游戏程序集路径沿用项目配置。

运行期的网络序列化、响应解析、恢复文件读取和状态保存由后台处理；游戏线程只复制数据、接收完成结果和调用游戏接口。切图、半场换边和占用释放会等待保存完成，但不会在游戏线程阻塞等待磁盘。配置文件仍在插件启动时读取；正常卸载会限时等待后台写入，强制终止前尚未保存的比赛需人工核查。

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
