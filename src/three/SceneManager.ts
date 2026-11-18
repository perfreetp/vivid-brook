import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ColorMode, LineKey, SplineLine, UnfoldResult, Vec2, WorkspaceState } from '../state/types';
import { sampleSpline, type SplineSample } from '../math/spline';
import { buildTerrainMesh, rampColor } from '../math/color';
import { offsetPolyline } from '../math/offset';
import { sampleGrid, type TerrainGrid } from '../math/terrain';
import { sampleAtStation } from '../math/spline';

const LINE_COLORS: Record<LineKey, number> = {
  center: 0x2563eb,
  leftCrest: 0xea580c,
  rightCrest: 0xea580c
};

const HOTSPOT = new THREE.Color(0xdc2626);

export interface SceneCallbacks {
  onDragStart: () => void;
  onDragMove: (key: LineKey, index: number, p: Vec2) => void;
  onDragEnd: () => void;
  onInsert: (key: LineKey, p: Vec2, index: number) => void;
  onPickStation?: (station: number) => void;
}

interface LineView {
  tube: THREE.Line;
  hotSegments: THREE.LineSegments;
  handles: THREE.Group;
  samples: SplineSample[];
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pickPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  private terrainMesh: THREE.Mesh | null = null;
  private terrainGrid: TerrainGrid | null = null;
  private boundaryGroup = new THREE.Group();
  private offsetGroup = new THREE.Group();
  private lineGroup = new THREE.Group();
  private sectionGroup = new THREE.Group();
  private stripGroup = new THREE.Group();
  private pointCloud: THREE.Points | null = null;

  private lineViews: Partial<Record<LineKey, LineView>> = {};
  private dragging: { key: LineKey; index: number } | null = null;
  private cb: SceneCallbacks;
  private state: WorkspaceState;
  private rafQueued = false;
  private container: HTMLElement;

  constructor(container: HTMLElement, state: WorkspaceState, cb: SceneCallbacks) {
    this.container = container;
    this.state = state;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xf1f5f9);
    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 1, 50000);
    this.camera.position.set(1200, -1400, 1100);
    this.camera.lookAt(1200, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(800, -900, 1500);
    this.scene.add(ambient, dir);

    const grid = new THREE.GridHelper(4000, 40, 0x94a3b8, 0xcbd5e1);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(1200, 0, -0.5);
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(grid);

    this.scene.add(this.boundaryGroup, this.offsetGroup, this.lineGroup, this.sectionGroup, this.stripGroup);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('dblclick', this.onDblClick);
    window.addEventListener('keydown', this.onKeyDown);
    new ResizeObserver(() => this.resize()).observe(container);

    this.animate();
  }

  setState(s: WorkspaceState): void {
    this.state = s;
  }

  setTerrainGrid(grid: TerrainGrid | null): void {
    this.terrainGrid = grid;
    this.rebuildTerrain();
  }

  getGrid(): TerrainGrid | null {
    return this.terrainGrid;
  }

  // ---------- 地形 ----------

  private rebuildTerrain(): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
      this.terrainMesh = null;
    }
    if (!this.terrainGrid) return;
    const { geometry } = buildTerrainMesh(this.terrainGrid, this.state.colorMode);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false
    });
    this.terrainMesh = new THREE.Mesh(geometry, mat);
    this.scene.add(this.terrainMesh);
  }

  refreshTerrainColor(mode: ColorMode): void {
    if (!this.terrainGrid) return;
    const old = this.terrainMesh;
    const { geometry } = buildTerrainMesh(this.terrainGrid, mode);
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
    this.terrainMesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.92 })
    );
    this.scene.add(this.terrainMesh);
  }

  // ---------- 原始点云与边界 ----------

  showPointCloud(): void {
    if (this.pointCloud) {
      this.scene.remove(this.pointCloud);
      this.pointCloud.geometry.dispose();
    }
    if (this.state.points.length === 0) return;
    const pos = new Float32Array(this.state.points.length * 3);
    this.state.points.forEach((p, i) => {
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z + 0.6;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.pointCloud = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0x334155, size: 4, sizeAttenuation: false })
    );
    this.scene.add(this.pointCloud);
  }

  showBoundaries(): void {
    this.boundaryGroup.clear();
    for (const b of this.state.boundaries) {
      if (b.points.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(
        b.points.map((p) => new THREE.Vector3(p.x, p.y, 1.2))
      );
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0x0f766e, linewidth: 2 })
      );
      this.boundaryGroup.add(line);
    }
  }

  // ---------- 堤线 / 中心线 ----------

  /** 高频刷新（拖拽中），rAF 合并 */
  scheduleLinesUpdate(): void {
    if (this.rafQueued) return;
    this.rafQueued = true;
    requestAnimationFrame(() => {
      this.rafQueued = false;
      this.updateAllLines();
    });
  }

  updateAllLines(): void {
    (Object.keys(this.state.lines) as LineKey[]).forEach((key) => this.updateLine(key));
    this.updateOffsetLines();
    if (this.state.section.visible) this.updateSection();
  }

  private updateLine(key: LineKey): void {
    const model: SplineLine = this.state.lines[key];
    const old = this.lineViews[key];
    if (old) {
      this.lineGroup.remove(old.tube, old.hotSegments, old.handles);
      old.tube.geometry.dispose();
      old.hotSegments.geometry.dispose();
      this.lineViews[key] = undefined;
    }
    if (!model.visible || model.controlPoints.length < 2) return;

    const samples = sampleSpline(model.controlPoints, 24, this.state.curvature.smoothWindow);
    const baseColor = new THREE.Color(LINE_COLORS[key]);

    // 沿线按曲率着色，超阈值段红色
    const positions: number[] = [];
    const colors: number[] = [];
    const tmp = new THREE.Color();
    samples.forEach((s) => {
      positions.push(s.p.x, s.p.y, 2.4);
      if (s.curvature >= this.state.curvature.threshold) tmp.copy(HOTSPOT);
      else tmp.copy(baseColor);
      colors.push(tmp.r, tmp.g, tmp.b);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const tube = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }));

    // 突变段加粗叠加
    const hotPos: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].curvature >= this.state.curvature.threshold && samples[i - 1].curvature >= this.state.curvature.threshold) {
        hotPos.push(samples[i - 1].p.x, samples[i - 1].p.y, 2.6, samples[i].p.x, samples[i].p.y, 2.6);
      }
    }
    const hotGeo = new THREE.BufferGeometry();
    hotGeo.setAttribute('position', new THREE.Float32BufferAttribute(hotPos, 3));
    const hotSegments = new THREE.LineSegments(
      hotGeo,
      new THREE.LineBasicMaterial({ color: HOTSPOT, linewidth: 3 })
    );

    // 控制点手柄（仅当前激活线显示）
    const handles = new THREE.Group();
    if (key === this.state.activeLine) {
      model.controlPoints.forEach((p, index) => {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(9, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0x713f12, emissiveIntensity: 0.35 })
        );
        sphere.position.set(p.x, p.y, 6);
        sphere.userData = { kind: 'handle', key, index };
        handles.add(sphere);
      });
    }

    this.lineGroup.add(tube, hotSegments, handles);
    this.lineViews[key] = { tube, hotSegments, handles, samples };
  }

  getLineSamples(key: LineKey): SplineSample[] {
    return this.lineViews[key]?.samples ?? [];
  }

  // ---------- 管理范围平行线 ----------

  private updateOffsetLines(): void {
    this.offsetGroup.clear();
    if (!this.state.offset.enabled) return;
    const { distance, corner, roundSegments, miterLimit } = this.state.offset;
    const sides: { key: LineKey; side: 1 | -1 }[] = [
      { key: 'leftCrest', side: 1 },
      { key: 'rightCrest', side: -1 }
    ];
    for (const { key, side } of sides) {
      const model = this.state.lines[key];
      if (model.controlPoints.length < 2) continue;
      const samples = sampleSpline(model.controlPoints, 12, this.state.curvature.smoothWindow);
      const dense = samples.map((s) => s.p);
      const off = offsetPolyline(dense, distance, side, corner, roundSegments, miterLimit);
      const geo = new THREE.BufferGeometry().setFromPoints(off.map((p) => new THREE.Vector3(p.x, p.y, 2.2)));
      const dashed = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x7c3aed, dashSize: 14, gapSize: 9 }));
      dashed.computeLineDistances();
      this.offsetGroup.add(dashed);
    }
  }

  // ---------- 横断面 ----------

  updateSection(): void {
    this.sectionGroup.clear();
    const samples = this.getLineSamples('center');
    if (samples.length < 2) return;
    const len = samples[samples.length - 1].s;
    const station = Math.max(0, Math.min(this.state.section.station, len));
    const smp = sampleAtStation(samples, station);
    const nx = -smp.tangent.y;
    const ny = smp.tangent.x;
    const hw = this.state.section.halfWidth;

    const groundPts: THREE.Vector3[] = [];
    const fillPts: THREE.Vector3[] = [];
    const steps = 40;
    for (let k = 0; k <= steps; k++) {
      const off = -hw + (2 * hw * k) / steps;
      const x = smp.p.x + nx * off;
      const y = smp.p.y + ny * off;
      const z = this.terrainGrid ? sampleGrid(this.terrainGrid, x, y) : null;
      const zz = z ?? 0;
      groundPts.push(new THREE.Vector3(x, y, zz + 0.8));
      fillPts.push(new THREE.Vector3(x, y, zz + 0.8), new THREE.Vector3(x, y, 0.4));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(groundPts);
    this.sectionGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xdc2626, linewidth: 3 })));
    const fillGeo = new THREE.BufferGeometry().setFromPoints(fillPts);
    this.sectionGroup.add(
      new THREE.LineSegments(fillGeo, new THREE.LineBasicMaterial({ color: 0xdc2626, opacity: 0.25, transparent: true }))
    );
  }

  /** 取横断面地形起伏数据供图表 */
  querySectionProfile(): { offset: number; z: number }[] {
    const samples = this.getLineSamples('center');
    if (samples.length < 2) return [];
    const smp = sampleAtStation(samples, this.state.section.station);
    const nx = -smp.tangent.y;
    const ny = smp.tangent.x;
    const hw = this.state.section.halfWidth;
    const out: { offset: number; z: number }[] = [];
    for (let k = 0; k <= 60; k++) {
      const off = -hw + (2 * hw * k) / 60;
      const x = smp.p.x + nx * off;
      const y = smp.p.y + ny * off;
      const z = this.terrainGrid ? sampleGrid(this.terrainGrid, x, y) : null;
      if (z !== null) out.push({ offset: off, z });
    }
    return out;
  }

  // ---------- 堤坡展开预览 ----------

  showStripPreview(rows: { crest3: { x: number; y: number; z: number }; toe3: { x: number; y: number; z: number } }[]): void {
    this.stripGroup.clear();
    const pos: number[] = [];
    for (let k = 1; k < rows.length; k++) {
      const a = rows[k - 1].crest3;
      const b = rows[k].crest3;
      const c = rows[k].toe3;
      const d = rows[k - 1].toe3;
      [a, b, c, a, c, d].forEach((p) => pos.push(p.x, p.y, p.z + 1.2));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.stripGroup.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
      )
    );
  }

  clearStripPreview(): void {
    this.stripGroup.clear();
  }

  showUnfoldOverlay(result: UnfoldResult): void {
    this.clearStripPreview();
    // 在场景右上角悬浮一个线框示意（正式成果图在组件面板中绘制）
    const group = new THREE.Group();
    const geo = new THREE.BufferGeometry().setFromPoints(
      result.outline.map((p) => new THREE.Vector3(p.x, p.y, 30))
    );
    group.add(new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0x9333ea })));
    const box = new THREE.Box3().setFromObject(group);
    const target = new THREE.Vector3(1900, 700, 0);
    group.position.set(target.x - box.min.x, target.y - box.min.y, 0);
    this.stripGroup.add(group);
  }

  // ---------- 交互 ----------

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private pickHandle(): { key: LineKey; index: number } | null {
    const view = this.lineViews[this.state.activeLine];
    if (!view) return null;
    const hits = this.raycaster.intersectObjects(view.handles.children, false);
    if (hits.length === 0) return null;
    const ud = hits[0].object.userData as { kind: string; key: LineKey; index: number };
    return ud.kind === 'handle' ? { key: ud.key, index: ud.index } : null;
  }

  private planePoint(e: PointerEvent): Vec2 | null {
    this.updatePointer(e);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.pickPlane, hit);
    return ok ? { x: hit.x, y: hit.y } : null;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.updatePointer(e);
    const handle = this.pickHandle();
    if (handle) {
      this.dragging = handle;
      this.controls.enabled = false;
      this.cb.onDragStart();
      this.renderer.domElement.style.cursor = 'grabbing';
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragging) {
      const p = this.planePoint(e);
      if (p) this.cb.onDragMove(this.dragging.key, this.dragging.index, p);
      return;
    }
    this.updatePointer(e);
    const handle = this.pickHandle();
    this.renderer.domElement.style.cursor = handle ? 'grab' : 'default';
  };

  private onPointerUp = (): void => {
    if (this.dragging) {
      this.dragging = null;
      this.controls.enabled = true;
      this.cb.onDragEnd();
      this.renderer.domElement.style.cursor = 'default';
    }
  };

  /** 双击空白处：在激活线上插入控制点（取最近样条采样位置） */
  private onDblClick = (e: MouseEvent): void => {
    this.updatePointer(e as unknown as PointerEvent);
    if (this.pickHandle()) return;
    const p = this.planePoint(e as unknown as PointerEvent);
    const view = this.lineViews[this.state.activeLine];
    if (!p || !view || view.samples.length < 2) return;
    let best = Infinity;
    let idx = 0;
    view.samples.forEach((s, i) => {
      const d = Math.hypot(s.p.x - p.x, s.p.y - p.y);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    // 反查应插入到哪个控制点之后：找到该采样所属控制点区间
    const perSegment = 24;
    const insertAfter = Math.min(
      this.state.lines[this.state.activeLine].controlPoints.length - 2,
      Math.floor(idx / perSegment)
    );
    this.cb.onInsert(this.state.activeLine, view.samples[idx].p, insertAfter);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // 删除最近的控制点
    const view = this.lineViews[this.state.activeLine];
    if (!view) return;
    // 简化策略：删除曲率最小/最末控制点由面板按钮负责，这里删除最后一个
    const line = this.state.lines[this.state.activeLine];
    if (line.controlPoints.length > 2) {
      this.dispatchDelete(this.state.activeLine, line.controlPoints.length - 1);
    }
  };

  /** 由面板按钮调用的删除入口（射线选最近手柄） */
  deleteNearestHandle(screenX: number, screenY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const handle = this.pickHandle();
    if (handle) this.dispatchDelete(handle.key, handle.index);
  }

  private dispatchDelete(key: LineKey, index: number): void {
    // 通过自定义事件交给 main 层调 store（保持 SceneManager 不直接依赖 store）
    window.dispatchEvent(new CustomEvent('river:delete-point', { detail: { key, index } }));
  }

  fitView(): void {
    const box = new THREE.Box3();
    let count = 0;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if ((mesh as THREE.Mesh).geometry && mesh.visible && o !== this.terrainMesh) {
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) return;
        box.union(b);
        count++;
      }
    });
    if (this.terrainMesh) {
      box.union(new THREE.Box3().setFromObject(this.terrainMesh));
      count++;
    }
    if (count === 0 || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, 800);
    this.camera.position.set(center.x + maxDim * 0.9, center.y - maxDim * 1.0, center.z + maxDim * 0.75);
    this.controls.target.copy(center);
    this.controls.update();
  }

  resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { rampColor };
