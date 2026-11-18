# 盐田纳潮沟渠与卤水池矢量图编辑器

基于 **React 18 + TypeScript + Vite** 的矢量编辑工作台：主画布为 Canvas2D 矢量路径编辑，**three.js** 提供三维地形参考底图。

## 启动

```bash
npm install
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 生产构建
npm run typecheck  # 类型检查
npm test           # 单元测试（几何/布尔/吸附/历史/工单，45 项）
npm run test:e2e   # 无头浏览器端到端测试（需本机 Edge/Chromium）
```

## 功能与实现对照

| 需求 | 实现位置 |
| --- | --- |
| 主画布 Canvas2D 矢量路径编辑 | `src/components/EditorCanvas.tsx`（rAF 重绘、DPR 适配、世界/屏幕坐标变换） |
| three.js 三维地形参考底图 | `src/components/Terrain3D.tsx`（地形网格按要素实时下沉、池体带孔洞拉伸、沟渠带状体、OrbitControls） |
| 纳潮渠/排淡沟开放路径、卤水池闭合路径 | `src/lib/factory.ts` 类型元数据；工具栏绘制工具，双击/回车结束 |
| 并集/差集/交集（选中 ≥2） | `src/lib/geometry.ts` `runBoolean`（polygon-clipping，开放路径先按宽度缓冲为面），结果为带顶点的新要素，可继续编辑 |
| 差集剪缺口（渠底轮廓/池埂交线） | 差集结果以孔洞（holes）保留，2D evenodd 填充、3D ExtrudeGeometry 孔洞同步呈现 |
| 顶点吸附：端点/中点/水平垂直/20m 网格 | `snapPoint`，优先级 端点 > 中点 > 水平/垂直 > 网格，容差 12 屏幕像素 |
| 拖动邻近间距标注 | `nearestDistanceLabel`，拖动时实时显示到最近要素边的垂直距离 |
| 闭合路径自交实时高亮 | `findSelfIntersections`，画布红色脉冲标记 + 属性面板告警 + SVG 导出标记 |
| 框选/合并/断开/反转方向/图层锁定 | `EditorStore` 对应命令；双击线段插顶点、双击顶点断开；图层与要素两级锁 |
| 撤销重做 ≥50 步 | `src/lib/history.ts`，容量 100；拖动手势合并为单条历史；Ctrl+Z / Ctrl+Y |
| 宽度/边坡比 → 双侧沟沿 | 属性面板编辑；`offsetOpenPath` 按 `半宽 + 深×边坡比` miter 等距偏移生成左右沟沿 |
| 客户下单 → 制作员加工 → 主管审核退回/通过 → 打包 | `src/components/WorkflowPanel.tsx`，三角色切换；退回自动累计返工次数；截止时间与逾期提示 |
| 导出 SVG 与要素清单 | `src/lib/export.ts`：SVG（网格/图例/自交标记）、CSV 清单（UTF-8 BOM）、JSZip 交付包（JSON+CSV+README） |

## 编辑操作速查

- 绘制：选择纳潮渠/排淡沟/卤水池工具后逐点单击，双击或回车结束，右键回退一个点
- 选择：单击要素/顶点，Shift 或 Ctrl 多选，空白处拖拽框选，Ctrl+A 全选
- 顶点：拖动顶点（自动吸附）；双击线段中点位置插入顶点；双击顶点断开（闭合→开放，开放→拆两条）
- 画布：滚轮以光标为中心缩放，中键或平移工具拖动画布
- 快捷键：Delete 删除、Ctrl+Z/Y 撤销重做、Esc 取消

## 目录结构

```
src/
├── types.ts                 全局类型（要素/图层/工单/状态）
├── lib/
│   ├── geometry.ts          几何核心：吸附、自交、偏移、布尔、标注、量算
│   ├── history.ts           撤销重做历史栈（100 步）
│   ├── factory.ts           图层/要素工厂与演示数据
│   └── export.ts            SVG / CSV / ZIP 导出
├── state/store.ts           命令式状态仓库（useSyncExternalStore + localStorage 持久化）
├── components/
│   ├── EditorCanvas.tsx     Canvas2D 主画布
│   ├── Terrain3D.tsx        three.js 三维底图
│   ├── Toolbar.tsx          工具/布尔/路径操作/角色/导出
│   ├── LayersPanel.tsx      图层与要素列表、锁定/可见
│   ├── PropertyPanel.tsx    宽度、边坡比、深度、沟沿生成、量算与自交告警
│   └── WorkflowPanel.tsx    工单全流程
tests/                       单元测试（vite-node）
e2e/browser-test.mjs         Puppeteer 端到端测试
```

## 数据模型要点

- 所有坐标单位为**米**，测量坐标系 y 轴朝北，渲染时翻转；20m 网格为吸附基准
- 开放路径参与布尔运算时按 `width/2` 缓冲为闭合面；布尔结果统一为闭合多边形，孔洞表达差集缺口
- 沟沿要素带 `sourceId` 关联源渠，重新生成时自动替换；删除源要素时级联删除
- 状态自动持久化到 localStorage，工具栏「重置演示」可恢复初始样例
