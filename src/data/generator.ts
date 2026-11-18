import {
  BuildingData,
  Facility,
  FacilityType,
  FloorInfo,
  LayerGroup,
  Room,
  TYPE_META
} from '../types';

/** 确定性伪随机，保证每次生成的数据一致（考核答案稳定） */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOM_USAGES = [
  '有机化学实验室', '分析检测实验室', '无机化学实验室', '物化实验室',
  '气瓶间', '试剂库房', '样品前处理室', '仪器分析室',
  '准备室', '危废暂存间', '生化实验室', '教学实验室'
];

const SPEC_MAP: Record<FacilityType, string[]> = {
  gasCabinet: ['单瓶防爆气瓶柜', '双瓶报警气瓶柜', '三瓶智能气瓶柜'],
  fumeHood: ['1.5m 全钢通风橱', '1.8m 补风型通风橱', '1.2m 台式通风橱'],
  eyeWash: ['复合式紧急冲淋洗眼器', '壁挂式洗眼器', '台式洗眼器'],
  pipeline: ['不锈钢气体管线 DN15', 'PP 排风管道 DN250', 'UPVC 给排水管 DN50']
};

const TYPE_CODE_PREFIX: Record<FacilityType, string> = {
  gasCabinet: 'GC',
  fumeHood: 'FH',
  eyeWash: 'EW',
  pipeline: 'PL'
};

export const BUILDING_NAME = '化学实验楼';
export const FLOOR_COUNT = 8;
const COLS = 8;
const ROWS = 6;
const CELL_W = 10;
const CELL_H = 8;
const GAP = 2;

export function generateBuilding(seed = 20261119): BuildingData {
  const rnd = mulberry32(seed);
  const rooms: Room[] = [];
  const facilities: Facility[] = [];
  const floorList: FloorInfo[] = [];

  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const codeCounter: Record<string, number> = {};
  const nextCode = (type: FacilityType, floor: number) => {
    const prefix = TYPE_CODE_PREFIX[type];
    const key = `${floor}-${prefix}`;
    codeCounter[key] = (codeCounter[key] || 0) + 1;
    return `F${floor}-${prefix}-${String(codeCounter[key]).padStart(4, '0')}`;
  };

  for (let floor = 1; floor <= FLOOR_COUNT; floor++) {
    floorList.push({ building: BUILDING_NAME, floor, label: `${floor}F` });

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const x = c * (CELL_W + GAP) + GAP;
        const y = r * (CELL_H + GAP) + GAP;
        const roomId = `F${floor}-R${String(idx + 1).padStart(3, '0')}`;
        const room: Room = {
          id: roomId,
          name: `${floor}F${String(idx + 1).padStart(2, '0')}室`,
          building: BUILDING_NAME,
          floor,
          x, y, w: CELL_W, h: CELL_H,
          usage: pick(ROOM_USAGES)
        };
        rooms.push(room);

        const push = (type: FacilityType, fx: number, fy: number, path?: Facility['path']) => {
          const code = nextCode(type, floor);
          const group: LayerGroup = TYPE_META[type].group;
          facilities.push({
            id: `${roomId}-${type}-${facilities.length}`,
            code,
            type,
            group,
            building: BUILDING_NAME,
            floor,
            roomId: room.id,
            roomName: room.name,
            x: Math.round(fx * 100) / 100,
            y: Math.round(fy * 100) / 100,
            linkedCode: code,
            path,
            spec: pick(SPEC_MAP[type]),
            status: rnd() < 0.12 ? '待检' : rnd() < 0.05 ? '停用' : '正常',
            installDate: `${2018 + Math.floor(rnd() * 8)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-15`
          });
          return code;
        };

        // 气瓶柜：0~3 台，沿房间上墙排列
        const gcCount = room.usage === '气瓶间' ? 3 : Math.floor(rnd() * 4);
        for (let i = 0; i < gcCount; i++) {
          push('gasCabinet', x + 1.5 + i * 2.4, y + 1.4);
        }

        // 通风橱：1~3 台
        const fhCount = /实验室/.test(room.usage) ? 1 + Math.floor(rnd() * 3) : Math.floor(rnd() * 2);
        const fhCodes: string[] = [];
        for (let i = 0; i < fhCount; i++) {
          fhCodes.push(push('fumeHood', x + room.w - 2, y + 1.8 + i * 2.6));
        }

        // 洗眼器：实验室类约 55% 配置，靠近门口
        if (/实验室|处理/.test(room.usage) && rnd() < 0.55) {
          push('eyeWash', x + 1, y + room.h - 1.2);
        }

        // 管线：4~6 段，房间内折线；首段与通风橱建立同编号关联
        const plCount = 4 + Math.floor(rnd() * 3);
        for (let i = 0; i < plCount; i++) {
          const p1 = { x: x + 1 + rnd() * (room.w - 2), y: y + 1 + rnd() * (room.h - 2) };
          const p2 = { x: x + 1 + rnd() * (room.w - 2), y: y + 1 + rnd() * (room.h - 2) };
          const p3 = { x: x + 1 + rnd() * (room.w - 2), y: y + 1 + rnd() * (room.h - 2) };
          const f = push('pipeline', p1.x, p1.y, [p1, p2, p3]);
          if (i === 0 && fhCodes.length > 0) {
            const last = facilities[facilities.length - 1];
            last.linkedCode = fhCodes[0];
          }
        }
      }
    }

    // 走廊公共洗眼器：每楼层两端各 1 台
    const floorWidth = COLS * (CELL_W + GAP) + GAP;
    const floorHeight = ROWS * (CELL_H + GAP) + GAP;
    for (const ex of [GAP, floorWidth - GAP]) {
      const code = nextCode('eyeWash', floor);
      facilities.push({
        id: `F${floor}-CORR-EW-${facilities.length}`,
        code,
        type: 'eyeWash',
        group: 'fire',
        building: BUILDING_NAME,
        floor,
        roomId: `F${floor}-CORR`,
        roomName: `${floor}F 走廊`,
        x: ex,
        y: floorHeight / 2,
        linkedCode: code,
        spec: '复合式紧急冲淋洗眼器',
        status: '正常',
        installDate: '2020-06-15'
      });
    }
  }

  // 同编号关联：管线 linkedCode 指向配套通风橱编号；
  // 通风橱自身 linkedCode 保持本编号，按 linkedCode 分组即可同时命中两者
  return {
    name: BUILDING_NAME,
    floors: FLOOR_COUNT,
    rooms,
    facilities,
    floorList
  };
}
