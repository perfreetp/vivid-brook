// 全局数据类型定义

export interface Vec2 {
  x: number;
  y: number;
}

/** 断面高程点（x,y 为工程平面坐标，单位 m；z 为高程，单位 m） */
export interface ElevationPoint {
  x: number;
  y: number;
  z: number;
}

/** 河道边界折线（左岸 / 右岸） */
export interface Boundary {
  id: string;
  name: string;
  points: Vec2[];
}

export type LineKey = 'center' | 'leftCrest' | 'rightCrest';

export interface SplineLine {
  key: LineKey;
  name: string;
  /** 样条控制点 */
  controlPoints: Vec2[];
  visible: boolean;
}

export type ColorMode = 'elevation' | 'slope' | 'curvature';
export type CornerMode = 'round' | 'miter';

export interface OffsetSpec {
  enabled: boolean;
  /** 等距偏移距离 m（岸线向河道外侧） */
  distance: number;
  corner: CornerMode;
  /** 圆角模式下的分段数 */
  roundSegments: number;
  /** 尖角模式下的斜接限制（倍数） */
  miterLimit: number;
}

export interface TerrainSettings {
  /** 栅格分辨率 m/格 */
  resolution: number;
  /** IDW 幂参数 */
  idwPower: number;
}

export interface CurvatureSettings {
  /** 曲率突变阈值 1/m，超过即红色提醒 */
  threshold: number;
  /** 突变平滑窗口（采样点数） */
  smoothWindow: number;
}

export interface SectionState {
  /** 断面所在中心线里程 m */
  station: number;
  /** 断面半宽 m */
  halfWidth: number;
  visible: boolean;
}

export interface UnfoldRequest {
  /** 堤坡侧：left / right */
  side: 'left' | 'right';
  /** 起始/终止里程 m */
  stationStart: number;
  stationEnd: number;
}

export interface UnfoldResult {
  id: string;
  createdAt: string;
  side: 'left' | 'right';
  stationStart: number;
  stationEnd: number;
  /** 展开面积 m² */
  area: number;
  /** 坡长（沿坡脚→堤顶方向的平均长度）m */
  slopeLength: number;
  crestLength: number;
  toeLength: number;
  /** 展开平面外轮廓（局部二维坐标，单位 m） */
  outline: Vec2[];
  /** 等高程等值线（局部二维坐标），用于成果图 */
  contours: { level: number; paths: Vec2[][] }[];
}

/** 版本快照：一次“档案加工”时保存的完整建模成果 */
export interface ProjectSnapshot {
  center: Vec2[];
  leftCrest: Vec2[];
  rightCrest: Vec2[];
  offset: OffsetSpec;
  colorMode: ColorMode;
  terrainSettings: TerrainSettings;
  curvatureSettings: CurvatureSettings;
  pointCount: number;
  /** 成果统计 */
  stats: SnapshotStats;
  note: string;
}

export interface SnapshotStats {
  centerLength: number;
  leftCrestLength: number;
  rightCrestLength: number;
  terrainArea: number;
  elevationMin: number;
  elevationMax: number;
  maxSlopeDeg: number;
  maxCurvature: number;
  hotspotCount: number;
}

export interface ProjectVersion {
  version: number;
  createdAt: string;
  snapshot: ProjectSnapshot;
  report: string;
}

export interface ProjectMeta {
  /** 项目建档编号，如 SL-2026-0007 */
  code: string;
  name: string;
  river: string;
  reach: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  meta: ProjectMeta;
  versions: ProjectVersion[];
}

/** 运行期工作区状态（不入库，入库走快照） */
export interface WorkspaceState {
  projectCode: string;
  projectName: string;
  river: string;
  reach: string;

  points: ElevationPoint[];
  boundaries: Boundary[];
  lines: Record<LineKey, SplineLine>;
  activeLine: LineKey;

  terrain: TerrainSettings;
  curvature: CurvatureSettings;
  offset: OffsetSpec;
  colorMode: ColorMode;
  section: SectionState;

  unfold: UnfoldRequest | null;
  unfoldResults: UnfoldResult[];
}
