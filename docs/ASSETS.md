# 素材说明

本仓库公开源码，不打包游戏安装目录或全部线上美术资源。

- UnifrakturCook 字体保留 `public/fonts/OFL.txt` 和 `licenses/UnifrakturCook-OFL.txt`。
- `public/media/castle-*`、`campaign-map.*`、`calradia-banner.*`、`sidebar-war-banner-v1.webp` 以及 `public/calradia-banner.png` 是项目使用的 AI 生成装饰背景。
- `public/maps/*.svg` 是项目生成的地图布局示意图，并非可游玩场景。
- `public/armory-catalog.json` 是由本机原版 XML 导出的物品 ID、中文名称和兵种适配元数据；`tools/export-armory.py` 可重新生成。军械库的 SVG 是部位示意，不包含游戏模型、贴图或截图。
- 不随仓库分发：游戏提取的原版地图加载图片、第三方段位插画及其压缩版本、游戏 DLL、自定义地图包。
- 就绪提示使用本地原版 `ui.bank` 的 `notifsm_army_created_01`（约 3.4 秒），胜利提示使用 `notif_quest_succeed`（约 3 秒）。网站使用 24 kHz 单声道 WAV，限制峰值并以 0.65 增益播放，文件名包含内容哈希以便长期缓存。
- `public/audio-assets.js` 记录音效路径；提取的 `public/audio/*.wav` 仅另行部署，不纳入公开源码。缺少音效、下载或解码失败时，网页回退到原有合成提示音；启用提示音后才预加载，静音会停止当前播放，过期事件不会在下载结束后补播。

段位参考图来自 `Oshibuki/client`，本地来源记录未确认其分发许可，因此原图和衍生 WebP 均排除。原版地图加载图取自本地 Bannerlord 安装，也未随仓库分发。

`public/image-assets.js` 保留运行时图片路径。仅克隆公开仓库时，段位图及部分地图预览可能缺失；使用自己有权使用的素材补齐或调整映射。`deploy/build-images.mjs` 需额外安装 Sharp 并准备输入素材，不会下载第三方图片，也不是启动网站的必要步骤。

`.gitignore` 对可公开目录采用允许列表。新增文件后请检查是否被忽略，再决定是否纳入版本管理；不要用 `git add -f` 绕过对密钥、数据库或第三方素材的排除。
