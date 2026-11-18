# 地下综合管廊 · 三维分层审图台

基于 **SolidJS + 原生 WebGL2** 的管廊机电三维审图系统，无任何 3D 引擎依赖，渲染性能完全自控。

## 运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 生产构建
npm run test:model # 数据模型冒烟测试（Node）
npm run test:e2e   # 浏览器端到端测试（需本机 Chrome，自动复用）
```

## 四个界面（顶部 hash 路由）

| 路由 | 界面 | 能力 |
|------|------|------|
| `#/review` | 三维审图台 | 三维浏览、剖切、LOD、拾取、图层树、批注打点 |
| `#/versions` | 版本管理 | 出图提交生成新版本、版本卡片、差异计数 |
| `#/annotations` | 批注管理 | 审核人批注线程、制作方逐条回复、状态闭环 |
| `#/compare` | 版本比对 | 双视口并排、相机联动、增/删/改差异明细 |

## 渲染架构（src/lib/renderer.js）

- **实例化渲染**：`drawElementsInstanced`，每实例 24 float（模型矩阵 + 颜色 + 拾取 ID + 图层掩码 + LOD + 高亮），约 **2 万个实例**仅 2 次 draw call（圆柱/立方体各一）。
- **Cell 空间分块**：10m 一格，实例按 cell 排序进同一缓冲；每帧对 cell 做视锥体 AABB 裁剪，视口外构件不提交绘制也不参与拾取。
- **三级 LOD**：滚轮按相机距离切换——远景仅主廊结构+干管（LOD0），中景加支管（LOD1），近景加支架/接头/阀门（LOD2），着色器内按实例 LOD 位 discard。
- **图层掩码**：10 bit（4 专业 + 3 舱室 + 3 标高）传入 uniform，关闭的图层在着色器里直接 discard，既不绘制也不被拾取；cell 可见性同样按掩码预计算。
- **离屏拾取**：FBO + 编码 ID 到 RGB，`readPixels` 单像素回读，点选/悬停共用一条拾取通道。
- **轴向剖切**：uniform 传入剖切 X 坐标，片元按世界坐标 discard，可观察三层标高的分层平面。
- **VAO 隔离**：每个（几何体 + 实例缓冲）组合持有独立 VAO，避免实例属性被默认 VAO 状态污染。

## 数据模型（src/lib/model.js）

- 确定性 PRNG（mulberry32），同 seed 可复现；1200m 管廊、4 专业、3 舱室、3 标高层。
- 版本修订 = 一批可复现的编辑指令（管径调整 / 支管删增 / 阀门新增），版本间用稳定 ID 做签名 diff。
- 版本与批注持久化到 localStorage。

## 目录

```
src/
  lib/
    constants.js   专业/舱室/标高/图层位/LOD 配置
    math.js        矩阵与视锥体裁剪
    model.js       确定性模型生成、版本修订、diff
    renderer.js    WebGL2 渲染核心
  components/LayerTree.jsx   专业→舱室→标高三级图层树
  pages/           四个界面
  store.jsx        Solid 全局状态与持久化
scripts/
  test-model.mjs       模型层测试
  e2e-browser.mjs      18 项浏览器端到端检查
  debug-raw-webgl2.mjs WebGL2 实例化环境能力探针
```
