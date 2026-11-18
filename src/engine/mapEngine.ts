import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3, Matrix, Color3, Color4, Quaternion } from '@babylonjs/core/Maths/math';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh'; // thinInstance* 以 mixin 挂到 Mesh.prototype，必须显式导入
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Facility, FacilityType, LayerVisibility, TYPE_META, ViewState, Cluster } from '../types';
import { BuildingData } from '../types';
import { SpatialIndex, clusterize } from './spatial';

export type ZoomLevel = 'building' | 'floor' | 'room';
export type QuizMark = 'picked' | 'correct' | 'wrong';

export interface EngineCallbacks {
  onViewChange: (v: ViewState, zoom: ZoomLevel) => void;
  onSelectFacility: (f: Facility | null) => void;
  onSelectCluster: (c: Cluster) => void;
  onBoxSelect: (list: Facility[], rect: { xmin: number; ymin: number; xmax: number; ymax: number }) => void;
}

const HALF_H_MIN = 6;
const HALF_H_MAX = 95;
const ROOM_LEVEL = 16;   // 半高 <=16m 进入房间级，出单个图标与编号
const BUILDING_LEVEL = 42; // 半高 >=42m 进入楼栋级，聚合
const CLUSTER_CELL = 16;
const PICK_RADIUS = 2.8;

export class MapEngine {
  private engine: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private data: BuildingData;
  private index: SpatialIndex;
  private cb: EngineCallbacks;
  private overlay: HTMLElement;

  private view: ViewState = { cx: 48, cy: 31, halfH: 95, floor: 1 };
  private layers: LayerVisibility = { fire: true, gas: true, chem: true, util: true };
  private boxMode = false;

  private iconMeshes = new Map<FacilityType, Mesh>();
  private pipelineMesh!: Mesh;
  private roomFill!: Mesh;
  private roomBorder!: Mesh;
  private ringMesh!: Mesh;
  private markMesh!: Mesh;
  private roomMatrices = new Map<number, { fill: Matrix[]; border: Matrix[] }>();

  private highlightIds = new Set<string>();
  private quizMarks = new Map<string, QuizMark>();
  private selectedFacilityId: string | null = null;

  private tween: { t0: number; dur: number; from: ViewState; to: ViewState } | null = null;
  private drag: { px: number; py: number; moved: boolean; box: boolean; sx: number; sy: number } | null = null;
  private labelPool = new Map<string, HTMLDivElement>();
  private dirty = true;

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement, data: BuildingData, cb: EngineCallbacks) {
    this.data = data;
    this.cb = cb;
    this.overlay = overlay;
    this.index = new SpatialIndex(12);
    data.facilities.forEach(f => this.index.insert(f));

    this.engine = new Engine(canvas, true, { stencil: false, antialias: true }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString('#f1f5f9ff');
    this.camera = new FreeCamera('ortho', new Vector3(this.view.cx, this.view.cy, 100), this.scene);
    this.camera.setTarget(new Vector3(this.view.cx, this.view.cy, 0));
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.inputs.clear();

    this.buildStaticMeshes();
    this.buildIconMeshes();
    this.bindInput(canvas);

    this.engine.runRenderLoop(() => {
      this.stepTween();
      if (this.dirty) {
        this.rebuild();
        this.dirty = false;
      }
      this.scene.render();
    });
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  // ---------- 场景构建 ----------

  private buildStaticMeshes() {
    // 房间：每楼层预计算 thin instance 矩阵，切楼层只换 buffer，不重建资源（防闪烁）
    const fillMat = new StandardMaterial('roomFill', this.scene);
    fillMat.diffuseColor = Color3.FromHexString('#ffffff');
    fillMat.specularColor = Color3.Black();
    fillMat.alpha = 0.92;
    const borderMat = new StandardMaterial('roomBorder', this.scene);
    borderMat.diffuseColor = Color3.FromHexString('#94a3b8');
    borderMat.specularColor = Color3.Black();

    this.roomFill = MeshBuilder.CreatePlane('roomFill', { size: 1 }, this.scene);
    this.roomFill.material = fillMat;
    this.roomBorder = MeshBuilder.CreatePlane('roomBorder', { size: 1 }, this.scene);
    this.roomBorder.material = borderMat;

    for (const room of this.data.rooms) {
      let entry = this.roomMatrices.get(room.floor);
      if (!entry) {
        entry = { fill: [], border: [] };
        this.roomMatrices.set(room.floor, entry);
      }
      entry.border.push(Matrix.Scaling(room.w + 0.5, room.h + 0.5, 1)
        .multiply(Matrix.Translation(room.x + room.w / 2, room.y + room.h / 2, -0.05)));
      entry.fill.push(
        Matrix.Scaling(room.w, room.h, 1)
          .multiply(Matrix.Translation(room.x + room.w / 2, room.y + room.h / 2, 0))
      );
    }
  }

  private makeIconTexture(type: FacilityType): DynamicTexture {
    const tex = new DynamicTexture(`icon-${type}`, { width: 128, height: 128 }, this.scene, true);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const color = TYPE_META[type].color;
    ctx.clearRect(0, 0, 128, 128);
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(TYPE_META[type].short, 64, 68);
    tex.update();
    tex.hasAlpha = true;
    return tex;
  }

  private buildIconMeshes() {
    // 注意：不能用 clone()，其返回 AbstractMesh 不带 thinInstanceSetBuffer
    for (const type of ['gasCabinet', 'fumeHood', 'eyeWash', 'pipeline'] as FacilityType[]) {
      const mesh = MeshBuilder.CreatePlane(`icon-${type}`, { size: 1 }, this.scene);
      const mat = new StandardMaterial(`mat-${type}`, this.scene);
      if (type === 'pipeline') {
        mat.diffuseColor = Color3.FromHexString(TYPE_META.pipeline.color);
        mat.specularColor = Color3.Black();
        mesh.material = mat;
      } else {
        mat.diffuseTexture = this.makeIconTexture(type);
        mat.useAlphaFromDiffuseTexture = true;
        mat.emissiveColor = Color3.FromHexString(TYPE_META[type].color).scale(0.35);
        mat.specularColor = Color3.Black();
        mesh.material = mat;
      }
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(16), 16);
      mesh.doNotSyncBoundingInfo = true;
      this.iconMeshes.set(type, mesh);
    }
    this.pipelineMesh = this.iconMeshes.get('pipeline')!;

    // 高亮环（选中与同编号关联设备）
    const ringTex = new DynamicTexture('ring', { width: 128, height: 128 }, this.scene, true);
    const rctx = ringTex.getContext() as CanvasRenderingContext2D;
    rctx.clearRect(0, 0, 128, 128);
    rctx.beginPath();
    rctx.arc(64, 64, 54, 0, Math.PI * 2);
    rctx.lineWidth = 12;
    rctx.strokeStyle = '#facc15';
    rctx.stroke();
    ringTex.update();
    ringTex.hasAlpha = true;
    const ringMat = new StandardMaterial('ringMat', this.scene);
    ringMat.diffuseTexture = ringTex;
    ringMat.useAlphaFromDiffuseTexture = true;
    ringMat.emissiveColor = Color3.Yellow();
    this.ringMesh = MeshBuilder.CreatePlane('ring', { size: 1 }, this.scene);
    this.ringMesh.material = ringMat;
    this.ringMesh.thinInstanceSetBuffer('matrix', new Float32Array(16), 16);

    // 考核标记环（绿/红）
    const markMat = new StandardMaterial('markMat', this.scene);
    markMat.diffuseColor = Color3.Green();
    markMat.alpha = 0.9;
    this.markMesh = MeshBuilder.CreatePlane('mark', { size: 1 }, this.scene);
    this.markMesh.material = markMat;
    this.markMesh.thinInstanceSetBuffer('matrix', new Float32Array(16), 16);
    this.markMesh.thinInstanceSetBuffer('color', new Float32Array(4), 4);
  }

  // ---------- 输入 ----------

  private bindInput(canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      this.tween = null;
      this.drag = {
        px: e.clientX, py: e.clientY, moved: false,
        box: this.boxMode || e.shiftKey,
        sx: e.clientX, sy: e.clientY
      };
    });

    canvas.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.px;
      const dy = e.clientY - this.drag.py;
      if (Math.abs(e.clientX - this.drag.sx) + Math.abs(e.clientY - this.drag.sy) > 4) {
        this.drag.moved = true;
      }
      if (this.drag.box) {
        this.showRubber(this.drag.sx, this.drag.sy, e.clientX, e.clientY);
      } else if (dx || dy) {
        const s = this.worldPerPixel();
        this.view.cx -= dx * s;
        this.view.cy += dy * s;
        this.drag.px = e.clientX;
        this.drag.py = e.clientY;
        this.dirty = true;
      }
    });

    canvas.addEventListener('pointerup', e => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      this.hideRubber();
      if (d.box && d.moved) {
        // 必须分别对每个维度取极值，不能交叉组合两个点
        const p1 = this.screenToWorld(d.sx, d.sy);
        const p2 = this.screenToWorld(e.clientX, e.clientY);
        const rect = {
          xmin: Math.min(p1.x, p2.x), ymin: Math.min(p1.y, p2.y),
          xmax: Math.max(p1.x, p2.x), ymax: Math.max(p1.y, p2.y)
        };
        const list = this.index
          .queryRect(this.view.floor, rect.xmin, rect.ymin, rect.xmax, rect.ymax)
          .filter(f => this.layers[f.group]);
        this.cb.onBoxSelect(list, rect);
      } else if (!d.moved) {
        this.handleClick(e.clientX, e.clientY);
      }
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const before = this.screenToWorld(e.clientX, e.clientY);
      const factor = Math.exp(e.deltaY * 0.0015);
      this.view.halfH = Math.min(HALF_H_MAX, Math.max(HALF_H_MIN, this.view.halfH * factor));
      const after = this.screenToWorld(e.clientX, e.clientY);
      // 以光标为锚点缩放
      this.view.cx += before.x - after.x;
      this.view.cy += before.y - after.y;
      this.tween = null;
      this.dirty = true;
    }, { passive: false });

    canvas.addEventListener('dblclick', e => {
      const w = this.screenToWorld(e.clientX, e.clientY);
      this.flyTo(w.x, w.y, Math.max(HALF_H_MIN, this.view.halfH * 0.45));
    });
  }

  private rubber: HTMLDivElement | null = null;
  private showRubber(x1: number, y1: number, x2: number, y2: number) {
    if (!this.rubber) {
      this.rubber = document.createElement('div');
      this.rubber.style.cssText =
        'position:absolute;border:1.5px solid #2563eb;background:rgba(37,99,235,.12);pointer-events:none;z-index:5';
      this.overlay.appendChild(this.rubber);
    }
    const rect = (this.engine.getRenderingCanvas() as HTMLCanvasElement).getBoundingClientRect();
    const l = Math.min(x1, x2) - rect.left, t = Math.min(y1, y2) - rect.top;
    this.rubber.style.left = `${l}px`;
    this.rubber.style.top = `${t}px`;
    this.rubber.style.width = `${Math.abs(x2 - x1)}px`;
    this.rubber.style.height = `${Math.abs(y2 - y1)}px`;
  }
  private hideRubber() {
    this.rubber?.remove();
    this.rubber = null;
  }

  private handleClick(sx: number, sy: number) {
    const w = this.screenToWorld(sx, sy);
    if (this.zoomLevel() === 'building') {
      // 楼栋级：优先命中聚合块
      const clusters = this.currentClusters();
      let best: Cluster | null = null;
      let bestD = (CLUSTER_CELL / 2) ** 2;
      for (const c of clusters) {
        const d = (c.x - w.x) ** 2 + (c.y - w.y) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best) {
        this.cb.onSelectCluster(best);
        return;
      }
    }
    const hits = this.index
      .pick(this.view.floor, w.x, w.y, PICK_RADIUS)
      .filter(f => this.layers[f.group]);
    this.cb.onSelectFacility(hits[0] ?? null);
  }

  // ---------- 视口 / 坐标 ----------

  private onResize = () => {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.engine.setSize(w, h, false);
    this.dirty = true;
  };

  private worldPerPixel() {
    const canvas = this.engine.getRenderingCanvas()!;
    return (2 * this.view.halfH) / canvas.clientHeight;
  }

  screenToWorld(clientX: number, clientY: number) {
    const canvas = this.engine.getRenderingCanvas()!;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const s = this.worldPerPixel();
    return {
      x: this.view.cx + (px - rect.width / 2) * s,
      y: this.view.cy - (py - rect.height / 2) * s
    };
  }

  worldToScreen(x: number, y: number) {
    const canvas = this.engine.getRenderingCanvas()!;
    const rect = canvas.getBoundingClientRect();
    const s = this.worldPerPixel();
    return {
      x: rect.width / 2 + (x - this.view.cx) / s,
      y: rect.height / 2 - (y - this.view.cy) / s
    };
  }

  zoomLevel(): ZoomLevel {
    if (this.view.halfH >= BUILDING_LEVEL) return 'building';
    if (this.view.halfH <= ROOM_LEVEL) return 'room';
    return 'floor';
  }

  getView(): ViewState {
    return { ...this.view };
  }

  // ---------- 对外控制 ----------

  setLayers(vis: LayerVisibility) {
    this.layers = { ...vis };
    this.dirty = true;
  }

  setFloor(floor: number) {
    if (floor === this.view.floor) return;
    this.view.floor = floor;
    this.dirty = true;
  }

  setBoxSelectMode(on: boolean) {
    this.boxMode = on;
    const canvas = this.engine.getRenderingCanvas();
    if (canvas) canvas.style.cursor = on ? 'crosshair' : 'grab';
  }

  setHighlight(ids: string[]) {
    this.highlightIds = new Set(ids);
    this.dirty = true;
  }

  setQuizMarks(marks: Map<string, QuizMark>) {
    this.quizMarks = new Map(marks);
    this.dirty = true;
  }

  setSelected(id: string | null) {
    this.selectedFacilityId = id;
    this.dirty = true;
  }

  flyTo(cx: number, cy: number, halfH: number, dur = 650) {
    this.tween = {
      t0: performance.now(),
      dur,
      from: { ...this.view },
      to: { ...this.view, cx, cy, halfH: Math.min(HALF_H_MAX, Math.max(HALF_H_MIN, halfH)) }
    };
  }

  /** 搜索定位：逐级放大到房间级 */
  locateFacility(f: Facility) {
    this.setFloor(f.floor);
    this.flyTo(f.x, f.y, 9);
  }

  private stepTween() {
    if (!this.tween) return;
    const t = Math.min(1, (performance.now() - this.tween.t0) / this.tween.dur);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const a = this.tween.from, b = this.tween.to;
    this.view.cx = a.cx + (b.cx - a.cx) * e;
    this.view.cy = a.cy + (b.cy - a.cy) * e;
    this.view.halfH = a.halfH + (b.halfH - a.halfH) * e;
    this.dirty = true;
    if (t >= 1) this.tween = null;
  }

  // ---------- 每帧重建（视口裁剪 + 聚合） ----------

  private viewportRect() {
    const canvas = this.engine.getRenderingCanvas()!;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const halfW = this.view.halfH * aspect;
    return {
      xmin: this.view.cx - halfW,
      xmax: this.view.cx + halfW,
      ymin: this.view.cy - this.view.halfH,
      ymax: this.view.cy + this.view.halfH,
      halfW
    };
  }

  private currentClusters(): Cluster[] {
    const all = this.data.facilities.filter(
      f => f.floor === this.view.floor && this.layers[f.group]
    );
    return clusterize(all, this.view.floor, CLUSTER_CELL);
  }

  private rebuild() {
    const canvas = this.engine.getRenderingCanvas()!;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const halfW = this.view.halfH * aspect;
    this.camera.orthoLeft = this.view.cx - halfW;
    this.camera.orthoRight = this.view.cx + halfW;
    this.camera.orthoTop = this.view.cy + this.view.halfH;
    this.camera.orthoBottom = this.view.cy - this.view.halfH;
    this.camera.position.set(this.view.cx, this.view.cy, 100);

    // 楼层房间：仅切换预计算 buffer
    const rooms = this.roomMatrices.get(this.view.floor)!;
    this.roomFill.thinInstanceSetBuffer('matrix', this.flatten(rooms.fill), 16);
    this.roomBorder.thinInstanceSetBuffer('matrix', this.flatten(rooms.border), 16);

    const vp = this.viewportRect();
    const zoom = this.zoomLevel();

    // 视口裁剪：只取可见范围、当前楼层、开启图层的要素
    const visible = this.index
      .queryRect(this.view.floor, vp.xmin - 2, vp.ymin - 2, vp.xmax + 2, vp.ymax + 2)
      .filter(f => this.layers[f.group]);

    const buckets: Record<FacilityType, Matrix[]> = {
      gasCabinet: [], fumeHood: [], eyeWash: [], pipeline: []
    };
    const labelItems: { id: string; x: number; y: number; text: string; color: string; big: boolean }[] = [];

    if (zoom === 'building') {
      // 楼栋级：同层同类聚合块 + 数量
      const clusters = clusterize(visible, this.view.floor, CLUSTER_CELL);
      for (const c of clusters) {
        if (c.type === 'pipeline') {
          // 管线聚合用放大圆点表示
          buckets.pipeline.push(Matrix.Scaling(3.4, 3.4, 1).multiply(Matrix.Translation(c.x, c.y, 0.4)));
        } else {
          const scale = 2.6 + Math.min(1.4, c.count * 0.08);
          buckets[c.type].push(
            Matrix.Scaling(scale, scale, 1).multiply(Matrix.Translation(c.x, c.y, 0.4))
          );
        }
        labelItems.push({
          id: `cluster-${c.key}`, x: c.x, y: c.y,
          text: String(c.count), color: '#0f172a', big: true
        });
      }
    } else {
      // 楼层级 / 房间级：单图标 + 编号（房间级显示编号）
      const showCode = zoom === 'room';
      for (const f of visible) {
        if (f.type === 'pipeline' && f.path) {
          for (let i = 0; i < f.path.length - 1; i++) {
            const p1 = f.path[i], p2 = f.path[i + 1];
            const dx = p2.x - p1.x, dy = p2.y - p1.y;
            const len = Math.hypot(dx, dy);
            if (len < 0.01) continue;
            const angle = Math.atan2(dy, dx);
            const rot = Quaternion.RotationAxis(new Vector3(0, 0, 1), angle);
            const m = Matrix.Compose(
              new Vector3(len, 0.35, 1),
              rot,
              new Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0.15)
            );
            buckets.pipeline.push(m);
          }
        } else if (f.type !== 'pipeline') {
          const scale = 2.3;
          buckets[f.type].push(
            Matrix.Scaling(scale, scale, 1).multiply(Matrix.Translation(f.x, f.y, 0.5))
          );
          if (showCode) {
            labelItems.push({
              id: f.id, x: f.x, y: f.y, text: f.code.split('-').slice(1).join('-'),
              color: TYPE_META[f.type].color, big: false
            });
          }
        }
      }
    }

    for (const type of ['gasCabinet', 'fumeHood', 'eyeWash', 'pipeline'] as FacilityType[]) {
      const mesh = this.iconMeshes.get(type)!;
      const mats = buckets[type];
      mesh.thinInstanceSetBuffer('matrix', this.flatten(mats), 16);
      mesh.isVisible = mats.length > 0;
    }

    // 高亮环：选中设备 + 同编号关联设备
    const ringMats: Matrix[] = [];
    for (const f of visible) {
      if (this.highlightIds.has(f.id) || f.id === this.selectedFacilityId) {
        ringMats.push(Matrix.Scaling(2.8, 2.8, 1).multiply(Matrix.Translation(f.x, f.y, 0.8)));
      }
    }
    this.ringMesh.thinInstanceSetBuffer('matrix', this.flatten(ringMats), 16);
    this.ringMesh.isVisible = ringMats.length > 0;

    // 考核标记
    const markMats: Matrix[] = [];
    const markColors: number[] = [];
    for (const f of visible) {
      const mark = this.quizMarks.get(f.id);
      if (!mark) continue;
      markMats.push(Matrix.Scaling(2.6, 2.6, 1).multiply(Matrix.Translation(f.x, f.y, 0.85)));
      const c = mark === 'wrong' ? Color3.Red() : mark === 'correct' ? Color3.Green() : Color3.Yellow();
      markColors.push(c.r, c.g, c.b, 0.85);
    }
    this.markMesh.thinInstanceSetBuffer('matrix', this.flatten(markMats), 16);
    this.markMesh.thinInstanceSetBuffer('color', Float32Array.from(markColors), 4);
    this.markMesh.isVisible = markMats.length > 0;

    this.syncLabels(labelItems);
    this.cb.onViewChange(this.getView(), zoom);
  }

  private flatten(mats: Matrix[]): Float32Array {
    const out = new Float32Array(mats.length * 16);
    mats.forEach((m, i) => m.copyToArray(out, i * 16));
    return out;
  }

  /** DOM 标签池：同帧随 Babylon buffer 一起更新，图层切换不销毁节点，避免闪烁 */
  private syncLabels(items: { id: string; x: number; y: number; text: string; color: string; big: boolean }[]) {
    const canvas = this.engine.getRenderingCanvas()!;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const alive = new Set<string>();
    for (const it of items) {
      alive.add(it.id);
      let div = this.labelPool.get(it.id);
      if (!div) {
        div = document.createElement('div');
        div.style.cssText =
          'position:absolute;transform:translate(-50%,-50%);pointer-events:none;white-space:nowrap;' +
          'font-family:"Microsoft YaHei",sans-serif;z-index:4;will-change:left,top';
        this.overlay.appendChild(div);
        this.labelPool.set(it.id, div);
      }
      const p = this.worldToScreen(it.x, it.y);
      const inView = p.x > -60 && p.x < W + 60 && p.y > -40 && p.y < H + 40;
      if (!inView) {
        div.style.display = 'none';
        continue;
      }
      div.style.left = `${p.x}px`;
      div.style.top = `${p.y + (it.big ? 26 : -20)}px`;
      div.textContent = it.text;
      div.style.fontSize = it.big ? 'bold 13px sans-serif' : '10px sans-serif';
      div.style.fontWeight = it.big ? '700' : '600';
      div.style.color = it.big ? '#0f172a' : it.color;
      div.style.background = it.big ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.7)';
      div.style.padding = it.big ? '1px 6px' : '0 3px';
      div.style.borderRadius = '8px';
      div.style.display = 'block';
    }
    for (const [id, div] of this.labelPool) {
      if (!alive.has(id)) div.style.display = 'none';
    }
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.engine.dispose();
    this.overlay.innerHTML = '';
    this.labelPool.clear();
  }
}
