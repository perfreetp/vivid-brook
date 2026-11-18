// 撤销/重做历史栈，上限 100 步（满足至少 50 步要求）
import { cloneDoc } from './model.js'

const MAX_STEPS = 100

export class History {
  constructor(initialDoc) {
    this.stack = [{ doc: cloneDoc(initialDoc), label: '初始文档', coalesceKey: null }]
    this.index = 0
    this.coalescingKey = null
  }

  // 在变更前压入当前文档快照
  push(doc, label, coalesceKey = null) {
    if (coalesceKey && this.coalescingKey === coalesceKey) {
      // 合并连续拖拽：保留本次事务开始前的快照即可
      return
    }
    // 截断 redo 分支
    if (this.index < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.index + 1)
    }
    this.stack.push({ doc: cloneDoc(doc), label, coalesceKey })
    if (this.stack.length > MAX_STEPS + 1) this.stack.shift()
    this.index = this.stack.length - 1
    if (coalesceKey) this.coalescingKey = coalesceKey
  }

  endCoalesce() {
    this.coalescingKey = null
  }

  undo(currentDoc) {
    if (this.index <= 0) return null
    this.index -= 1
    this.coalescingKey = null
    return cloneDoc(this.stack[this.index].doc)
  }

  redo() {
    if (this.index >= this.stack.length - 1) return null
    this.index += 1
    this.coalescingKey = null
    return cloneDoc(this.stack[this.index].doc)
  }

  get canUndo() {
    return this.index > 0
  }
  get canRedo() {
    return this.index < this.stack.length - 1
  }
  get undoLabel() {
    return this.index > 0 ? this.stack[this.index - 1].label : ''
  }
  get redoLabel() {
    return this.index < this.stack.length - 1 ? this.stack[this.index + 1].label : ''
  }
  get size() {
    return this.stack.length - 1
  }
  get limit() {
    return MAX_STEPS
  }
}
