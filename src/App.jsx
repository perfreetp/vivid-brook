// 主界面:图元库 | 工具栏 | 编辑画布 | 三维预览 | 审核对比 | 历史
import { For, Show, createSignal } from 'solid-js';
import {
  state, setState, entityList, selectedEntities, undo, redo, jumpHistory,
  booleanOp, mergeRunners, punchInsert, splitComposite, mirrorSelected,
  circularArray, deleteSelected, updateEntity,
} from './store';
import { LIBRARY, KINDS } from './entities';
import CanvasEditor from './CanvasEditor';
import Preview3D from './Preview3D';
import ReviewPanel from './ReviewPanel';
import { exportSVG } from './svgExport';

function Library() {
  return (
    <div class="library">
      <div class="section-title">图元库</div>
      <For each={LIBRARY}>
        {(item) => (
          <div
            class="lib-item"
            draggable="true"
            onDragStart={(e) => e.dataTransfer.setData('text/x-symbol', item.kind)}
            title={`拖入画布放置${item.label}`}
          >
            <span class="lib-icon" style={{ color: KINDS[item.kind].color }}>{item.icon}</span>
            {item.label}
          </div>
        )}
      </For>
      <div class="section-title" style={{ 'margin-top': '12px' }}>吸附</div>
      <label class="check"><input type="checkbox" checked={state.snap.grid} onChange={(e) => setState('snap', 'grid', e.target.checked)} /> 螺孔网格</label>
      <label class="check"><input type="checkbox" checked={state.snap.endpoint} onChange={(e) => setState('snap', 'endpoint', e.target.checked)} /> 端点</label>
      <label class="check"><input type="checkbox" checked={state.snap.midpoint} onChange={(e) => setState('snap', 'midpoint', e.target.checked)} /> 中点</label>
      <label class="check"><input type="checkbox" checked={state.snap.guides} onChange={(e) => setState('snap', 'guides', e.target.checked)} /> 对齐参考线</label>
      <label class="check">
        网格距
        <input class="num" type="number" min="5" step="5" value={state.gridPitch}
          onChange={(e) => setState('gridPitch', Math.max(1, +e.target.value || 25))} /> mm
      </label>
    </div>
  );
}

function Toolbar() {
  const sel = () => state.selection.length;
  return (
    <div class="toolbar">
      <div class="tb-group">
        <button classList={{ active: state.tool === 'select' }} onClick={() => setState('tool', 'select')}>选择</button>
        <button classList={{ active: state.tool === 'annotate' }} onClick={() => setState('tool', 'annotate')}>批注</button>
        <button classList={{ active: state.tool === 'edgeArray' }} disabled={!sel()}
          title="先选中要排列的图元,再点击目标图元的边"
          onClick={() => setState('tool', 'edgeArray')}>沿边等距排列</button>
      </div>
      <div class="tb-group">
        <button disabled={sel() < 2} onClick={() => booleanOp('union')}>并集</button>
        <button disabled={sel() < 2} onClick={() => booleanOp('subtract')}>差集</button>
        <button disabled={sel() < 2} onClick={() => booleanOp('intersect')}>交集</button>
        <button disabled={sel() < 2} onClick={mergeRunners}>合成整条流道</button>
        <button disabled={sel() < 2} onClick={punchInsert}>镶件挖让位孔</button>
        <button disabled={!sel()} onClick={splitComposite}>拆开布尔结果</button>
      </div>
      <div class="tb-group">
        <button disabled={!sel()} onClick={() => mirrorSelected('h')}>水平镜像</button>
        <button disabled={!sel()} onClick={() => mirrorSelected('v')}>垂直镜像</button>
        <button disabled={!sel()} onClick={() => {
          const n = +prompt('阵列数量(含原始):', '4');
          if (n >= 2) {
            const a = +prompt('总角度(°):', '360');
            circularArray(n, isNaN(a) ? 360 : a);
          }
        }}>环形阵列</button>
      </div>
      <div class="tb-group">
        <button disabled={!sel()} onClick={deleteSelected}>删除</button>
        <button onClick={undo} disabled={state.hIndex <= 0}>⟲ 撤销</button>
        <button onClick={redo} disabled={state.hIndex >= state.history.length - 1}>⟳ 重做</button>
      </div>
      <div class="tb-group right">
        <button onClick={exportSVG}>导出 SVG</button>
        <button classList={{ active: state.preview3d }} onClick={() => setState('preview3d', !state.preview3d)}>3D</button>
        <button classList={{ active: state.reviewOpen }} onClick={() => setState('reviewOpen', !state.reviewOpen)}>审核</button>
      </div>
    </div>
  );
}

function PropsEditor() {
  const sel = () => (selectedEntities().length === 1 ? selectedEntities()[0] : null);
  const setParam = (key, val) => {
    const e = sel();
    if (!e || isNaN(val)) return;
    updateEntity(e.id, { params: { ...e.params, [key]: val } }, '修改参数');
  };
  return (
    <Show when={sel()}>
      {(e) => (
        <div class="props">
          <div class="section-title">{KINDS[e().kind].name} 参数</div>
          <div class="prop-row">
            <label>X</label>
            <input type="number" value={Math.round(e().x * 100) / 100}
              onChange={(ev) => updateEntity(e().id, { x: +ev.target.value }, '修改位置')} />
            <label>Y</label>
            <input type="number" value={Math.round(e().y * 100) / 100}
              onChange={(ev) => updateEntity(e().id, { y: +ev.target.value }, '修改位置')} />
            <Show when={e().kind !== 'composite'}>
              <label>旋转°</label>
              <input type="number" value={Math.round(((e().rot || 0) * 180 / Math.PI) * 10) / 10}
                onChange={(ev) => updateEntity(e().id, { rot: (+ev.target.value || 0) * Math.PI / 180 }, '旋转')} />
            </Show>
          </div>
          <div class="prop-row">
            <For each={Object.entries(e().params)}>
              {([k, v]) => (
                <>
                  <label>{k}</label>
                  <input type="number" step="0.5" value={v} onChange={(ev) => setParam(k, +ev.target.value)} />
                </>
              )}
            </For>
          </div>
        </div>
      )}
    </Show>
  );
}

function HistoryPanel() {
  return (
    <div class="history">
      <div class="section-title">历史 ({state.hIndex + 1}/{state.history.length},上限50步)</div>
      <div class="history-list">
        <For each={state.history}>
          {(h, i) => (
            <div
              class="history-item"
              classList={{ current: i() === state.hIndex }}
              onClick={() => jumpHistory(i())}
            >
              {i() + 1}. {h.label}
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div class="app">
      <header class="app-header">
        <b>浇注系统平面布置编辑台</b>
        <span class="muted">注塑模具 · 2D 矢量编辑 + 3D 校核 · 选中 {state.selection.length} 个图元</span>
      </header>
      <Toolbar />
      <div class="main">
        <Library />
        <div class="center">
          <CanvasEditor />
          <PropsEditor />
        </div>
        <Show when={state.preview3d}>
          <div class="right-3d"><Preview3D /></div>
        </Show>
        <Show when={state.reviewOpen}>
          <div class="right-review">
            <ReviewPanel />
            <HistoryPanel />
          </div>
        </Show>
      </div>
    </div>
  );
}
