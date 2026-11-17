<script>
  import { orders, role, designs, createOrder, updateItem, deliverOrder, isOverdue, anchors, params } from '../stores.js'

  // ---- 客户建单表单 ----
  let title = ''
  let customer = ''
  let deadline = ''
  let items = [{ name: '指腹A', designName: '', qty: 1 }]

  function addRow() { items = [...items, { name: `指腹${String.fromCharCode(65 + items.length)}`, designName: '', qty: 1 }] }
  function delRow(i) { items = items.filter((_, k) => k !== i) }

  function submit() {
    if (!title.trim() || !deadline || !items.length) return
    createOrder(title.trim(), customer.trim() || '未署名客户', deadline, items)
    title = ''; customer = ''; deadline = ''
    items = [{ name: '指腹A', designName: '', qty: 1 }]
  }

  // ---- 制作员 ----
  function loadDesign(name) {
    const d = $designs.find(x => x.name === name)
    if (!d) return
    anchors.set(JSON.parse(JSON.stringify(d.anchors)))
    params.update(p => ({ ...p, ...d.params }))
  }

  // ---- 主管 ----
  function reject(orderId, item) {
    const note = window.prompt(`退回「${item.name}」的原因(将记入返工备注):`, item.note || '')
    if (note === null) return
    updateItem(orderId, item.id, { status: '制作中', rework: item.rework + 1, note })
  }

  const fmt = iso => iso ? new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'
  const statusClass = s => ({ 待制作: 'st0', 制作中: 'st1', 待审核: 'st2', 已通过: 'st3' }[s] || '')
</script>

<div class="orders">
  {#if $role === 'customer'}
    <section class="card">
      <h3>客户下单建单</h3>
      <div class="form">
        <input placeholder="订单标题,如:FR-06 柔爪硅胶指腹打样" bind:value={title} />
        <input placeholder="客户名称" bind:value={customer} />
        <label>截止时间 <input type="datetime-local" bind:value={deadline} /></label>
      </div>
      <table>
        <thead><tr><th>指腹条目</th><th>关联设计</th><th>数量</th><th></th></tr></thead>
        <tbody>
          {#each items as it, i}
            <tr>
              <td><input bind:value={it.name} /></td>
              <td>
                <select bind:value={it.designName}>
                  <option value="">(未关联)</option>
                  {#each $designs as d}<option value={d.name}>{d.name}</option>{/each}
                </select>
              </td>
              <td><input type="number" min="1" bind:value={it.qty} style="width:60px" /></td>
              <td><button on:click={() => delRow(i)} disabled={items.length <= 1}>删</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <div class="row">
        <button on:click={addRow}>+ 加条目</button>
        <button class="primary" on:click={submit} disabled={!title.trim() || !deadline}>提交订单</button>
      </div>
    </section>
  {/if}

  <section class="card">
    <h3>订单列表({$orders.length})</h3>
    {#if !$orders.length}<p class="empty">暂无订单{$role === 'customer' ? ',请在上方建单' : ''}</p>{/if}
    {#each $orders as o (o.id)}
      <div class="order" class:overdue={isOverdue(o)}>
        <div class="ohead">
          <b>{o.id} · {o.title}</b>
          <span class="chip">{o.status}</span>
          <span class="meta">客户:{o.customer}</span>
          <span class="meta">截止:{fmt(o.deadline)}{isOverdue(o) ? ' ⚠已超期' : ''}</span>
          {#if o.status === '已交付'}<span class="meta">交付:{fmt(o.deliveredAt)}</span>{/if}
          {#if $role === 'lead' && o.status === '待打包'}
            <button class="primary" on:click={() => deliverOrder(o.id)}>打包交付</button>
          {/if}
        </div>
        <table>
          <thead><tr><th>条目</th><th>设计</th><th>数量</th><th>状态</th><th>返工</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            {#each o.items as it (it.id)}
              <tr>
                <td>{it.id} {it.name}</td>
                <td>{it.designName || '-'}</td>
                <td>{it.qty}</td>
                <td><span class="chip {statusClass(it.status)}">{it.status}</span></td>
                <td class:rework={it.rework > 0}>{it.rework} 次</td>
                <td class="note">{it.note || '-'}</td>
                <td class="ops">
                  {#if $role === 'maker'}
                    {#if it.status === '待制作'}
                      <button on:click={() => updateItem(o.id, it.id, { status: '制作中' })}>开始制作</button>
                    {/if}
                    {#if it.status === '制作中'}
                      {#if it.designName}<button on:click={() => loadDesign(it.designName)}>载入设计</button>{/if}
                      <button on:click={() => updateItem(o.id, it.id, { status: '待审核' })}>提交审核</button>
                    {/if}
                  {/if}
                  {#if $role === 'lead' && it.status === '待审核'}
                    <button class="ok" on:click={() => updateItem(o.id, it.id, { status: '已通过', note: '' })}>通过</button>
                    <button class="bad" on:click={() => reject(o.id, it)}>退回</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/each}
  </section>
</div>

<style>
  .orders { display: flex; flex-direction: column; gap: 12px; overflow: auto; }
  .card { background: #1a1f2b; border: 1px solid #2a3142; border-radius: 8px; padding: 14px; }
  h3 { margin: 0 0 10px; font-size: 14px; color: #dfe6f2; }
  .form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
  .form label { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #aab3c5; }
  input, select { background: #12151c; color: #dfe6f2; border: 1px solid #3a4358; border-radius: 4px; padding: 5px 8px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #232a38; color: #c6cede; }
  th { color: #66708a; font-weight: 500; }
  .row { display: flex; gap: 8px; margin-top: 10px; }
  button { background: #232a38; color: #dfe6f2; border: 1px solid #3a4358; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  button:disabled { opacity: 0.4; cursor: default; }
  button.primary { background: #2d4a78; border-color: #4f9cff; }
  button.ok { background: #1e4d3a; border-color: #3fb68b; }
  button.bad { background: #4d2222; border-color: #e5484d; }
  .order { border: 1px solid #2a3142; border-radius: 6px; padding: 10px; margin-top: 8px; }
  .order.overdue { border-color: #e5484d; }
  .ohead { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .ohead b { color: #dfe6f2; font-size: 13px; }
  .meta { font-size: 12px; color: #8a93a6; }
  .chip { background: #2a3142; border-radius: 10px; padding: 2px 10px; font-size: 11px; color: #dfe6f2; }
  .chip.st0 { background: #333a4d; }
  .chip.st1 { background: #2d4a78; }
  .chip.st2 { background: #6b5a1e; }
  .chip.st3 { background: #1e4d3a; }
  .rework { color: #e5a54d; font-weight: 700; }
  .note { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8a93a6; }
  .ops { white-space: nowrap; }
  .ops button { margin-right: 4px; }
  .empty { color: #66708a; font-size: 13px; }
</style>
