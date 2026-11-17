// 机器人型号素材库（可在“素材库”界面维护，持久化）
export const BUILTIN_ROBOTS = [
  { id: 'rb-wheel-s', name: '轮式·小号 S1', kind: 'wheel', radius: 18, speed: 1.2, payload: 5, color: '#58a6ff', desc: '轻量快速，适合群舞队形变换' },
  { id: 'rb-wheel-l', name: '轮式·大号 L2', kind: 'wheel', radius: 26, speed: 0.9, payload: 20, color: '#7ee787', desc: '大载重，可携带舞台道具' },
  { id: 'rb-leg', name: '双足·人形 B1', kind: 'leg', radius: 22, speed: 0.8, payload: 8, color: '#ffb84d', desc: '双足平衡，支持转身鞠躬动作' },
  { id: 'rb-spider', name: '六足·蜘蛛 X6', kind: 'spider', radius: 30, speed: 0.7, payload: 12, color: '#d2a8ff', desc: '全向移动，复杂地形适应' }
]

const KEY = 'rse-materials-v1'

export function loadMaterials() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(BUILTIN_ROBOTS))
}

export function saveMaterials(list) {
  localStorage.setItem(KEY, JSON.stringify(list))
}
