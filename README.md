# 瓶型曲面建模与标签展开工具

面向日化包装瓶厂的塑料瓶型设计与标签排版工具。设计师在二维视口用样条曲线绘制瓶身半剖轮廓，
实时校核曲率，绕轴旋转生成瓶身曲面，再做等距偏移生成标签安全区/出血边界，并按柱面展开成平面标签稿，
标注接缝与伸长率分布。全程走工单流：前台接单 → 设计师建模 → 质检抽查（不合格打回、记录返工）→ 看板统计。

## 技术栈（零构建，离线可运行）

- **SolidJS 1.9**（ESM + `solid-js/html` 标签模板，import map 解析，本地 vendor，无需打包）
- **Canvas2D**：二维半剖轮廓编辑器、质检只读复核、看板图表
- **OffscreenCanvas**：
  - 旋转曲面在离屏画布光栅化后 blit 到可见 canvas（不支持时自动降级主线程）
  - 标签展开渲染放进 module Worker + OffscreenCanvas，拖拽时不阻塞交互（含主线程等价降级）
- **localStorage**：工单与设计数据持久化

## 四个界面

| 标签 | 职责 |
| --- | --- |
| 前台接单 | 录入项目名、目标容量、材质、备注创建工单；选择设计师快捷分派 |
| 设计工作台 | 三阶段：① 轮廓建模 ② 旋转曲面 ③ 标签展开 |
| 质检抽查 | 待检队列、随机抽查校核（曲率/容量/标签参数）、合格入库或打回（返工次数 +1） |
| 统计看板 | 完成量、返工率、待办/质检队列、设计师绩效（Canvas 柱状图 + 环形图） |

### 设计工作台能力

1. **轮廓建模**：向心 Catmull-Rom 样条；控制点可拖拽、双击空白加点、双击/右键删点、滚轮缩放；
   实时显示每点曲率 κ 与切向角 θ，曲率超阈值的控制点标红并染红对应曲线段、曲率梳；
   旋转体积分实时换算容量与偏差；支持按目标容量自动缩放半径。
2. **旋转曲面**：半剖轮廓绕轴旋转，画家算法 + 法向光照，可拖拽视角/自动环绕/切换线框，材质差异化基色。
3. **标签展开**：等距偏移生成安全区（内缩）与出血边界（外扩），偏移量可调；柱面展开为平面稿，
   含刀版线、安全区、出血框、接缝与 8mm 搭接翼、尺寸标注、伸长率热力带与分布曲线。
   **轮廓或任一标签参数变化，展开稿经 120ms 防抖自动重算。**

## 运行

任意静态服务器即可（Worker 模块建议走 http，而非 file://）：

```bash
# 任选其一
npx serve .
python -m http.server 8080
```

浏览器打开对应地址。直接双击 index.html 也能运行主体功能，仅 module Worker 可能受限并自动降级为主线程渲染。

## 测试

```bash
node tests/geom-test.mjs       # 几何引擎数值验证（27 项：体积解析解、曲率、容量缩放、伸长率…）
node tests/browser-smoke.mjs   # headless Chrome 端到端（16 项：四界面、三画布、工单全链路）
node tests/reactive-flow.mjs   # 响应链（10 项：拖拽→体积/曲面/展开联动、曲率报警、偏移重算）
```

浏览器测试通过 Chrome DevTools Protocol 驱动本机 Chrome，无需安装依赖。

## 目录结构

```
index.html              入口 + import map
styles.css              设计令牌与全部样式（含深色模式）
vendor/solid-js/        本地 SolidJS ESM（离线）
src/
  geometry.js           纯函数几何引擎（样条/曲率/体积/伸长率/标签区）
  profile-editor.js     Canvas2D 半剖轮廓编辑器
  revolve-renderer.js   OffscreenCanvas 旋转曲面渲染
  unwrap-draw.js        展开稿绘制（Worker/主线程共用）
  unwrap-worker.js      OffscreenCanvas Worker
  unwrap-controller.js  Worker 调度 + 防抖 + 降级
  store.js              工单状态机、事件流、返工计数、持久化
  app.js                外壳与标签路由
  views/                四个界面
tests/                  三套自动化测试
```

## 工单状态机

```
new 待分派 ──分派──▶ assigned 设计中 ──提交──▶ submitted 待质检
                          ▲                        │
                          └──────── 打回 rework ◀───┤
                                                   └──合格──▶ passed 入库
```

每次打回 `reworkCount + 1` 并写入事件流；看板返工率 = 累计打回次数 ÷ 累计提交次数。
