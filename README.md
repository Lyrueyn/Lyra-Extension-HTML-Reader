# HTML 阅读器（HTML_Reader）

璃鸢镜扩展：`kind: "reader"`，有独立 Tab 和书库，打开本地 `.html` / `.htm` 文件。

## 模式

- **阅读模式**：默认渲染 HTML，不显示源码和 DevTool
- **编辑模式**：嵌入 HTML_Editor 层（三栏编辑器），保存写回原 `.html` 文件

## 前置

```json
{ "requires": ["html-editor"] }
```

编辑器层由宿主以固定虚拟域名提供：

```text
https://lyra-extensions.local/html-editor/index.html?embedded=1
```

## 数据保存

- 读取：`host.workspace.load` 读取原文件
- 保存：`host.workspace.save` 原子写回原文件
- 编辑模式中的变更通过 `postMessage` 回传，防抖后保存

## 文件关联

`.html` / `.htm` 是扩展书库的文件类型，不抢占系统默认浏览器。

## 许可证

GNU GPL v3.0。

## 1.1.0

- 阅读模式不再注入 padding / 字体 / 背景，完整 HTML 按原样渲染；`body` 的 `color`、`width` 等属性保留。
- 只有没有 `<html>` 的片段才套最小外壳。

## 1.1.1

- 编辑器 iframe 增加版本 query；图片以 data URL 插入并随 HTML 保存。

## 1.1.2

- 编辑器 iframe 缓存版本更新到 140；图片 data URL 写入 HTML。

## 1.2.0

- 图片改为保存到 HTML 同目录 `assets/`，源码写相对路径，不再使用 base64。
- 阅读/编辑预览通过 `bookAssetsOrigin` 加载本地相对图片。
- 需要主程序 1.4.1+。


## 1.3.0

- 打开 HTML 时自动把图片/视频/音频等本地媒体迁移到同目录 `assets/`，支持相对路径与绝对路径。
- 扫描 `src`、`poster`、`srcset`、CSS `url(...)`；迁移后重写源码并自动保存（.bak 备份）。
- data:/http:/blob:/已有 assets/ 路径跳过。
- 需要主程序 1.4.3+（host.file.import）。

## 1.3.1

- readFrame/editFrame 增加 allow="autoplay"，编辑模式背景视频恢复显示。
- 迁移失败状态显示首个失败路径和原因。

## 1.3.2

- 修复误把 `<script src>` 当媒体迁移：现在只扫描 img/video/audio/source/track 的 src/poster/srcset，以及 CSS url()。
- class 2.html 里的 `../../../preview.js` 不再被上报为迁移失败。

## 1.3.3

- 书库「添加 HTML 文件」改为链接式入库，不复制 HTML 副本；相对 assets 始终按原文件目录解析。
- 需要主程序 1.4.4+（library.link）。

## 1.3.4

- 恢复「复制 HTML 到书库」，但主程序 1.4.5 会同时复制同目录 assets 目录；书库副本不再丢背景图/视频。

- 1.3.4 移除 link；由主程序 1.4.5 复制 HTML + assets。


## 1.3.5

- 嵌入编辑器缓存版本 281（Editor 1.17.2，含 Console 标签）。
- 需要主程序 1.4.6+。

## 1.3.6

- 迁移范围增加 `<link rel="stylesheet">` 与 `<script src>`：本地 CSS/JS/fonts 也复制到 assets 并改写路径。
- 主程序 1.4.7 放宽 host.file.import 扩展名。

- 1.3.6 迁移 `<link rel="stylesheet">` 与 `<script src>`；主程序 1.4.7 放开扩展名。
