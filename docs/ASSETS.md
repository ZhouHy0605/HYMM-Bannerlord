# 素材说明

本仓库公开源码，不打包游戏安装目录或全部线上美术资源。

- UnifrakturCook 字体保留 `public/fonts/OFL.txt` 和 `licenses/UnifrakturCook-OFL.txt`。
- `public/media/castle-*`、`campaign-map.*`、`calradia-banner.*`、`sidebar-war-banner-v1.webp` 以及 `public/calradia-banner.png` 是项目使用的 AI 生成装饰背景。
- `public/maps/*.svg` 是项目生成的地图布局示意图，并非可游玩场景。
- 不随仓库分发：游戏提取的原版地图加载图片、第三方段位插画及其压缩版本、游戏 DLL、自定义地图包。

段位参考图来自 `Oshibuki/client`，本地来源记录未确认其分发许可，因此原图和衍生 WebP 均排除。原版地图加载图取自本地 Bannerlord 安装，也未随仓库分发。

`public/image-assets.js` 保留运行时图片路径。仅克隆公开仓库时，段位图及部分地图预览可能缺失；使用自己有权使用的素材补齐或调整映射。`deploy/build-images.mjs` 需额外安装 Sharp 并准备输入素材，不会下载第三方图片，也不是启动网站的必要步骤。

`.gitignore` 对可公开目录采用允许列表。新增文件后请检查是否被忽略，再决定是否纳入版本管理；不要用 `git add -f` 绕过对密钥、数据库或第三方素材的排除。
