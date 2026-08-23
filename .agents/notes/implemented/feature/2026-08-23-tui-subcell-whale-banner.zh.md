# Agent Note: TUI 子单元鲸鱼横幅

Status: implemented

[English](2026-08-23-tui-subcell-whale-banner.md) | 中文

## Problem

TUI 首次加载横幅没有复现参考图中的 DeepSeek 鲸鱼。压缩为 45×13 的转换对曲线使用了局部 Braille 单元，终端会按规范把它们栅格化为分离的圆点，而不是填满的蓝色像素。渲染器还会分别居中每个已裁掉右侧空格的行，使尾巴、嘴部和腹部相对彼此发生横向移动。原有六行块状标题也不同于参考图中的紧凑字标。

## Decision

鲸鱼保存为一个不可变的 52×19 终端单元画布，并按参考图的原始单元网格重建。`█` 绘制完整单元，`▀` 或 `▄` 绘制垂直方向的半个单元；由于未填充区域在这一尺度下清晰可见，画布排除 Braille 单元。一个共享的左侧偏移居中整个画布，字面量中的前导空格则保留每行坐标。

鲸鱼最后一行使用上半块，在同为 `#4D6BFE` 品牌色的单行字标 `D E E P S E E K  H A R N E S S` 之前留下半个单元高度的空白。启动或 repaint 路径不增加图片文件、解码器、光栅化器、逐单元 React 节点、动画计时器、平台分支或终端能力探测。自适应回退、transcript 布局和页眉字形保持不变。

## Alternatives considered

### Why not render a bitmap through Kitty, iTerm2, or Sixel?

这些协议需要按终端处理能力，并会为装饰性的首次加载界面显著增加启动、退出清理和回退行为。

### Why not keep Braille for curved edges?

Braille 在一个终端单元内表示最多八个相互分离的圆点。它适合图表和细线轮廓，但局部 Braille 边缘与全块相邻时会产生失败横幅中可见的穿孔轮廓，而不是参考图中的实心像素边缘。

### Why not center each visible row by its measured width?

即使前导空格属于同一个 52 单元坐标系，裁掉右侧空格后的各行测量宽度也不相同。逐行居中会使图形变形；只有完整画布具有一个中心。

## Consequences

鲸鱼占 52 列、19 行，后接一行字标。不同终端对块元素边缘的栅格化笔画可能不同，但 `█`、`▀` 和 `▄` 均保持一个显示单元，并在受支持的宽度模型中维持几何。19 行视口可以只显示鲸鱼；更窄或更矮的视口使用普通欢迎卡片。

## Testing

`welcome-banner.spec.ts` 固定 52×19 字面量、辨识特征、仅块元素的字形允许列表、单单元显示宽度、固定画布居中、紧凑字标和回退行为。`render-frame.spec.ts` 验证组装后的 Ink 全屏帧包含轮廓和字标，同时不改变帧和光标几何。
