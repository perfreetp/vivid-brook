// Node 环境冒烟测试：模型规模、修订应用、版本 diff
import { buildModel, planEdits, diffModels } from '../src/lib/model.js';

const v1 = { vid: 1, name: 'V1', seed: 20261119, edits: [] };
const m1 = buildModel(v1);
console.log('V1 构件总数:', m1.stats.total);
console.log('分组明细:', JSON.stringify(m1.stats.byGroup));
if (m1.stats.total < 18000) throw new Error('实例数未达数万级目标');

const edits = planEdits(2, m1.groups, v1.seed);
console.log('V2 修订条数:', edits.length, '类型分布:',
  JSON.stringify(edits.reduce((a, e) => (a[e.type] = (a[e.type] || 0) + 1, a), {})));

const v2 = { vid: 2, name: 'V2', seed: 20261119, edits };
const m2 = buildModel(v2);
const d = diffModels(m1, m2);
console.log('diff 结果: 新增', d.added.length, '删除', d.removed.length, '变更', d.changed.length);
if (d.added.length !== 6 || d.removed.length !== 4 || d.changed.length !== 8) {
  throw new Error('diff 数量不符合预期');
}

// 确定性：同 seed 重建结果应一致
const m1b = buildModel({ ...v1, vid: 99 });
let same = 0;
for (const k of Object.keys(m1b.groups)) {
  if (m1b.groups[k].length !== m1.groups[k].length) throw new Error('确定性重建分组数量不一致');
  same += m1b.groups[k].length;
}
console.log('确定性重建通过，实例数:', same);

// 元素字段完整性抽查
const sample = m1.groups.main[0];
for (const f of ['id', 'elev', 'radius', 'chamber', 'prof', 'level', 'layerMask', 'pos', 'scale', 'cellId']) {
  if (sample[f] === undefined) throw new Error(`缺少字段 ${f}`);
}
console.log('干管样例:', JSON.stringify({
  name: sample.name, elev: sample.elev, r: sample.radius, chamber: sample.chamber, cell: sample.cellId,
}));
console.log('\n✅ 模型层全部测试通过');
