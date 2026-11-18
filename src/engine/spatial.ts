import { Cluster, Facility, FacilityType, TYPE_PRIORITY } from '../types';

/** 网格空间索引：按楼层分桶，支持矩形视口查询与近邻拾取 */
export class SpatialIndex {
  private cell: number;
  private buckets = new Map<string, Facility[]>();

  constructor(cell = 12) {
    this.cell = cell;
  }

  private key(floor: number, gx: number, gy: number) {
    return `${floor}:${gx}:${gy}`;
  }

  insert(f: Facility) {
    const gx = Math.floor(f.x / this.cell);
    const gy = Math.floor(f.y / this.cell);
    const k = this.key(f.floor, gx, gy);
    let arr = this.buckets.get(k);
    if (!arr) {
      arr = [];
      this.buckets.set(k, arr);
    }
    arr.push(f);
  }

  /** 查询矩形范围内的设施（已按桶去重） */
  queryRect(floor: number, xmin: number, ymin: number, xmax: number, ymax: number): Facility[] {
    const gx0 = Math.floor(xmin / this.cell);
    const gx1 = Math.floor(xmax / this.cell);
    const gy0 = Math.floor(ymin / this.cell);
    const gy1 = Math.floor(ymax / this.cell);
    const out: Facility[] = [];
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const arr = this.buckets.get(this.key(floor, gx, gy));
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  /**
   * 拾取：返回命中候选，按 类别优先级 -> 距离 排序。
   * 同位置叠放多个要素时，高优先级（洗眼器>气瓶柜>通风橱>管线）先命中。
   */
  pick(floor: number, x: number, y: number, radius: number): Facility[] {
    const cands = this.queryRect(
      floor,
      x - radius,
      y - radius,
      x + radius,
      y + radius
    ).filter(f => {
      const dx = f.x - x;
      const dy = f.y - y;
      return dx * dx + dy * dy <= radius * radius;
    });
    cands.sort((a, b) => {
      const p = TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type];
      if (p !== 0) return p;
      const da = (a.x - x) ** 2 + (a.y - y) ** 2;
      const db = (b.x - x) ** 2 + (b.y - y) ** 2;
      return da - db;
    });
    return cands;
  }
}

/** 楼栋级聚合：同楼层、同类型、同网格块合并 */
export function clusterize(
  facilities: Facility[],
  floor: number,
  cellSize: number
): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const f of facilities) {
    if (f.floor !== floor) continue;
    const gx = Math.floor(f.x / cellSize);
    const gy = Math.floor(f.y / cellSize);
    const k = `${f.type}:${gx}:${gy}`;
    let c = map.get(k);
    if (!c) {
      c = {
        key: k,
        type: f.type as FacilityType,
        group: f.group,
        floor,
        x: 0,
        y: 0,
        count: 0,
        ids: []
      };
      map.set(k, c);
    }
    c.x += f.x;
    c.y += f.y;
    c.count++;
    c.ids.push(f.id);
  }
  for (const c of map.values()) {
    c.x /= c.count;
    c.y /= c.count;
  }
  return [...map.values()];
}
