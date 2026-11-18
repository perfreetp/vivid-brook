import { useEffect, useState } from 'react';
import { store, useEditor } from '../state/store';
import { KIND_META } from '../lib/factory';
import {
  polylineLength,
  polygonArea,
  findSelfIntersections,
  fmtDist,
} from '../lib/geometry';
import type { Feature } from '../types';

function NumberField({
  label, value, step, min, onCommit, disabled, suffix,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="prop-field">
      <span>{label}</span>
      <span className="input-wrap">
        <input
          type="number"
          value={text}
          step={step}
          min={min}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = parseFloat(text);
            if (!Number.isNaN(v)) onCommit(min !== undefined ? Math.max(min, v) : v);
            else setText(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {suffix ? <em>{suffix}</em> : null}
      </span>
    </label>
  );
}

export default function PropertyPanel() {
  const s = useEditor();
  const selected = s.features.filter((f) => s.selectedIds.includes(f.id));
  const single: Feature | null = selected.length === 1 ? selected[0] : null;
  const [note, setNote] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    setNote(single?.note ?? '');
    setName(single?.name ?? '');
  }, [single?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = single ? single.locked || store.isLayerLocked(single.layerId) : false;

  if (selected.length === 0) {
    return (
      <div className="panel">
        <div className="panel-head"><h3>属性</h3></div>
        <p className="muted small">
          未选中要素。选择一个要素查看/编辑宽度、边坡比等属性；按住 Ctrl 点击或框选可多选，对两条以上路径执行布尔运算。
        </p>
      </div>
    );
  }

  // 多选：批量属性
  if (!single) {
    const anyOpen = selected.some((f) => f.pathType === 'open');
    return (
      <div className="panel">
        <div className="panel-head"><h3>批量属性（{selected.length} 个要素）</h3></div>
        <p className="muted small">{selected.map((f) => f.name).join('、')}</p>
        {anyOpen && (
          <>
            <NumberField label="统一宽度" value={selected[0].width} step={1} min={0} suffix="m"
              onCommit={(v) => store.commit('批量宽度', (d) => {
                d.features.forEach((f) => {
                  if (s.selectedIds.includes(f.id) && f.pathType === 'open') f.width = v;
                });
              })} />
            <NumberField label="统一边坡比" value={selected[0].slope} step={0.1} min={0} suffix="m(水平)/m(垂直)"
              onCommit={(v) => store.commit('批量边坡比', (d) => {
                d.features.forEach((f) => {
                  if (s.selectedIds.includes(f.id) && f.pathType === 'open') f.slope = v;
                });
              })} />
            <button className="tb-btn wide" onClick={() => selected.forEach((f) => f.pathType === 'open' && store.generateBanks(f.id))}>
              全部重新生成双侧沟沿
            </button>
          </>
        )}
      </div>
    );
  }

  const meta = KIND_META[single.kind];
  const length = polylineLength(single.points, single.pathType === 'closed');
  const area = single.pathType === 'closed'
    ? polygonArea(single.points) - single.holes.reduce((sum, h) => sum + polygonArea(h), 0)
    : 0;
  const selfHits = single.pathType === 'closed' ? findSelfIntersections(single.points) : [];
  const bankOffset = single.width / 2 + single.depth * single.slope;

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>属性</h3>
        <span className="kind-badge" style={{ background: meta.color }}>{meta.label}·{single.pathType === 'closed' ? '闭合' : '开放'}</span>
      </div>

      <label className="prop-field">
        <span>名称</span>
        <input
          value={name}
          disabled={locked}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && store.updateFeature(single.id, { name: name.trim() })}
        />
      </label>

      {single.pathType === 'open' && (
        <>
          <NumberField label="设计宽度" value={single.width} step={0.5} min={0.5} suffix="m"
            disabled={locked}
            onCommit={(v) => store.updateFeature(single.id, { width: v })} />
          <NumberField label="边坡比" value={single.slope} step={0.1} min={0} suffix="H:V"
            disabled={locked}
            onCommit={(v) => store.updateFeature(single.id, { slope: v })} />
        </>
      )}
      {single.kind === 'pool' && (
        <NumberField label="池埂宽" value={single.width} step={0.5} min={0} suffix="m"
          disabled={locked}
          onCommit={(v) => store.updateFeature(single.id, { width: v })} />
      )}
      <NumberField label={single.kind === 'pool' ? '池深' : '渠/沟深'} value={single.depth} step={0.1} min={0} suffix="m"
        disabled={locked}
        onCommit={(v) => store.updateFeature(single.id, { depth: v })} />

      {single.pathType === 'open' && (
        <div className="calc-box">
          <div>沟沿单侧偏移 = 半宽 {fmtDist(single.width / 2)} + 深×边坡比 {fmtDist(single.depth * single.slope)}</div>
          <strong>= {fmtDist(bankOffset)}</strong>
          <button
            className="tb-btn wide primary"
            disabled={locked}
            onClick={() => store.generateBanks(single.id)}
            title="沿路径等距偏移生成左/右两条沟沿（虚线显示，随属性可重新生成）"
          >
            生成双侧沟沿（等距偏移）
          </button>
        </div>
      )}

      <div className="stats-box">
        <div><span>顶点数</span><b>{single.points.length}</b></div>
        <div><span>{single.pathType === 'closed' ? '周长' : '长度'}</span><b>{fmtDist(length)}</b></div>
        {single.pathType === 'closed' && (
          <>
            <div><span>净面积</span><b>{area.toFixed(1)} m²</b></div>
            <div><span>孔洞</span><b>{single.holes.length} 个</b></div>
          </>
        )}
      </div>

      {selfHits.length > 0 && (
        <div className="warn-box">
          ⚠ 检测到 {selfHits.length} 个自交点，画布中已红色脉冲高亮。请调整顶点消除自交后再导出。
        </div>
      )}

      <label className="prop-field column">
        <span>备注</span>
        <textarea
          rows={3}
          value={note}
          disabled={locked}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => store.updateFeature(single.id, { note })}
        />
      </label>
    </div>
  );
}
