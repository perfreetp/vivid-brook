<script>
  import SplineEditor from './lib/components/SplineEditor.svelte'
  import SurfaceView from './lib/components/SurfaceView.svelte'
  import UnfoldView from './lib/components/UnfoldView.svelte'
  import OrdersView from './lib/components/OrdersView.svelte'
  import { anchors, params, designs, saveDesign, role } from './lib/stores.js'

  let tab = 'model'
  let designName = ''
  let loadName = ''

  function save() {
    const name = designName.trim()
    if (!name) return
    saveDesign(name, $anchors, $params)
    designName = ''
  }
  function load() {
    const d = $designs.find(x => x.name === loadName)
    if (!d) return
    anchors.set(JSON.parse(JSON.stringify(d.anchors)))
    params.update(p => ({ ...p, ...d.params }))
  }

  const tabs = [
    { id: 'model', label: '曲面建模' },
    { id: 'unfold', label: '展开下料' },
    { id: 'orders', label: '订单项目' }
  ]
  const roles = [
    { id: 'customer', label: '客户' },
    { id: 'maker', label: '制作员' },
    { id: 'lead', label: '主管' }
  ]
</script>

<div class="app">
  <header>
    <h1>硅胶指腹曲面建模与展开下料</h1>
    <nav>
      {#each tabs as t}
        <button class:active={tab === t.id} on:click={() => (tab = t.id)}>{t.label}</button>
      {/each}
    </nav>
    <div class="role">
      角色:
      {#each roles as r}
        <button class:active={$role === r.id} on:click={() => ($role = r.id)}>{r.label}</button>
      {/each}
    </div>
  </header>

  <main>
    {#if tab === 'model'}
      <div class="designbar">
        <input placeholder="设计名称,如:FR06-指腹-邵氏30" bind:value={designName} />
        <button on:click={save} disabled={!designName.trim()}>保存设计</button>
        <select bind:value={loadName}>
          <option value="">载入设计…</option>
          {#each $designs as d}<option value={d.name}>{d.name}</option>{/each}
        </select>
        <button on:click={load} disabled={!loadName}>载入</button>
      </div>
      <div class="grid">
        <SplineEditor />
        <SurfaceView />
      </div>
    {:else if tab === 'unfold'}
      <UnfoldView />
    {:else}
      <OrdersView />
    {/if}
  </main>
</div>

<style>
  :global(body) { margin: 0; background: #0f1218; color: #dfe6f2; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; }
  :global(input[type='range']) { accent-color: #4f9cff; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  header { display: flex; align-items: center; gap: 18px; padding: 10px 16px; background: #161a23; border-bottom: 1px solid #2a3142; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0; font-weight: 600; }
  nav, .role { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #aab3c5; }
  .role { margin-left: auto; }
  header button { background: #232a38; color: #dfe6f2; border: 1px solid #3a4358; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
  header button.active { background: #2d4a78; border-color: #4f9cff; }
  main { flex: 1; padding: 12px 16px; min-height: 0; display: flex; flex-direction: column; }
  main > * { flex: 1; min-height: 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex: 1; min-height: 0; }
  .designbar { display: flex; gap: 8px; margin-bottom: 10px; }
  .designbar input, .designbar select { background: #12151c; color: #dfe6f2; border: 1px solid #3a4358; border-radius: 4px; padding: 5px 8px; font-size: 12px; }
  .designbar button { background: #232a38; color: #dfe6f2; border: 1px solid #3a4358; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .designbar button:disabled { opacity: 0.4; }
  @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; overflow: auto; } }
</style>
