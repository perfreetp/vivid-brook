import { store, useEditor } from '../state/store';
import { KIND_META } from '../lib/factory';
import type { Feature } from '../types';

export default function LayersPanel() {
  const s = useEditor();

  const countOf = (layerId: string) => s.features.filter((f) => f.layerId === layerId).length;

  const selectLayerFeatures = (layerId: string) => {
    const ids = s.features.filter((f) => f.layerId === layerId && f.visible).map((f) => f.id);
    store.select(ids);
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>图层</h3>
        <button className="mini-btn" onClick={() => store.addLayer()}>＋ 新建</button>
      </div>
      <div className="layer-list">
        {s.layers.map((l) => (
          <div key={l.id} className={`layer-row ${s.activeLayerId === l.id ? 'active' : ''}`} onClick={() => store.setActiveLayer(l.id)}>
            <span className="layer-swatch" style={{ background: l.color }} />
            <span className="layer-name" title="点击设为当前图层，双击选中图层内全部要素"
              onDoubleClick={() => selectLayerFeatures(l.id)}>
              {l.name} <em>({countOf(l.id)})</em>
            </span>
            <button
              className={`icon-btn ${l.visible ? '' : 'off'}`}
              title={l.visible ? '隐藏' : '显示'}
              onClick={(e) => { e.stopPropagation(); store.toggleLayerVisible(l.id); }}
            >
              {l.visible ? '👁' : '🚫'}
            </button>
            <button
              className={`icon-btn ${l.locked ? 'on' : ''}`}
              title={l.locked ? '解锁图层' : '锁定图层（锁定后不可编辑）'}
              onClick={(e) => { e.stopPropagation(); store.toggleLayerLock(l.id); }}
            >
              {l.locked ? '🔒' : '🔓'}
            </button>
          </div>
        ))}
      </div>

      <div className="panel-head" style={{ marginTop: 10 }}>
        <h3>要素（{s.features.length}）</h3>
      </div>
      <div className="feature-list">
        {s.features.map((f: Feature) => {
          const layerLocked = store.isLayerLocked(f.layerId);
          const meta = KIND_META[f.kind];
          return (
            <div
              key={f.id}
              className={`feature-row ${s.selectedIds.includes(f.id) ? 'active' : ''} ${f.role === 'bank' ? 'bank' : ''}`}
              onClick={(e) => store.select([f.id], e.ctrlKey || e.metaKey)}
            >
              <span className="layer-swatch" style={{ background: meta.color }} />
              <span className="feature-name" title={f.note || f.id}>
                {f.name}
                {f.role === 'bank' ? <em className="tag">沟沿</em> : null}
                {f.pathType === 'closed' ? <em className="tag">闭合</em> : <em className="tag">开放</em>}
              </span>
              <button
                className="icon-btn"
                title={f.locked ? '解锁' : '锁定'}
                onClick={(e) => { e.stopPropagation(); store.toggleFeatureLock(f.id); }}
                disabled={layerLocked}
              >
                {f.locked || layerLocked ? '🔒' : '🔓'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
