import { onCleanup, onMount, createEffect, Show } from 'solid-js';
import { BuildingData, Facility, GROUP_META, LayerGroup, TYPE_META } from '../types';
import { MapEngine, QuizMark, ZoomLevel } from '../engine/mapEngine';
import { Store } from '../state/store';
import Minimap from './Minimap';

interface Props {
  data: BuildingData;
  store: Store;
  engineRef: (e: MapEngine) => void;
}

const ZOOM_NAME: Record<ZoomLevel, string> = {
  building: '楼栋级（聚合视图）',
  floor: '楼层级',
  room: '房间级（单设施视图）'
};

export default function MapView(props: Props) {
  let canvas!: HTMLCanvasElement;
  let overlay!: HTMLDivElement;
  let engine: MapEngine;

  onMount(() => {
    engine = new MapEngine(canvas, overlay, props.data, {
      onViewChange: (v, z) => {
        props.store.setView(v);
        props.store.setZoom(z);
        if (v.floor !== props.store.floor()) props.store.setFloor(v.floor);
      },
      onSelectFacility: f => props.store.selectFacility(f),
      onSelectCluster: c => props.store.selectCluster(c),
      onBoxSelect: (list, rect) => {
        props.store.applyBoxSelect(list, rect);
        if (list.length > 0) props.store.setBoxMode(false);
      }
    });
    props.engineRef(engine);
    onCleanup(() => engine.dispose());
  });

  // 图层开关 -> 引擎（复用 thin instance buffer，不重建资源，避免闪烁）
  createEffect(() => {
    engine?.setLayers(props.store.layers());
  });

  createEffect(() => {
    engine?.setFloor(props.store.floor());
  });

  createEffect(() => {
    engine?.setHighlight(props.store.highlightIds());
  });

  createEffect(() => {
    engine?.setBoxSelectMode(props.store.boxMode());
  });

  // 考核标记
  createEffect<Map<string, QuizMark>>(() => {
    const marks = new Map<string, QuizMark>();
    if (props.store.quizMode()) {
      const q = props.store.activeQuestion();
      for (const id of props.store.pickedIds()) marks.set(id, 'picked');
      if (q) {
        for (const id of q.answerIds) marks.set(id, marks.has(id) ? 'correct' : 'correct');
      }
    }
    engine?.setQuizMarks(marks);
    return marks;
  });

  createEffect(() => {
    const sel = props.store.selected();
    engine?.setSelected(sel?.id ?? null);
  });

  const f = () => props.store.selected();

  return (
    <div class="map-wrap">
      <canvas ref={canvas} class="map-canvas" />
      <div ref={overlay} class="map-overlay" />

      <div class="zoom-badge">
        {props.store.floor()}F · {ZOOM_NAME[props.store.zoom()]}
      </div>

      <div class="toolbar">
        <button
          class={props.store.boxMode() ? 'active' : ''}
          onClick={() => props.store.setBoxMode(!props.store.boxMode())}
        >
          {props.store.boxMode() ? '退出框选' : '框选统计'}
        </button>
        <button onClick={() => engine?.flyTo(props.store.view()?.cx ?? 48, props.store.view()?.cy ?? 31, 95)}>
          全楼视图
        </button>
      </div>

      <Show when={f()}>
        <InfoCard facility={f()!} store={props.store} onClose={() => props.store.selectFacility(null)} />
      </Show>

      <Show when={props.store.boxStat()}>
        <BoxStat store={props.store} data={props.data} />
      </Show>

      <Minimap
        data={props.data}
        floor={() => props.store.floor()}
        view={() => props.store.view()}
        layers={() => props.store.layers()}
        onJump={(x, y) => engine?.flyTo(x, y, Math.max(12, (props.store.view()?.halfH ?? 30) * 0.6))}
      />

      <Show when={props.store.quizMode() && props.store.activeQuestion()}>
        <QuizBar store={props.store} />
      </Show>
    </div>
  );
}

function InfoCard(props: { facility: Facility; store: Store; onClose: () => void }) {
  const f = props.facility;
  const linked = () => props.store && f;
  void linked;
  return (
    <div class="info-card">
      <button class="close" onClick={props.onClose}>×</button>
      <h3>{TYPE_META[f.type].name} · {f.code}</h3>
      <div class="kv"><span class="k">所属分组</span><span class="v">{GROUP_META[f.group].name}</span></div>
      <div class="kv"><span class="k">位置</span><span class="v">{f.building} {f.floor}F · {f.roomName}（{f.roomId}）</span></div>
      <div class="kv"><span class="k">坐标</span><span class="v">({f.x}, {f.y})</span></div>
      <div class="kv"><span class="k">规格型号</span><span class="v">{f.spec}</span></div>
      <div class="kv"><span class="k">关联编号</span><span class="v">{f.linkedCode}</span></div>
      <div class="kv"><span class="k">安装日期</span><span class="v">{f.installDate}</span></div>
      <div class="kv">
        <span class="k">运行状态</span>
        <span class="v"><span class={`status-tag status-${f.status}`}>{f.status}</span></span>
      </div>
      <div class="hint mt8">黄色高亮为同编号关联设备（同楼层）。</div>
    </div>
  );
}

function BoxStat(props: { store: Store; data: BuildingData }) {
  const stat = () => props.store.boxStat()!;
  const types: LayerGroup[] = ['fire', 'gas', 'chem', 'util'];
  return (
    <div class="box-stat">
      <div class="flex-between mb8">
        <strong>框选统计</strong>
        <button onClick={() => props.store.clearBox()}>清除</button>
      </div>
      <div class="num">{stat().total} <span style={{ 'font-size': '12px', color: '#64748b' }}>个设施</span></div>
      {types.map(g => {
        const n = Object.entries(stat().byType)
          .filter(([t]) => TYPE_META[t as keyof typeof TYPE_META].group === g)
          .reduce((s, [, n]) => s + n, 0);
        return (
          <div class="row">
            <span><i class="layer-dot" style={{ background: GROUP_META[g].color, display: 'inline-block', 'margin-right': '6px' }} />{GROUP_META[g].name}</span>
            <strong>{n}</strong>
          </div>
        );
      })}
      {Object.entries(stat().byType).map(([t, n]) => (
        <div class="row muted">
          <span>　{TYPE_META[t as keyof typeof TYPE_META].name}</span>
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
}

function QuizBar(props: { store: Store }) {
  const s = props.store;
  const q = () => s.activeQuestion()!;
  const paper = () => s.activePaper()!;
  return (
    <div class="quiz-bar">
      <div class="q-label">
        【识图作答】{q().label}
        <span class="muted" style={{ color: '#94a3b8' }}>（已选 {s.pickedIds().length} / 需选 {q().count}）</span>
      </div>
      <div class="q-meta">
        <span>第 {s.activeQuestionIdx() + 1}/{paper().questions.length} 题</span>
        <div class="progress">
          <i style={{ width: `${((s.activeQuestionIdx()) / paper().questions.length) * 100}%` }} />
        </div>
        <button class="primary" onClick={() => s.submitAnswer(
          localStorage.getItem('lsmp-class') || '应化2401',
          localStorage.getItem('lsmp-student') || '学员01'
        )}>
          提交本题
        </button>
        <button onClick={() => s.exitQuiz()}>退出考核</button>
      </div>
      <div class="hint" style={{ color: '#94a3b8', 'margin-top': '6px' }}>
        在图上直接点选设施作答，再次点选可取消；系统按坐标与类型自动初判，提交后由老师复核。
      </div>
    </div>
  );
}
