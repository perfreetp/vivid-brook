// 全局数据模型：本地平面坐标系，单位为米，z 为高程（米）

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** 几何类型（GeoJSON 风格的本地简化版） */
export type Geometry =
  | { type: 'LineString'; coordinates: Vec3[] }
  | { type: 'Polygon'; coordinates: Vec3[][] }; // 第一个环为外环，其余为洞

export function isLineString(g: Geometry): g is { type: 'LineString'; coordinates: Vec3[] } {
  return g.type === 'LineString';
}

export function isPolygon(g: Geometry): g is { type: 'Polygon'; coordinates: Vec3[][] } {
  return g.type === 'Polygon';
}

/** 取多边形外环（类型守卫收窄用） */
export function polygonRings(g: Geometry): Vec3[][] {
  return isPolygon(g) ? g.coordinates : [];
}

/** 取线串坐标 */
export function lineCoords(g: Geometry): Vec3[] {
  return isLineString(g) ? g.coordinates : [];
}

export interface Feature<Props = Record<string, unknown>> {
  id: string;
  geometry: Geometry;
  properties: Props;
}

/** 台阶：覆盖踏面范围，topElev 为台阶上沿高程，bottomElev 为下沿高程 */
export interface StepProps {
  kind: 'step';
  name?: string;
  topElev: number;
  bottomElev: number;
}

/** 挡墙：baseElev 墙底高程，height 墙高 */
export interface WallProps {
  kind: 'wall';
  name?: string;
  baseElev: number;
  height: number;
}

/** 树冠：下沿 trunkTop（分枝点）、上沿 canopyTop，透射率 0~1 */
export interface CanopyProps {
  kind: 'canopy';
  name?: string;
  trunkTop: number;
  canopyTop: number;
  transmittance: number;
}

/** 建筑轮廓：baseElev 室外地面，height 建筑高度 */
export interface BuildingProps {
  kind: 'building';
  name?: string;
  baseElev: number;
  height: number;
}

export type OccluderProps = WallProps | CanopyProps | BuildingProps;

/** 灯具型号库条目 */
export interface LampModel {
  id: string;
  manufacturer: string;
  name: string;
  ratedPower: number; // W
  efficacy: number; // lm/W
  cctOptions: number[]; // 可选色温 K
  beamOptions: number[]; // 可选全角光束角 deg
  defaultCct: number;
  defaultBeam: number;
  sourceSize: number; // 发光面等效直径 m，0 表示点光源
  ip: string;
}

/** 遮光角（眩光控制）：与下垂线的最大允许夹角，deg；超过即不出光 */
export interface Lamp {
  id: string;
  modelId: string;
  /** 吸附到中线后的桩号位置 0..1（沿线归一化） */
  station: number;
  x: number;
  y: number;
  groundZ: number; // 所在地面高程
  /** 灯杆长度（地面到光源），由台阶高差建议，可手动覆盖；null 表示采用自动建议 */
  poleHeightOverride: number | null;
  /** 光源中心距步道踏面的标称高度（产品安装基准，默认 4.5m） */
  luminaireHeight: number;
  power: number; // W，可在额定功率内调节
  cct: number; // K
  beamAngle: number; // 全角 deg
  /** 投射方向：平面方位角 deg，0 = +X，逆时针；null = 垂直向下 */
  aimAzimuth: number | null;
  /** 投射俯角 deg（相对水平面的俯角，垂直向下=90） */
  aimTilt: number;
  /** 遮光角 deg：光线与下垂线夹角超过此值被截止 */
  shieldAngle: number;
  /** 三套开关策略下是否点亮 */
  schedule: {
    weekday: boolean;
    festival: boolean;
    lateNight: boolean;
  };
}

export type ScheduleKey = 'weekday' | 'festival' | 'lateNight';

export interface ProjectData {
  name: string;
  centerline: Feature<{ name?: string }>; // LineString，z 为步道地面高程
  steps: Feature<StepProps>[];
  walls: Feature<WallProps>[];
  canopies: Feature<CanopyProps>[];
  buildings: Feature<BuildingProps>[];
  lampModels: LampModel[];
  lamps: Lamp[];
}

export interface ReviewComment {
  id: string;
  author: string;
  role: 'designer' | 'reviewer';
  text: string;
  at: string; // ISO 时间
}

export interface PlanVersion {
  id: string;
  label: string;
  at: string;
  author: string;
  lamps: Lamp[];
  status: 'submitted' | 'approved' | 'rejected';
  comments: ReviewComment[];
}

export interface GridCell {
  ix: number;
  iy: number;
  x: number; // 网格中心
  y: number;
  z: number;
  illuminance: number; // lx
  onTrail: boolean;
}

export interface DimZone {
  id: string;
  /** 等值面多边形集合，每个多边形 [外环, ...洞] */
  rings: Vec2[][][];
  areaM2: number;
  centroid: Vec2;
  minLux: number;
  meanLux: number;
}

export interface ProfileSample {
  station: number; // 0..1
  s: number; // 累计里程 m
  x: number;
  y: number;
  groundZ: number;
  lamp: Lamp | null;
  lampLightZ: number | null;
  poleBaseZ: number | null;
}
