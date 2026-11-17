# 塑料折叠床开合机构 · 2D 骨骼动画编辑工具

原生 **TypeScript + Web Components + WebGPU** 实现的单页应用，零运行时框架依赖（仅 Vite 构建）。

## 运行

```bash
npm install
npm run dev      # 开发，自动打开浏览器
npm run build    # 类型检查 + 生产构建到 dist/
npm run preview  # 预览生产构建
```

要求支持 WebGPU 的浏览器（Chrome/Edge 113+）。**WebGPU 不可用时自动回退到 Canvas2D 渲染器**，PNG 导出始终走 Canvas2D 离屏管线，与后端无关。

## 功能对照

### 骨骼与部件
- 床板（panel）、连杆（link）、铰点（joint）拆为独立部件（`src/core/scene.ts`），在右侧「部件」页逐个绑定到骨骼，可改颜色/尺寸/偏移/绑定目标。
- 骨架为父子树（`Bone.parentId`），右侧「骨架」页树形展示并可调整父骨骼、长度、装配角。
- 每个铰点骨骼可设置**旋转限位最小/最大角**（留空表示不限，`AngleLimit`）。

### 动画与时间轴
- 时间轴按骨骼分行，关键帧为可拖拽菱形；顶部色带标识「展开」「收拢」两个动作段。
- 帧间插值可选：**线性 / 缓入 / 缓出 / 缓入缓出**（三次贝塞尔，与 CSS cubic-bezier 同形）/ **自定义切线**（三次 Hermite，可在底部曲线编辑器拖动手柄或在属性面板填数值）。
- 播放时 rAF 按 fps 推进当前帧，`evaluateScene()` 逐帧做局部角→世界角→世界坐标的骨架求值并实时刷新。
- **限位提示**：关节局部角超出塑料件限位时，视口铰点变红并叠加红色警示圈、骨架树红点、底部状态栏列出超限关节。
- 视口可直接拖拽铰点调角（自动在当前帧写关键帧），支持平移（Shift/中键/右键拖动）、滚轮以鼠标为锚点缩放。

### 导出
- 单帧 PNG（离屏 Canvas 1:1 渲染，不受视图缩放影响）。
- 序列帧 ZIP：可选整段 / 展开段 / 收拢段，逐帧 PNG + `manifest.json`，自带零依赖 STORE 模式 ZIP 打包器（含 CRC32，`src/core/zip.ts`）。
- 工具条与状态栏均显示当前帧时间与**整段时长**（帧数 / fps）。

### 订单工作流（顶部「订单工作流」，可切换角色体验权限）
- **客户**：按项目下单建条目（名称、品牌、截止时间、需求说明）。
- **制作员**：按镜头制作（每个镜头一份独立动画工程），提交审核 / 返工后重新提交。
- **主管**：审核通过或**退回返工**（必填原因）。
- 全部镜头通过后可**打包交付**；订单与镜头分别记录**返工次数、截止时间（含剩余/逾期天数）和完整流转历史**。
- 角色权限在 `Store` 中强校验（`assertRole`），越权操作抛错并提示。
- 数据持久化在 `localStorage`，编辑操作带 50 步撤销/重做栈。

## 快捷键

| 按键 | 作用 |
|---|---|
| 空格 | 播放/暂停 |
| K | 当前帧打关键帧 |
| ← / → | 上/下一帧（Shift 跳 10 帧） |
| Home / End | 首帧 / 末帧 |
| Ctrl+Z / Ctrl+Y | 撤销 / 重做 |

## 目录结构

```
src/
  core/            纯逻辑，无 DOM 依赖（可单测）
    math.ts          向量/角度/插值工具
    easing.ts        贝塞尔缓动 + Hermite 自定义切线 + 轨道采样
    evaluator.ts     骨架树求值、限位判定
    scene.ts         场景→渲染图元（与渲染后端解耦）
    default-project.ts 预置折叠床工程（含展开/收拢两段动作）
    export.ts        PNG 单帧/序列帧导出
    zip.ts           零依赖 ZIP 打包
    store.ts         全局状态、持久化、撤销栈、订单状态机与权限
  renderer/
    webgpu.ts        WebGPU 渲染器（CPU 三角化 + WGSL 仿射）
    canvas2d.ts      Canvas2D 回退渲染器（兼导出后端）
    renderer.ts      统一接口与坐标变换
  ui/              Web Components（Shadow DOM + Constructable Stylesheet）
    app.ts viewport.ts timeline.ts inspector.ts transport.ts orders.ts
  types.ts         全部数据模型
```

## 渲染管线说明

`buildPrimitives()` 把求值后的场景拍平成后端无关的图元（线/多边形/圆/矩形）。
WebGPU 渲染器在 CPU 侧把图元三角化（多边形扇形、粗线四边形、圆扇形/描边环），
通过统一顶点缓冲（位置 + RGB）上传，WGSL 仅做像素坐标→NDC 变换，结构简单且足够 2D 编辑器使用。
