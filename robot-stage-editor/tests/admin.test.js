// 后台排期冲突与统计验证（stub localStorage，Vue 响应式可在 Node 运行）
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null },
  setItem(k, v) { this._m.set(k, v) },
  removeItem(k) { this._m.delete(k) }
}
const { store, createShow, submitShow, adminStats, pushHistory } = await import('../src/store/store.js')

let pass = 0, fail = 0
const check = (n, c, e = '') => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, e) } }

const a = createShow('节目甲')
a.schedule = { date: '2026-12-01', slot: '19:30-20:30', venue: '一号厅' }
a.shapes = [{ id: 's1', type: 'robot', layer: 'robot' }, { id: 's2', type: 'rect', layer: 'path', beat: '03:20', actor: 'A' }]
const b = createShow('节目乙')
b.schedule = { date: '2026-12-01', slot: '20:00-21:00', venue: '一号厅' } // 与甲重叠
const c = createShow('节目丙')
c.schedule = { date: '2026-12-01', slot: '20:30-21:30', venue: '一号厅' } // 首尾相接，不冲突
const d = createShow('节目丁')
d.schedule = { date: '2026-12-02', slot: '19:30-20:30', venue: '一号厅' } // 不同日期
const e = createShow('节目戊')
e.schedule = { date: '2026-12-01', slot: '19:30-20:30', venue: '二号厅' } // 不同场地

console.log('1) 甲先提交，应通过')
let res = submitShow(a.id)
check('甲发布成功', res.ok === true)
check('甲状态变 scheduled', a.status === 'scheduled')

console.log('2) 乙与甲同时段同场地，必须拦截并列出冲突双方')
res = submitShow(b.id)
check('乙被拦截', res.ok === false)
check('冲突列出 甲 撞 乙', res.conflicts.length === 1 && res.conflicts[0].a === '节目乙' && res.conflicts[0].b === '节目甲')
check('乙状态仍为草稿', b.status === 'draft')

console.log('3) 丙时段首尾相接，不构成冲突')
res = submitShow(c.id)
check('丙通过', res.ok === true)

console.log('4) 丁不同日期 / 戊不同场地，均通过')
check('丁通过', submitShow(d.id).ok === true)
check('戊通过', submitShow(e.id).ok === true)

console.log('5) 统计：场次与编排时长')
const stats = adminStats.value
check('已排场次 = 4', stats.totalSessions === 4, `got ${stats.totalSessions}`)
const rowA = stats.rows.find(r => r.id === a.id)
check('甲编排时长 03:20 = 200 秒', rowA.durationSec === 200, `got ${rowA.durationSec}`)
check('统计行包含机器人/路径数', rowA.robotCount === 1 && rowA.pathCount === 1)

console.log('6) 撤销栈独立性与层序不变量')
const { openShow } = await import('../src/store/store.js')
openShow(a.id) // 建立初始历史快照
const beforeOrder = a.shapes.map(s => s.layer + ':' + s.id)
pushHistory('测试快照')
a.shapes.push({ id: 's99', type: 'circle', layer: 'path', x: 0, y: 0, radius: 5 })
const { undo } = await import('../src/store/store.js')
undo()
check('撤销后图形还原', a.shapes.length === 2)
check('撤销不改变剩余图形层序', a.shapes.every((s, i) => (s.layer + ':' + s.id) === beforeOrder[i]))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
