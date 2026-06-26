# Aurora Emby Web

一个可直接部署到 Zeabur 的 Emby 网页版项目。

## 已实现功能

- 默认填充公共 Emby 地址、用户名、密码
- 媒体库浏览、搜索、排序、正序/倒序
- 最新入库、继续观看、下一集
- 收藏 / 取消收藏
- 标为已看 / 未看
- 剧集详情与按季号、集号自然排序
- 浏览器直接打开播放直链
- 复制 mpv PowerShell 播放命令
- 内置 mpv 下载包与使用教程
- 支持浅色 / 深色 / 跟随系统主题

## 技术说明

- 前端：React + TypeScript + Vite
- 部署方式：Zeabur 直接导入仓库
- 不使用本地图片代理，不启动本地后端
- 所有 Emby 请求均由浏览器直接访问服务器

## 重要限制

这是纯网页版本，所以：

1. 浏览器不能直接启动本地 `mpv.exe`
2. 因此这里采用“复制 PowerShell 播放命令”的方案
3. Emby 服务器必须允许浏览器跨域访问，否则登录后可能无法拉取媒体列表或海报

## 本地开发

```bash
npm install
npm run dev
```

## 生产构建

```bash
npm run build
npm run start
```

## Zeabur 部署

直接把仓库导入 Zeabur 即可。

推荐配置：

- Install Command: `npm install`
- Build Command: `npm run build`
- Start Command: `npm run start`
- Output: `dist`

仓库已附带 `nixpacks.toml`，一般不用再手填。

## mpv 使用方法

1. 访问设置页下载 `public/downloads/mpv-x86_64-20260610-git-304426c.7z`
2. 解压到本机目录，例如 `C:\Tools\mpv`
3. 在设置页填入 `C:\Tools\mpv\mpv.exe`
4. 回到媒体详情页点击“复制 mpv 播放命令”
5. 在本机 Windows PowerShell 粘贴运行即可

## CORS 提示

如果登录成功，但媒体列表、海报、继续观看等接口失败，请优先检查：

- Emby 是否允许对应站点跨域
- Cloudflare / 反向代理 是否拦截了浏览器请求
- 目标地址 `https://zhuixin.8622368.xyz:443` 是否稳定可达

我实际探测时，该地址曾返回 Cloudflare 520，所以如果线上偶发打不开，不一定是前端代码问题。
