# 山地步道夜间照明布光预览系统

原生 TypeScript + Web Components + SVG + D3 的单页应用，面向山地步道照明方案的设计、计算与审核。

## 启动

```bash
npm install
npm run dev      # 开发（默认 http://localhost:5173）
npm run build    # 类型检查 + 生产构建到 dist/
npm run test     # vitest 计算层单元测试
npm run preview  # 预览生产构建
```

## 功能与实现对照

| 需求 | 实现位置 |
| --- | --- |
| 读入中线/台阶/挡墙/树冠/建筑本地矢量数据并分层渲染 | `src/types.ts` 数据模型；`src/components/map-view.ts` 分层 SVG；顶部「导入数据」读取项目 JSON |
| 路灯拖到步道自动吸附中线，按台阶高差给安装高度 | `lib/geometry.ts#snapToPolyline`；`lib/photometry.ts#suggestPoleHeight`（落在台阶多边形内时 4.5m+台阶高差，可切手动） |
| 每灯调功率/色温/光束角/投射方向/遮光角 | 侧栏灯具编辑器 `components/side-panel.ts` |
| 距离衰减 + 光束角截止算光斑 | `lib/photometry.ts`：平方反比 + cos^n 光强分布 + 光束边缘 smoothstep 截止 + 遮光角硬截止，光通按立体角积分归一化 |
| 挡墙/树冠/建筑逐灯多边形阴影 | 2D 多边形拉伸为 3D 竖棱柱，射线-棱柱求交（`rayPrism`）；实体截断为 0，树冠按透射率累乘，可穿透追踪多个冠层 |
| 有尺寸光源多次采样半影带 | 发光面圆盘 Halton 抖动 9/16 采样（`jitteredDiskSamples`），本影/半影由遮挡比例自然产生 |
| 平日/节日/深夜三套开关策略整幅重算 | `lib/engine.ts#scheduleOn`，深夜点亮灯半功率；顶部切换 |
| 1m 网格照度热力层 | `buildGrid` 1m 栅格 + 只评价步道面（中线两侧 1.5m），`map-view` 热力栅格 + d3-contour 等值线 |
| 低于 5lx 区域描红并列位置/面积，点击定位 | 4 邻域连通区 + marching squares 5lx 真实等值面；侧栏低照度列表点击 `store.locate` 平移定位 |
| 纵断面同步灯高与地面关系 | `components/profile-view.ts`：地面高程线、灯杆、光源高度标注、台阶高差标注 |
| 灯具台账从型号库带功率和数量 | 型号库 `data/sample.ts`，台账页按型号汇总数量与实际总功率，支持导入型号库 JSON |
| 方案提交→审核人退回/通过，意见挂版本 | `lib/store.ts` 版本流，审核意见与状态绑定在 `PlanVersion` 上，可恢复历史布置 |
| 导出布光图与照度统计表 | SVG→PNG（2x）、1m 网格照度 CSV（含低照度区清单，UTF-8 BOM 适配 Excel）、完整方案 JSON |

## 数据格式（导入 JSON）

本地平面坐标系，单位米，z 为高程米。顶层字段：

```jsonc
{
  "name": "项目名",
  "centerline": { "id": "cl", "geometry": { "type": "LineString", "coordinates": [[x,y,z], ...] } },
  "steps":     [ { "geometry": {"type":"Polygon","coordinates":[[[x,y,z],...]]},
                   "properties": {"kind":"step","topElev":50.8,"bottomElev":49.6} } ],
  "walls":     [ { "properties": {"kind":"wall","baseElev":49.8,"height":2.2} } ],
  "canopies":  [ { "properties": {"kind":"canopy","trunkTop":52,"canopyTop":57,"transmittance":0.3} } ],
  "buildings": [ { "properties": {"kind":"building","baseElev":50,"height":6.5} } ],
  "lampModels": [ { "id":"LM-01","manufacturer":"...","name":"...","ratedPower":30,
                    "efficacy":110,"cctOptions":[2700,3000],"beamOptions":[60,90],
                    "defaultCct":3000,"defaultBeam":60,"sourceSize":0.32,"ip":"IP66" } ],
  "lamps": [ /* 可选，无则从空方案开始 */ ]
}
```

型号库单独导入时顶层为 `LampModel[]` 数组。

## 计算模型说明

- **光通归一化**：Φ = P × 光效；光强 I(θ)=I₀·cos^n(θ)·边缘平滑，I₀ 由 2π∫I·sinθ dθ = Φ 数值积分求出，保证不同光束角能量守恒。
- **水平面照度**：E = I·cos(i)/r²，cos(i) 为入射角余弦，r 为光源到地面点距离。
- **遮光角**：光线与下垂线夹角超过设定值直接截止（眩光控制）。
- **遮挡**：射线对每个竖棱柱测最近交点，实体挡墙/建筑 E=0；树冠 E×=透射率并继续追踪。
- **半影**：`sourceSize>0` 时对发光面圆盘做 N 次抖动采样后取均值，遮挡边缘得到连续过渡带；点光源为锐利本影。
- **评价范围**：只统计步道有效宽度内网格，野外网格不参与达标判定。

## 目录结构

```
src/
  types.ts            数据模型与类型守卫
  lib/
    geometry.ts       折线吸附、点在多边形、射线棱柱求交、凸包、Halton 采样
    photometry.ts     光度学、遮挡场景、面光源采样、色温配色
    engine.ts         1m 网格、策略重算、d3 等值线、低照度连通区、纵断面
    store.ts          中央状态、版本审核流、localStorage 持久化
    exporter.ts       PNG/CSV/JSON 导入导出
    base.ts           Web Component 基类
  data/sample.ts      示例山地步道与内置型号库
  components/         app-shell / map-view / side-panel / profile-view
```

## 交互提示

- 双击地图空白处在最近中线桩号新增灯具；拖动灯位实时吸附。
- 灯杆高度默认「自动建议」，勾选取消后可 4–10m 手动调节。
- 顶栏图层复选框可独立开关台阶/挡墙/树冠/建筑/热力/等值线/低照度/投射方向。
- 方案自动存 localStorage，刷新不丢失；审核页可随时恢复任一历史版本。
