# 带电作业三维人体骨骼动画课件编辑器

面向带电作业培训的全栈三维课件生产平台：讲师在浏览器里完成人体网格导入、骨骼搭建、蒙皮权重绘制、关键帧动画与动作片段编排，导出 24fps PNG 序列帧与骨架 JSON；培训主管逐帧审片打点退回，讲师修改后重新提交生成新版本；学员播放的完成率与反复拖看帧汇总到学情看板。

## 技术栈

- **Svelte 5（runes）+ SvelteKit 3**：前端组件与全栈路由（含 API、SSR）
- **three.js 0.187**：视口渲染、TransformControls/OrbitControls、SkinnedMesh 蒙皮
- **TypeScript**：全量严格类型，`svelte-check` 0 错误 0 警告
- **JSZip**：序列帧与骨架 JSON 打包导出
- **adapter-node + JSON 文件持久化**：零外部依赖即可运行，数据落在 `.data/db.json`

## 运行

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # 生产构建到 build/
npm run check      # 类型检查
```

首次启动会自动写入 4 个分属不同电压等级/作业类型的种子课件与 3 条学员进度。

## 功能与代码对照

| 需求 | 实现位置 |
| --- | --- |
| 导入简化人体网格（OBJ/GLTF/GLB，内置胶囊人体兜底） | `src/lib/engine/mesh.ts` |
| 视口点关节建骨骼树、拖拽调父子关系与绑定姿势 | `src/lib/engine/viewport.ts`、`src/lib/engine/skeleton.ts`、`SkeletonTree.svelte` |
| 画刷涂蒙皮权重，未归一处标红 | `src/lib/engine/weights.ts`、`src/lib/engine/skin.ts` |
| 姿态库存取 | `EditorWorkspace.svelte`（`NamedPose`） |
| 时间轴关键帧 + 线性/贝塞尔/阶梯插值，贝塞尔手柄可拖 | `src/lib/engine/interpolation.ts`、`Timeline.svelte`、`BezierEditor.svelte` |
| 动作片段首尾拼接 + 循环次数 | `src/lib/engine/timeline.ts` |
| 播放显示当前帧与选中骨骼轨迹 | `src/lib/engine/player.ts`、视口 `showTrajectory` |
| 24fps PNG 序列帧 + 骨架 JSON 导出 | `src/lib/engine/exporter.ts` |
| 按电压等级/作业类型归类课件 | `src/lib/server/store.ts`、`/api/courses` |
| 主管逐帧打点审片、退回、讲师重提出版本 | `/api/courses/[id]/review`、`review/[id]` 页 |
| 学员完成率与反复拖看帧汇总看板 | `/api/progress`、`/api/dashboard`、`dashboard` 页 |

## 关键工程说明

- **权重归一判定**：只对已刷过权重的顶点检查权重和是否在 `1 ± 0.012`，不满足即顶点色标红，支持一键归一化（`weights.ts`）。
- **贝塞尔求解**：切线手柄归一化到段内 `[0,1]²`，牛顿迭代 + 二分回退求缓动值，作用于位置线性插值与四元数球面插值的混合系数。
- **时间轴展开**：片段按 `order` 首尾拼接并按 `loopCount` 展开为全局帧序列，播放器在全局帧与片段源帧之间映射采样。
- **Svelte 5 命令式 DOM 集成**：three.js 的 canvas 由引擎创建，通过模板锚点 `insertBefore` 进入 Svelte 受管位置；引擎初始化 `$effect` 用 `untrack` 隔离 `$state` 写入，避免帧更新触发 effect 重跑导致 cleanup 销毁引擎。
- **审核版本流**：`submitVersion` 每次自增版本号并置 `in_review`；`review` 的退回意见（含逐帧 annotation）挂在当前版本上，重新提交产生新版本且历史版本保留。

## 路由

- `/` 首页（统计入口 + 最近课件）
- `/editor`、`/editor/[id]` 空白工程 / 载入课件编辑
- `/courses` 课件库（电压等级、作业类型、状态筛选）
- `/review`、`/review/[id]` 审片队列 / 逐帧审片工作台
- `/player/[id]` 学员播放器（轨迹、拖看采集、进度上报）
- `/dashboard` 学情看板
