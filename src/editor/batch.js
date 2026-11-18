// 素材批次：自动检查（合格/警告/退回三级）→ 逐条复核 → 整批放行
import { reactive, computed } from 'vue'
import { uid, createPath, createNode, nodesToD } from './model.js'
import { pathToPolylines, findNarrowGaps, circumference } from './geometry.js'

// 自动检查阈值（厂规可在此调整）
export const CHECK_RULES = {
  minLineWidthMm: 0.3, // 激光可加工最小线宽
  warnLineWidthMm: 0.5, // 低于此值给警告
  maxBreakpoints: 0, // 闭合纹样允许的断点数；开放轮廓放宽
  warnBreakpoints: 2,
  narrowGapMm: 0.3
}

export const LEVEL = {
  PASS: 'pass',
  WARN: 'warn',
  REJECT: 'reject'
}
export const LEVEL_META = {
  pass: { label: '合格', color: '#16a34a', bg: '#dcfce7' },
  warn: { label: '警告', color: '#d97706', bg: '#fef3c7' },
  reject: { label: '退回', color: '#dc2626', bg: '#fee2e2' }
}
export const REVIEW = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected'
}

const batch = reactive({
  batchNo: '',
  supplier: '',
  receivedAt: '',
  items: [],
  released: false,
  releasedAt: null
})

function evaluateItem(item) {
  const reasons = []
  let level = LEVEL.PASS
  let minWidth = Infinity
  let breakpoints = 0
  const rings = []

  item.paths.forEach((p) => {
    minWidth = Math.min(minWidth, p.strokeWidth)
    if (!p.closed) {
      // 开放路径：首尾两个端点（断点）
      breakpoints += 2
    }
    rings.push(...pathToPolylines(p, 0.01))
  })
  if (!isFinite(minWidth)) minWidth = 0

  // 窄缝检查
  const gaps = rings.length ? findNarrowGaps(rings, CHECK_RULES.narrowGapMm) : []
  const minGap = gaps.length ? gaps[0].distance : null

  // —— 线宽判定 ——
  if (minWidth < CHECK_RULES.minLineWidthMm) {
    level = LEVEL.REJECT
    reasons.push({
      code: 'LINE_WIDTH',
      text: `线宽 ${minWidth.toFixed(2)}mm 低于激光加工下限 ${CHECK_RULES.minLineWidthMm}mm`
    })
  } else if (minWidth < CHECK_RULES.warnLineWidthMm) {
    if (level !== LEVEL.REJECT) level = LEVEL.WARN
    reasons.push({
      code: 'LINE_WIDTH_WARN',
      text: `线宽 ${minWidth.toFixed(2)}mm 接近加工下限（建议 ≥ ${CHECK_RULES.warnLineWidthMm}mm）`
    })
  }

  // —— 断点数判定 ——
  const hasOpen = item.paths.some((p) => !p.closed)
  if (!hasOpen && breakpoints > CHECK_RULES.maxBreakpoints) {
    level = LEVEL.REJECT
    reasons.push({ code: 'BREAK', text: `闭合纹样存在 ${breakpoints} 个断点，无法连续雕刻` })
  } else if (hasOpen && breakpoints > CHECK_RULES.warnBreakpoints) {
    if (level !== LEVEL.REJECT) level = LEVEL.WARN
    reasons.push({ code: 'BREAK_WARN', text: `开放轮廓断点数 ${breakpoints}，需复核首尾相接` })
  } else if (hasOpen) {
    if (level === LEVEL.PASS) level = LEVEL.WARN
    reasons.push({ code: 'BREAK_WARN', text: `开放轮廓含 ${breakpoints} 个端点，请确认拼缝相接` })
  }

  // —— 窄缝判定 ——
  if (gaps.length) {
    if (level === LEVEL.PASS) level = LEVEL.WARN
    reasons.push({
      code: 'NARROW_GAP',
      text: `检测到 ${gaps.length} 处窄缝，最窄 ${minGap}mm（< ${CHECK_RULES.narrowGapMm}mm 激光雕不出）`
    })
  }

  if (!reasons.length) reasons.push({ code: 'OK', text: '线宽与断点检查全部通过' })

  item.check = {
    level,
    reasons,
    metrics: {
      minLineWidthMm: +minWidth.toFixed(3),
      breakpoints,
      narrowGapCount: gaps.length,
      minGapMm: minGap
    }
  }
  return item
}

// ---------- 批次操作 ----------
export function createBatch(batchNo, supplier, items) {
  batch.batchNo = batchNo
  batch.supplier = supplier
  batch.receivedAt = new Date().toISOString()
  batch.released = false
  batch.releasedAt = null
  batch.items = items.map((it) =>
    evaluateItem({
      id: uid('item'),
      name: it.name,
      code: it.code || '',
      paths: it.paths,
      review: { status: REVIEW.PENDING, reviewer: '', comment: '', at: null }
    })
  )
  return batch
}

export function confirmItem(itemId, reviewer, comment = '') {
  const it = batch.items.find((x) => x.id === itemId)
  if (!it) return
  it.review = { status: REVIEW.CONFIRMED, reviewer: reviewer || '复核员', comment, at: new Date().toISOString() }
}
export function rejectItem(itemId, reviewer, reason) {
  const it = batch.items.find((x) => x.id === itemId)
  if (!it) return
  if (!reason || !reason.trim()) throw new Error('退回必须填写原因')
  it.review = { status: REVIEW.REJECTED, reviewer: reviewer || '复核员', comment: reason.trim(), at: new Date().toISOString() }
}
export function resetReview(itemId) {
  const it = batch.items.find((x) => x.id === itemId)
  if (!it) return
  it.review = { status: REVIEW.PENDING, reviewer: '', comment: '', at: null }
}

export const batchSummary = computed(() => {
  const total = batch.items.length
  const byLevel = { pass: 0, warn: 0, reject: 0 }
  const byReview = { pending: 0, confirmed: 0, rejected: 0 }
  batch.items.forEach((it) => {
    byLevel[it.check.level]++
    byReview[it.review.status]++
  })
  const allHandled = total > 0 && byReview.pending === 0
  const canRelease = allHandled && byReview.confirmed > 0
  return { total, byLevel, byReview, allHandled, canRelease }
})

export function releaseBatch() {
  const s = batchSummary.value
  if (!s.allHandled) throw new Error('仍有素材未复核，不能放行')
  if (s.byReview.confirmed === 0) throw new Error('没有任何合格确认项，无法放行给雕刻组')
  batch.released = true
  batch.releasedAt = new Date().toISOString()
  return batch
}

// 退回清单（带原因回供应商）
export function buildRejectSheet() {
  const rejected = batch.items.filter((it) => it.review.status === REVIEW.REJECTED)
  return {
    batchNo: batch.batchNo,
    supplier: batch.supplier,
    exportedAt: new Date().toISOString(),
    items: rejected.map((it) => ({
      name: it.name,
      code: it.code,
      autoLevel: LEVEL_META[it.check.level].label,
      autoReasons: it.check.reasons.map((r) => r.text),
      rejectReason: it.review.comment,
      reviewer: it.review.reviewer
    }))
  }
}
export function exportRejectSheet() {
  const sheet = buildRejectSheet()
  if (!sheet.items.length) return null
  const blob = new Blob([JSON.stringify(sheet, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `退回清单_${batch.batchNo || 'batch'}_${Date.now()}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return sheet
}

export function exportReleaseNote() {
  const note = {
    batchNo: batch.batchNo,
    supplier: batch.supplier,
    releasedAt: batch.releasedAt,
    shaft: null,
    items: batch.items
      .filter((it) => it.review.status === REVIEW.CONFIRMED)
      .map((it) => ({
        name: it.name,
        code: it.code,
        svg: `<svg xmlns="http://www.w3.org/2000/svg">${it.paths
          .map((p) => `<path d="${nodesToD(p)}" stroke-width="${p.strokeWidth}"/>`)
          .join('')}</svg>`
      }))
  }
  const blob = new Blob([JSON.stringify(note, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `放行单_${batch.batchNo || 'batch'}_${Date.now()}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

// ---------- 示例批次 ----------
function samplePath(kind, strokeWidth, closed) {
  const base = {
    good: [
      createNode(2, 2),
      createNode(8, 2, { dx: -2, dy: 0 }, { dx: 2, dy: 0 }),
      createNode(8, 8),
      createNode(2, 8)
    ],
    // 窄缝由两条相距 0.2mm 的平行闭合轮廓构成
    narrowA: [createNode(2, 2), createNode(12, 2), createNode(12, 8), createNode(2, 8)],
    narrowB: [createNode(2, 8.2), createNode(12, 8.2), createNode(12, 12), createNode(2, 12)],
    open: [createNode(0, 3), createNode(5, 3), createNode(9, 3)]
  }[kind]
  const p = createPath(base, closed, kind)
  p.strokeWidth = strokeWidth
  return p
}

export function loadSampleBatch() {
  const items = [
    { name: '云纹-01', code: 'YW-001', paths: [samplePath('good', 0.6, true)] },
    { name: '回纹-02', code: 'HW-002', paths: [samplePath('good', 0.45, true)] }, // 线宽警告
    {
      name: '竹节-03',
      code: 'ZJ-003',
      paths: [samplePath('narrowA', 0.6, true), samplePath('narrowB', 0.6, true)] // 窄缝警告
    },
    { name: '细线-04', code: 'XX-004', paths: [samplePath('good', 0.2, true)] }, // 线宽退回
    { name: '断纹-05', code: 'DW-005', paths: [samplePath('open', 0.6, false)] }, // 断点警告
    {
      name: '双问题-06',
      code: 'SW-006',
      paths: [samplePath('narrowA', 0.18, true), samplePath('narrowB', 0.18, true)] // 线宽退回 + 窄缝
    }
  ]
  return createBatch(`PC${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`, '徽州竹艺供应商', items)
}

export function useBatch() {
  return {
    batch,
    CHECK_RULES,
    LEVEL,
    LEVEL_META,
    REVIEW,
    batchSummary,
    createBatch,
    confirmItem,
    rejectItem,
    resetReview,
    releaseBatch,
    exportRejectSheet,
    exportReleaseNote,
    loadSampleBatch
  }
}
