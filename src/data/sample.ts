import type { LampModel, ProjectData, Vec3, Vec2, Lamp } from '../types';

export const LAMP_MODELS: LampModel[] = [
  {
    id: 'LM-01',
    manufacturer: '山光照明',
    name: '步道灯 TP-30（点光源）',
    ratedPower: 30,
    efficacy: 110,
    cctOptions: [2700, 3000, 4000],
    beamOptions: [30, 60, 90],
    defaultCct: 3000,
    defaultBeam: 60,
    sourceSize: 0,
    ip: 'IP66',
  },
  {
    id: 'LM-02',
    manufacturer: '山光照明',
    name: '庭院灯 CT-60（面光源）',
    ratedPower: 60,
    efficacy: 105,
    cctOptions: [2700, 3000, 4000, 5000],
    beamOptions: [60, 90, 120],
    defaultCct: 3000,
    defaultBeam: 90,
    sourceSize: 0.32,
    ip: 'IP65',
  },
  {
    id: 'LM-03',
    manufacturer: '岭景光电',
    name: '投光灯 FL-100（面光源）',
    ratedPower: 100,
    efficacy: 120,
    cctOptions: [3000, 4000, 5700, 6500],
    beamOptions: [15, 30, 60],
    defaultCct: 4000,
    defaultBeam: 30,
    sourceSize: 0.45,
    ip: 'IP66',
  },
];

function poly(ring: Vec2[], elev: (x: number, y: number) => number): Vec3[][] {
  return [ring.map(([x, y]) => [x, y, elev(x, y)] as Vec3)];
}

/** 示例：一条爬升约 12m 的山地步道，含 3 段台阶、挡墙、树冠与一处建筑 */
export function buildSampleProject(): ProjectData {
  // 中线：折线爬升，z 为地面高程
  const centerline: Vec3[] = [
    [0, 0, 48.0],
    [12, 2, 48.6],
    [24, 8, 49.4],
    [36, 6, 50.6],
    [48, 12, 52.0],
    [60, 10, 53.6],
    [72, 16, 55.2],
    [84, 14, 56.8],
    [96, 20, 58.4],
    [108, 18, 59.6],
    [120, 24, 60.4],
  ];
  const ground = (x: number, y: number): number => 48 + (x / 120) * 12 + y * 0.02;

  const project: ProjectData = {
    name: '示例·云栖岭登山步道',
    centerline: {
      id: 'cl-1',
      geometry: { type: 'LineString', coordinates: centerline },
      properties: { name: '主步道中线' },
    },
    steps: [
      {
        id: 'step-1',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [22, 4.5],
              [30, 4.5],
              [30, 9.5],
              [22, 9.5],
            ],
            ground,
          ),
        },
        properties: { kind: 'step', name: '一号台阶（高差1.2m）', topElev: 50.8, bottomElev: 49.6 },
      },
      {
        id: 'step-2',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [58, 7.5],
              [66, 7.5],
              [66, 12.5],
              [58, 12.5],
            ],
            ground,
          ),
        },
        properties: { kind: 'step', name: '二号台阶（高差1.6m）', topElev: 55.0, bottomElev: 53.4 },
      },
      {
        id: 'step-3',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [94, 15.5],
              [102, 15.5],
              [102, 20.5],
              [94, 20.5],
            ],
            ground,
          ),
        },
        properties: { kind: 'step', name: '三号台阶（高差1.2m）', topElev: 59.4, bottomElev: 58.2 },
      },
    ],
    walls: [
      {
        id: 'wall-1',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [30, 9.2],
              [44, 9.2],
              [44, 11.2],
              [30, 11.2],
            ],
            ground,
          ),
        },
        properties: { kind: 'wall', name: '半山挡墙', baseElev: 49.8, height: 2.2 },
      },
      {
        id: 'wall-2',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [78, 13.2],
              [92, 13.2],
              [92, 15.0],
              [78, 15.0],
            ],
            ground,
          ),
        },
        properties: { kind: 'wall', name: '观景台挡墙', baseElev: 56.4, height: 1.8 },
      },
    ],
    canopies: [
      {
        id: 'canopy-1',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [10, -4],
              [20, -4],
              [20, 2],
              [10, 2],
            ],
            ground,
          ),
        },
        properties: { kind: 'canopy', name: '香樟冠层 A', trunkTop: ground(15, -1) + 2.4, canopyTop: ground(15, -1) + 7.5, transmittance: 0.35 },
      },
      {
        id: 'canopy-2',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [48, 16],
              [60, 16],
              [60, 23],
              [48, 23],
            ],
            ground,
          ),
        },
        properties: { kind: 'canopy', name: '香樟冠层 B', trunkTop: ground(54, 19) + 2.6, canopyTop: ground(54, 19) + 8.0, transmittance: 0.3 },
      },
      {
        id: 'canopy-3',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [100, 6],
              [112, 6],
              [112, 13],
              [100, 13],
            ],
            ground,
          ),
        },
        properties: { kind: 'canopy', name: '马尾松冠层', trunkTop: ground(106, 9) + 3.0, canopyTop: ground(106, 9) + 9.5, transmittance: 0.25 },
      },
    ],
    buildings: [
      {
        id: 'bld-1',
        geometry: {
          type: 'Polygon',
          coordinates: poly(
            [
              [66, -6],
              [82, -6],
              [82, 6],
              [66, 6],
            ],
            ground,
          ),
        },
        properties: { kind: 'building', name: '半山服务驿站', baseElev: ground(74, 0), height: 6.5 },
      },
    ],
    lampModels: LAMP_MODELS,
    lamps: [],
  };

  project.lamps = seedLamps(centerline);
  return project;
}

function seedLamps(centerline: Vec3[]): Lamp[] {
  const stations = [0.05, 0.18, 0.31, 0.44, 0.57, 0.7, 0.83, 0.95];
  return stations.map((st, i): Lamp => {
    const p = interpLine(centerline, st);
    const modelId = i === 5 ? 'LM-03' : i % 2 === 0 ? 'LM-02' : 'LM-01';
    const model = LAMP_MODELS.find((m) => m.id === modelId)!;
    // 步道灯默认宽光束+大遮光角，保证连续覆盖且控制眩光
    const beam = modelId === 'LM-01' ? 90 : modelId === 'LM-03' ? 30 : 120;
    return {
      id: `lamp-${i + 1}`,
      modelId,
      station: st,
      x: p.x,
      y: p.y,
      groundZ: p.z,
      poleHeightOverride: null,
      luminaireHeight: 4.5,
      power: model.ratedPower,
      cct: model.defaultCct,
      beamAngle: beam,
      aimAzimuth: null,
      aimTilt: 60,
      shieldAngle: 75,
      schedule: {
        weekday: true,
        festival: true,
        lateNight: i % 2 === 0,
      },
    };
  });
}

export function interpLine(line: Vec3[], station: number): { x: number; y: number; z: number } {
  const seg = station * (line.length - 1);
  const i = Math.min(line.length - 2, Math.floor(seg));
  const t = seg - i;
  const a = line[i];
  const b = line[i + 1];
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    z: a[2] + (b[2] - a[2]) * t,
  };
}
