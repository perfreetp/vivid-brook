/**
 * views/orders.js — 界面①：前台接单
 * 录入容量/材质要求创建工单，工单列表支持直接分派给设计师
 */
import html from 'solid-js/html';
import { For, Show, createSignal } from 'solid-js';
import {
  state, createOrder, assignOrder, selectOrder, DESIGNERS, MATERIALS, STATUS_LABEL,
} from '../store.js';

const STATUS_CLS = { new: 'new', assigned: 'assigned', submitted: 'submitted', rework: 'rework', passed: 'passed' };

export default function OrdersView({ go }) {
  const [title, setTitle] = createSignal('');
  const [capacity, setCapacity] = createSignal(500);
  const [material, setMaterial] = createSignal(MATERIALS[0]);
  const [note, setNote] = createSignal('');
  const [assignId, setAssignId] = createSignal('');

  const submit = () => {
    if (!title().trim()) { alert('请填写瓶型/项目名称'); return; }
    const cap = Number(capacity());
    if (!(cap > 0)) { alert('容量必须是正数（ml）'); return; }
    createOrder({ title: title().trim(), capacityMl: cap, material: material(), note: note() });
    setTitle(''); setNote(''); setCapacity(500);
  };

  const quickAssign = (id) => {
    const d = assignId();
    if (!d) return;
    assignOrder(id, d);
    setAssignId('');
  };

  return html`
    <div class="page-title">
      <h2>前台接单</h2>
      <span class="sub">录入客户容量与材质要求，分派工单给设计师；后续设计、质检、返工全程留痕</span>
    </div>

    <div class="grid layout-2" style="align-items:start">
      <section class="card">
        <div class="card-hd"><h3>新建工单</h3></div>
        <div class="card-bd">
          <div class="field">
            <label>瓶型 / 项目名称 *</label>
            <input class="input" placeholder="例：500ml 洗发水圆瓶标签"
              value=${() => title()} onInput=${e => setTitle(e.target.value)} />
          </div>
          <div class="form-row">
            <div class="field">
              <label>目标容量（ml）*</label>
              <input class="input" type="number" min="1" step="10"
                value=${() => capacity()} onInput=${e => setCapacity(Number(e.target.value))} />
            </div>
            <div class="field">
              <label>材质要求</label>
              <select class="select" value=${() => material()} onChange=${e => setMaterial(e.target.value)}>
                <${For} each=${MATERIALS}>${m => html`<option value=${m}>${m}</option>`}<//>
              </select>
            </div>
          </div>
          <div class="field">
            <label>工艺 / 备注</label>
            <textarea class="textarea" placeholder="贴标方式、膜类、色差要求、交期等"
              value=${() => note()} onInput=${e => setNote(e.target.value)}></textarea>
          </div>
          <button class="btn primary" onClick=${submit}>＋ 创建工单</button>
        </div>
      </section>

      <section class="card">
        <div class="card-hd">
          <h3>工单列表（${() => state.orders.length}）</h3>
          <div class="inline-field">
            <label>快捷分派给</label>
            <select class="select" style="width:auto" value=${() => assignId()} onChange=${e => setAssignId(e.target.value)}>
              <option value="">选择设计师…</option>
              <${For} each=${DESIGNERS}>${d => html`<option value=${d}>${d}</option>`}<//>
            </select>
          </div>
        </div>
        <div class="card-bd flush">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>工单号</th><th>项目</th><th>容量</th><th>材质</th>
                  <th>状态</th><th>设计师</th><th>返工</th><th>操作</th>
                </tr>
              </thead>
              <tbody>
                <${For} each=${() => state.orders}>${o => html`
                  <tr class="clickable" onClick=${() => { selectOrder(o.id); go('workbench'); }}>
                    <td class="mono">${o.id}</td>
                    <td>${o.title}</td>
                    <td class="num">${o.capacityMl} ml</td>
                    <td>${o.material}</td>
                    <td><span class=${() => 'badge ' + STATUS_CLS[o.status]}>${() => STATUS_LABEL[o.status]}</span></td>
                    <td><${Show} when=${() => o.designer} fallback=${html`<span class="muted">未分派</span>`}>${() => o.designer}<//></td>
                    <td class="num"><${Show} when=${() => o.reworkCount > 0}
                      fallback=${html`<span class="muted">0</span>`}><span class="danger-text">${() => o.reworkCount} 次</span><//></td>
                    <td onClick=${e => e.stopPropagation()}>
                      <${Show} when=${() => o.status === 'new'}
                        fallback=${html`<button class="btn sm"
                          onClick=${() => { selectOrder(o.id); go('workbench'); }}>查看</button>`}>
                        <button class="btn sm primary" disabled=${() => !assignId()}
                          onClick=${() => quickAssign(o.id)}>分派</button>
                      <//>
                    </td>
                  </tr>`}<//>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  `;
}
