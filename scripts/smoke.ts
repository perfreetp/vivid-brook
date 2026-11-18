import { generateBuilding } from '../src/data/generator';
import { SpatialIndex, clusterize } from '../src/engine/spatial';
import { TYPE_PRIORITY, Facility } from '../src/types';

const data = generateBuilding();
const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('PASS:', msg);
};

assert(data.facilities.length > 3000, `设施总数 ${data.facilities.length} 达数千`);
assert(data.rooms.length === 8 * 48, `房间数 ${data.rooms.length}=384`);
const floors = new Set(data.facilities.map(f => f.floor));
assert(floors.size === 8, '8 个楼层');

// 空间索引：视口矩形查询结果必须全部落在范围内
const idx = new SpatialIndex(12);
data.facilities.forEach(f => idx.insert(f));
const r = idx.queryRect(3, 10, 10, 60, 40);
assert(r.every(f => f.floor === 3 && f.x >= 10 - 12 && f.x <= 60 + 12 && f.y >= 10 - 12 && f.y <= 40 + 12), '视口裁剪查询边界正确');
assert(r.length < data.facilities.filter(f => f.floor === 3).length, '裁剪后数量小于全楼层数量');

// 聚合：同层同类网格块 count 之和等于该层该类总数
const f1 = data.facilities.filter(f => f.floor === 1);
const clusters = clusterize(f1, 1, 16);
const sumByType = new Map<string, number>();
for (const c of clusters) sumByType.set(c.type, (sumByType.get(c.type) ?? 0) + c.count);
for (const [t, n] of sumByType) {
  const expect = f1.filter(f => f.type === t).length;
  assert(n === expect, `聚合数量守恒: ${t} ${n}=${expect}`);
}
assert(clusters.length < f1.length, '聚合块数少于要素数');

// 同位置叠放优先级：构造叠放点
const base = { ...f1[0] };
const stacked: Facility[] = (['pipeline', 'fumeHood', 'gasCabinet', 'eyeWash'] as const).map((t, i) => ({
  ...base, id: 's' + i, type: t, x: 50, y: 50, code: 'X' + i
}));
const sidx = new SpatialIndex(12);
stacked.forEach(f => sidx.insert(f));
const hit = sidx.pick(1, 50, 50, 2);
assert(hit[0].type === 'eyeWash', `叠放命中优先级最高的洗眼器（实得 ${hit[0].type}）`);
assert(TYPE_PRIORITY.eyeWash > TYPE_PRIORITY.gasCabinet, '优先级排序洗眼器>气瓶柜');

// 同编号关联：管线 linkedCode 指向通风橱编号，按编号可同时命中两者
const pl = data.facilities.find(f => f.type === 'pipeline' && f.linkedCode !== f.code);
assert(!!pl, '存在与通风橱关联的管线');
const linked = data.facilities.filter(f => f.linkedCode === pl!.linkedCode || f.code === pl!.linkedCode);
assert(linked.some(f => f.type === 'fumeHood') && linked.some(f => f.type === 'pipeline'), '同编号关联同时包含通风橱与管线');

// 编号唯一性
const codes = new Set(data.facilities.map(f => f.code));
assert(codes.size === data.facilities.length, '设备编号全局唯一');
console.log('\\n全部逻辑测试通过 ✓ 设施总数 =', data.facilities.length);
