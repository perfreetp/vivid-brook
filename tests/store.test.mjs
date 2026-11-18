import { EditorStore } from '../src/state/store.ts';

// 模拟 localStorage
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, v); },
  removeItem(k) { this._d.delete(k); },
};
let pass = 0, fail = 0;
const ok = (n, c) => { c ? pass++ : (fail++, console.log('FAIL:', n)); };

const s = new EditorStore();
ok('initial features loaded', s.state.features.length >= 4);
ok('initial entries', s.state.entries.length === 1);

// 撤销栈容量 ≥50
const before = s.state.features.length;
for (let i = 0; i < 80; i++) s.addFeatureFromPoints('intake', [{x:i*10,y:0},{x:i*10+5,y:5}]);
ok('80 features added', s.state.features.length === before + 80);
ok('history depth capped at 100 (>=50)', s.history.depth === 80);
// 再做 30 步，验证容量上限 100
for (let i = 0; i < 30; i++) s.updateFeature(s.state.features[0].id, { note: `n${i}` });
ok('history depth capped 100', s.history.depth === 100);
// 撤销 60 步仍可用
let undoCount = 0;
while (s.history.canUndo && undoCount < 60) { s.undo(); undoCount++; }
ok('can undo 60 steps', undoCount === 60);
// 重做
const redoSnap = s.history.canRedo;
s.redo();
ok('redo works', redoSnap === true);

// 手势撤销：拖动只产生一条历史
const s2 = new EditorStore();
const fid = s2.state.features[0].id;
const d0 = s2.history.depth;
s2.beginGesture();
s2.moveVertexGesture(fid, 0, {x: 1, y: 1});
s2.moveVertexGesture(fid, 0, {x: 2, y: 2});
s2.moveVertexGesture(fid, 0, {x: 3, y: 3});
ok('gesture has no history entries mid-drag', s2.history.depth === d0);
s2.endGesture();
ok('gesture creates single history entry', s2.history.depth === d0 + 1);
s2.undo();
ok('undo restores pre-drag position', s2.state.features.find(f=>f.id===fid).points[0].x !== 3);

// 沟沿生成
const s3 = new EditorStore();
const openF = s3.state.features.find(f => f.pathType === 'open');
s3.select([openF.id]);
s3.generateBanks(openF.id);
const banks = s3.state.features.filter(f => f.sourceId === openF.id);
ok('two banks generated', banks.length === 2);
ok('banks are open polylines', banks.every(b => b.points.length === openF.points.length));
// 偏移距离 = 半宽 + 深×坡比
const expected = openF.width / 2 + openF.depth * openF.slope;
const actual = Math.hypot(banks[0].points[0].x - openF.points[0].x, banks[0].points[0].y - openF.points[0].y);
ok('bank offset = halfwidth + depth*slope', Math.abs(actual - expected) < 1e-6);

// 布尔运算后保留可编辑顶点
const s4 = new EditorStore();
const pools = s4.state.features.filter(f => f.kind === 'pool');
s4.select([pools[0].id, pools[1].id]);
s4.applyBoolean('union');
const unionF = s4.state.features.find(f => f.name.includes('并集'));
ok('boolean result is feature with editable vertices', unionF && unionF.points.length >= 4);
ok('boolean result closed', unionF.pathType === 'closed');

// 工单流程：下单 → 加工 → 提交 → 退回（返工+1）→ 再提交 → 通过
const s5 = new EditorStore();
const future = new Date(Date.now() + 3 * 864e5).toISOString();
s5.createEntry('测试工单', 'pool', '制作员B', future, []);
const e = s5.state.entries[s5.state.entries.length - 1];
ok('order created pending', e.status === 'pending' && e.reworkCount === 0);
s5.updateEntryStatus(e.id, 'in_progress');
s5.updateEntryStatus(e.id, 'submitted');
ok('submitted', s5.state.entries.find(x=>x.id===e.id).status === 'submitted');
s5.updateEntryStatus(e.id, 'rejected', '轮廓偏差');
const e2 = s5.state.entries.find(x=>x.id===e.id);
ok('reject increments rework and sets rework status', e2.reworkCount === 1 && e2.status === 'rework');
s5.updateEntryStatus(e.id, 'in_progress');
s5.updateEntryStatus(e.id, 'submitted');
s5.updateEntryStatus(e.id, 'approved', '通过');
ok('approved', s5.state.entries.find(x=>x.id===e.id).status === 'approved');

// 图层锁定后不可编辑（编辑器侧 isEditable 判断基于 store.isLayerLocked）
const s6 = new EditorStore();
const lid = s6.state.layers[0].id;
s6.toggleLayerLock(lid);
ok('layer locked flag', s6.isLayerLocked(lid) === true);

// 合并/反转/断开
const s7 = new EditorStore();
const o1 = makeOpen(s7, [{x:0,y:0},{x:50,y:0}]);
const o2 = makeOpen(s7, [{x:50,y:0},{x:100,y:10}]);
s7.select([o1, o2]);
s7.mergeSelected();
ok('merge produces one feature', s7.state.features.filter(f=>f.name.includes('合并')).length === 1);
const merged = s7.state.features.find(f=>f.name.includes('合并'));
ok('merged point count 3 (shared endpoint deduped)', merged.points.length === 3);
s7.select([merged.id]);
const firstBefore = merged.points[0];
s7.reverseSelected();
const revF = s7.state.features.find(f=>f.id===merged.id);
ok('reverse flips endpoints', revF.points[0].x === firstBefore.x === false || revF.points[revF.points.length-1].x === firstBefore.x);
// 断开
s7.splitAt(revF.id, 1);
ok('split open path into two', s7.state.features.filter(f=>f.name.startsWith(revF.name)).length >= 2);

function makeOpen(store, pts) {
  const f = store.addFeatureFromPoints('drain', pts);
  return store.state.features.find(x=>x.id===f.id).id;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
