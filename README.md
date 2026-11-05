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
