import type { Order, Role } from '../types.js';
import { BaseElement, fallbackStyleEl } from './base.js';
import { STATUS_LABEL } from '../core/store.js';
import { fmtTime, daysLeft } from '../core/math.js';
import { exportSequence } from '../core/export.js';

const ROLE_LABEL: Record<Role, string> = { customer: '客户', artist: '制作员', supervisor: '主管' };
const ROLE_DESC: Record<Role, string> = {
  customer: '按项目下单、建条目、查看交付',
  artist: '按镜头制作动画、提交审核、打包导出',
  supervisor: '审核镜头、退回返工、通过交付',
};

export class OrdersElement extends BaseElement {
  protected render(): void {
    this.root.innerHTML = /* html */ `
      ${fallbackStyleEl().outerHTML}
      <style>
        :host { display: block; flex: 1 1 0; min-height: 0; height: 100%; overflow: auto; background: var(--bg); }
        .page { padding: 18px 22px; max-width: 1180px; margin: 0 auto; min-height: 100%; }
        .rolebar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
        .role-btn { padding: 7px 16px; }
        .role-btn.on { background: var(--accent); color: #0b141c; border-color: var(--accent); font-weight: 600; }
        .cols { display: grid; grid-template-columns: 340px 1fr; gap: 16px; }
        .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
        .order-card { cursor: pointer; margin-bottom: 10px; border: 1px solid var(--border); border-radius: 8px; padding: 11px 13px; background: var(--panel); }
        .order-card.sel { border-color: var(--accent); background: #1b2a38; }
        .order-card:hover { border-color: var(--accent); }
        .shot-row { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 10px; background: var(--panel2); }
        .hist { font-size: 11px; color: var(--muted); max-height: 130px; overflow: auto; margin-top: 8px; }
        .hist div { padding: 2px 0; border-bottom: 1px dashed #26313d; }
        .deadline-late { color: var(--danger); font-weight: 600; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
        @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
      </style>
      <div class="page">
        <div class="rolebar">
          <h3 style="margin:0">当前角色（切换以体验不同权限）：</h3>
          ${(Object.keys(ROLE_LABEL) as Role[]).map((r) => `
            <button class="role-btn ${this.store.data.role === r ? 'on' : ''}" data-role="${r}">${ROLE_LABEL[r]}</button>
          `).join('')}
          <span class="muted" id="roleDesc"></span>
        </div>
        <div class="cols">
          <div>
            <div class="card" id="newOrderCard"></div>
            <h4 style="margin-top:16px">订单列表</h4>
            <div id="orderList"></div>
          </div>
          <div class="card" id="orderDetail"><p class="muted">选择左侧订单查看详情</p></div>
        </div>
      </div>
    `;
  }

  protected bind(): void {
    this.listen('data', () => this.draw());
    this.listen('selection', () => this.draw());
    this.draw();
  }

  private draw(): void {
    this.el('#roleDesc').textContent = ROLE_DESC[this.store.data.role];
    this.root.querySelectorAll<HTMLElement>('.role-btn').forEach((b) =>
      b.addEventListener('click', () => {
        this.store.data.role = b.dataset.role as Role;
        this.store.save();
      }));
    this.drawNewOrderCard();
    this.drawOrderList();
    this.drawDetail();
  }

  private drawNewOrderCard(): void {
    const role = this.store.data.role;
    const host = this.el('#newOrderCard');
    if (role !== 'customer') {
      host.innerHTML = `<h3>下单入口</h3><p class="muted">仅客户角色可以按项目下单建条目。切换到「客户」角色即可创建订单。</p>`;
      return;
    }
    host.innerHTML = /* html */ `
      <h3>客户下单 · 新建项目条目</h3>
      <div class="field"><label>项目名称</label><input id="oTitle" placeholder="如：塑料折叠床 X200 机构动画"></div>
      <div class="field"><label>客户/品牌</label><input id="oClient"></div>
      <div class="field"><label>截止时间</label><input id="oDeadline" type="date"></div>
      <div class="field"><label>需求说明</label><textarea id="oNote" rows="3" placeholder="镜头数量、动作要求、限位提示等"></textarea></div>
      <button class="primary" style="width:100%" id="createOrder">提交订单</button>
    `;
    this.el('#createOrder').addEventListener('click', () => {
      const title = this.el<HTMLInputElement>('#oTitle').value.trim();
      if (!title) { alert('请填写项目名称'); return; }
      const dateVal = this.el<HTMLInputElement>('#oDeadline').value;
      const deadline = dateVal ? new Date(dateVal + 'T18:00:00').getTime() : null;
      const order = this.store.createOrder({
        title,
        client: this.el<HTMLInputElement>('#oClient').value.trim() || '未填写',
        note: this.el<HTMLTextAreaElement>('#oNote').value.trim(),
        deadline,
      });
      this.store.selectOrder(order.id);
    });
  }

  private drawOrderList(): void {
    const host = this.el('#orderList');
    host.innerHTML = this.store.data.orders.map((o) => `
      <div class="order-card ${o.id === this.store.currentOrderId ? 'sel' : ''}" data-id="${o.id}">
        <div class="row" style="justify-content:space-between">
          <strong>${o.title}</strong>
          <span class="tag ${o.status}">${STATUS_LABEL[o.status]}</span>
        </div>
        <div class="muted" style="margin-top:5px">${o.client} · 镜头 ${o.shots.length} · 返工 ${o.reworkCount} 次</div>
        <div class="muted" style="margin-top:3px">截止：${fmtTime(o.deadline)}（${daysLeft(o.deadline)}）</div>
      </div>
    `).join('') || '<p class="muted">暂无订单</p>';
    this.root.querySelectorAll<HTMLElement>('.order-card').forEach((c) =>
      c.addEventListener('click', () => this.store.selectOrder(c.dataset.id!)));
  }

  private drawDetail(): void {
    const host = this.el('#orderDetail');
    const order = this.store.order;
    if (!order) { host.innerHTML = '<p class="muted">选择左侧订单查看详情</p>'; return; }
    const role = this.store.data.role;
    host.innerHTML = /* html */ `
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">${order.title}</h3>
        <span class="tag ${order.status}">${STATUS_LABEL[order.status]}</span>
      </div>
      <p class="muted" style="margin:6px 0">客户：${order.client} ｜ 下单：${fmtTime(order.createdAt)} ｜ 截止：
        <span class="${order.deadline && order.deadline < Date.now() ? 'deadline-late' : ''}">${fmtTime(order.deadline)}（${daysLeft(order.deadline)}）</span>
        ｜ 累计返工 <b style="color:var(--warn)">${order.reworkCount}</b> 次</p>
      <p>${order.note || '<span class="muted">无需求说明</span>'}</p>

      <h4>镜头（制作员按镜头制作）</h4>
      <div id="shotList"></div>
      ${role !== 'customer' ? `
        <div class="card" style="margin-top:10px">
          <h4>新增镜头</h4>
          <div class="row">
            <input id="newShotName" placeholder="镜头名称，如：镜头02-局部铰点特写" style="flex:1">
            <input id="newShotDeadline" type="date" style="width:160px">
            <button id="addShot" class="primary">建镜头</button>
          </div>
        </div>` : ''}
      <h4>订单流转记录</h4>
      <div class="hist">${order.history.map((h) => `<div>${fmtTime(h.at)} · ${ROLE_LABEL[h.by]} — ${h.action}</div>`).join('')}</div>
      <div class="actions">
        <button class="primary" id="openEditor">打开动画编辑器</button>
        ${order.shots.length > 0 && order.shots.every((s) => s.status === 'done') && role !== 'customer' ?
          '<button id="deliver">打包交付订单</button>' : ''}
      </div>
    `;

    this.el('#openEditor').addEventListener('click', () => {
      this.store.emit('nav', 'editor');
    });
    const deliverBtn = this.el('#deliver');
    if (deliverBtn) deliverBtn.addEventListener('click', () => {
      try { this.store.markDelivered(order.id); alert('已标记打包交付，订单完成'); }
      catch (e) { alert((e as Error).message); }
    });
    const addBtn = this.el('#addShot');
    if (addBtn) addBtn.addEventListener('click', () => {
      const name = this.el<HTMLInputElement>('#newShotName').value.trim();
      if (!name) { alert('请填写镜头名称'); return; }
      const dv = this.el<HTMLInputElement>('#newShotDeadline').value;
      const dl = dv ? new Date(dv + 'T18:00:00').getTime() : order.deadline;
      const shot = this.store.createShot(order.id, name, dl);
      this.store.selectShot(shot.id);
      this.drawDetail();
    });

    this.drawShots(order);
  }

  private drawShots(order: Order): void {
    const role = this.store.data.role;
    const host = this.el('#shotList');
    host.innerHTML = order.shots.map((s) => `
      <div class="shot-row" data-shot="${s.id}">
        <div class="row" style="justify-content:space-between">
          <strong>${s.name}</strong>
          <span class="tag ${s.status}">${STATUS_LABEL[s.status]}</span>
        </div>
        <div class="muted" style="margin-top:5px">
          返工 <b style="color:var(--warn)">${s.reworkCount}</b> 次 ｜
          截止 <span class="${s.deadline && s.deadline < Date.now() ? 'deadline-late' : ''}">${fmtTime(s.deadline)}（${daysLeft(s.deadline)}）</span>
          ${s.project ? `｜ ${s.project.frameCount} 帧 @ ${s.project.fps}fps，时长 ${(s.project.frameCount / s.project.fps).toFixed(2)}s` : ''}
        </div>
        <div class="actions" data-actions="${s.id}"></div>
        <div class="hist">${s.history.map((h) => `<div>${fmtTime(h.at)} · ${ROLE_LABEL[h.by]} — ${h.action}</div>`).join('') || '<div class="muted">暂无记录</div>'}</div>
      </div>
    `).join('') || '<p class="muted">还没有镜头，制作员可在下方创建。</p>';

    host.querySelectorAll<HTMLElement>('.shot-row').forEach((row) => {
      const shot = order.shots.find((s) => s.id === row.dataset.shot)!;
      const actions = row.querySelector<HTMLElement>('.actions')!;
      const mk = (label: string, fn: () => void, cls = '') => {
        const b = document.createElement('button');
        b.textContent = label;
        if (cls) b.className = cls;
        b.onclick = fn;
        actions.appendChild(b);
      };
      const open = () => { this.store.selectShot(shot.id); this.store.emit('nav', 'editor'); };
      mk('打开编辑器', open);

      if (role === 'artist') {
        if (shot.status === 'in_progress' || shot.status === 'rework') mk('提交审核', () => this.guard(() => this.store.submitShot(shot.id)), 'primary');
      }
      if (role === 'supervisor') {
        if (shot.status === 'review') {
          mk('审核通过', () => this.guard(() => this.store.approveShot(shot.id)), 'primary');
          mk('退回返工', () => {
            const reason = prompt('请填写退回原因（将记入返工记录）');
            if (reason && reason.trim()) this.guard(() => this.store.reworkShot(shot.id, reason.trim()));
          }, 'danger');
        }
      }
      if (role === 'artist' && shot.status === 'done' && shot.project) {
        mk('导出序列帧 ZIP', async () => {
          const p = shot.project!;
          await exportSequence(p, 0, p.frameCount - 1);
        });
      }
    });
  }

  private guard(fn: () => void): void {
    try { fn(); } catch (e) { alert((e as Error).message); }
  }
}
