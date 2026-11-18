import type {
  Lamp,
  LampModel,
  PlanVersion,
  ProjectData,
  ReviewComment,
  ScheduleKey,
} from '../types';
import { buildSampleProject } from '../data/sample';
import { computeLighting, type LightingResult } from './engine';
import { polylineInfo, snapToPolyline } from './geometry';
import { suggestPoleHeight } from './photometry';
import { lineCoords } from '../types';

export interface LayerVisibility {
  steps: boolean;
  walls: boolean;
  canopies: boolean;
  buildings: boolean;
  heat: boolean;
  contours: boolean;
  dimZones: boolean;
  lamps: boolean;
  aim: boolean;
  shadows: boolean;
}

export interface AppState {
  project: ProjectData;
  schedule: ScheduleKey;
  selectedLampId: string | null;
  layers: LayerVisibility;
  result: LightingResult | null;
  busy: boolean;
  versions: PlanVersion[];
  activePanel: 'lamps' | 'dim' | 'ledger' | 'review';
  locateToken: number; // 自增，地图视图据此定位
  locateAt: { x: number; y: number } | null;
}

type Listener = (state: AppState) => void;

const STORAGE_KEY = 'trail-lighting-state-v1';

class Store {
  private state: AppState;
  private listeners = new Set<Listener>();
  private calcTimer: number | null = null;
  private calcSeq = 0;

  constructor() {
    this.state = {
      project: buildSampleProject(),
      schedule: 'weekday',
      selectedLampId: null,
      layers: {
        steps: true,
        walls: true,
        canopies: true,
        buildings: true,
        heat: true,
        contours: true,
        dimZones: true,
        lamps: true,
        aim: true,
        shadows: false,
      },
      result: null,
      busy: true,
      versions: [],
      activePanel: 'lamps',
      locateToken: 0,
      locateAt: null,
    };
  }

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  /** 项目几何/灯具变化后重算（微任务合并，避免拖拽时风暴） */
  scheduleRecompute(): void {
    if (this.calcTimer !== null) clearTimeout(this.calcTimer);
    this.state = { ...this.state, busy: true };
    this.emit();
    const seq = ++this.calcSeq;
    this.calcTimer = window.setTimeout(() => {
      const result = computeLighting(this.state.project, this.state.schedule);
      if (seq !== this.calcSeq) return;
      this.state = { ...this.state, result, busy: false };
      this.persist();
      this.emit();
    }, 60);
  }

  recomputeNow(): LightingResult {
    const result = computeLighting(this.state.project, this.state.schedule);
    this.state = { ...this.state, result, busy: false };
    return result;
  }

  setSchedule(key: ScheduleKey): void {
    this.state = { ...this.state, schedule: key, selectedLampId: null };
    this.scheduleRecompute();
  }

  toggleLayer(key: keyof LayerVisibility): void {
    this.state = {
      ...this.state,
      layers: { ...this.state.layers, [key]: !this.state.layers[key] },
    };
    this.emit();
  }

  setPanel(panel: AppState['activePanel']): void {
    this.state = { ...this.state, activePanel: panel };
    this.emit();
  }

  selectLamp(id: string | null): void {
    this.state = { ...this.state, selectedLampId: id };
    this.emit();
  }

  locate(x: number, y: number): void {
    this.state = { ...this.state, locateAt: { x, y }, locateToken: this.state.locateToken + 1 };
    this.emit();
  }

  updateLamp(id: string, patch: Partial<Lamp>): void {
    this.state = {
      ...this.state,
      project: {
        ...this.state.project,
        lamps: this.state.project.lamps.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      },
    };
    this.scheduleRecompute();
  }

  /** 拖拽落点：吸附中线，刷新桩号、平面位置与地面高程，杆高自动建议随之更新 */
  placeLamp(id: string, x: number, y: number): void {
    const info = polylineInfo(lineCoords(this.state.project.centerline.geometry));
    const snap = snapToPolyline(info, x, y);
    this.updateLamp(id, { station: snap.station, x: snap.x, y: snap.y, groundZ: snap.z });
  }

  addLamp(x: number, y: number, modelId?: string): Lamp {
    const info = polylineInfo(lineCoords(this.state.project.centerline.geometry));
    const snap = snapToPolyline(info, x, y);
    const model =
      this.state.project.lampModels.find((m) => m.id === modelId) ??
      this.state.project.lampModels[0];
    const id = `lamp-${Date.now().toString(36)}`;
    const lamp: Lamp = {
      id,
      modelId: model.id,
      station: snap.station,
      x: snap.x,
      y: snap.y,
      groundZ: snap.z,
      poleHeightOverride: null,
      luminaireHeight: 4.5,
      power: model.ratedPower,
      cct: model.defaultCct,
      beamAngle: model.defaultBeam,
      aimAzimuth: null,
      aimTilt: 60,
      shieldAngle: 70,
      schedule: { weekday: true, festival: true, lateNight: false },
    };
    this.state = {
      ...this.state,
      project: { ...this.state.project, lamps: [...this.state.project.lamps, lamp] },
      selectedLampId: id,
    };
    this.scheduleRecompute();
    return lamp;
  }

  removeLamp(id: string): void {
    this.state = {
      ...this.state,
      selectedLampId: this.state.selectedLampId === id ? null : this.state.selectedLampId,
      project: {
        ...this.state.project,
        lamps: this.state.project.lamps.filter((l) => l.id !== id),
      },
    };
    this.scheduleRecompute();
  }

  changeModel(id: string, modelId: string): void {
    const model = this.state.project.lampModels.find((m) => m.id === modelId);
    if (!model) return;
    this.updateLamp(id, {
      modelId,
      power: model.ratedPower,
      cct: model.defaultCct,
      beamAngle: model.defaultBeam,
    });
  }

  /** 型号库变化（导入），并把越界参数钳回可选值 */
  setLampModels(models: LampModel[]): void {
    const lamps = this.state.project.lamps.map((l) => {
      const m = models.find((mm) => mm.id === l.modelId);
      if (!m) return l;
      return {
        ...l,
        power: Math.min(l.power, m.ratedPower),
        cct: m.cctOptions.includes(l.cct) ? l.cct : m.defaultCct,
        beamAngle: m.beamOptions.includes(l.beamAngle) ? l.beamAngle : m.defaultBeam,
      };
    });
    this.state = {
      ...this.state,
      project: { ...this.state.project, lampModels: models, lamps },
    };
    this.scheduleRecompute();
  }

  loadProject(project: ProjectData): void {
    this.state = {
      ...this.state,
      project,
      selectedLampId: null,
      versions: [],
    };
    this.scheduleRecompute();
  }

  // ---- 版本与审核 ----
  submitPlan(author = '设计师'): PlanVersion {
    const version: PlanVersion = {
      id: `ver-${Date.now().toString(36)}`,
      label: `V${this.state.versions.length + 1}`,
      at: new Date().toISOString(),
      author,
      lamps: structuredClone(this.state.project.lamps),
      status: 'submitted',
      comments: [],
    };
    this.state = { ...this.state, versions: [...this.state.versions, version], activePanel: 'review' };
    this.persist();
    this.emit();
    return version;
  }

  reviewVersion(id: string, approve: boolean, text: string, reviewer = '照明审核人'): void {
    const comment: ReviewComment = {
      id: `c-${Date.now().toString(36)}`,
      author: reviewer,
      role: 'reviewer',
      text,
      at: new Date().toISOString(),
    };
    this.state = {
      ...this.state,
      versions: this.state.versions.map((v) =>
        v.id === id
          ? { ...v, status: approve ? 'approved' : 'rejected', comments: [...v.comments, comment] }
          : v,
      ),
    };
    this.persist();
    this.emit();
  }

  addVersionComment(id: string, text: string, author: string, role: ReviewComment['role']): void {
    const comment: ReviewComment = {
      id: `c-${Date.now().toString(36)}`,
      author,
      role,
      text,
      at: new Date().toISOString(),
    };
    this.state = {
      ...this.state,
      versions: this.state.versions.map((v) =>
        v.id === id ? { ...v, comments: [...v.comments, comment] } : v,
      ),
    };
    this.persist();
    this.emit();
  }

  /** 回退到历史版本灯具布置 */
  restoreVersion(id: string): void {
    const v = this.state.versions.find((x) => x.id === id);
    if (!v) return;
    this.state = {
      ...this.state,
      project: { ...this.state.project, lamps: structuredClone(v.lamps) },
      selectedLampId: null,
    };
    this.scheduleRecompute();
  }

  suggestedHeight(id: string): number {
    const lamp = this.state.project.lamps.find((l) => l.id === id);
    return lamp ? suggestPoleHeight(lamp, this.state.project) : 4.5;
  }

  persist(): void {
    try {
      const { project, schedule, versions } = this.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ project, schedule, versions }));
    } catch {
      /* 存储不可用时静默 */
    }
  }

  restore(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as Pick<AppState, 'project' | 'schedule' | 'versions'>;
      this.state = { ...this.state, ...data, result: null, busy: true };
      this.scheduleRecompute();
      return true;
    } catch {
      return false;
    }
  }
}

export const store = new Store();
