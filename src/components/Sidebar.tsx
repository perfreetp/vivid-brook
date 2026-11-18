import { createSignal, Show } from 'solid-js';
import { BuildingData, GROUP_META, LayerGroup, TYPE_META } from '../types';
import { MapEngine } from '../engine/mapEngine';
import { Store } from '../state/store';

interface Props {
  data: BuildingData;
  store: Store;
  engine: () => MapEngine | undefined;
}

const GROUPS: LayerGroup[] = ['fire', 'gas', 'chem', 'util'];

export default function Sidebar(props: Props) {
  const [kw, setKw] = createSignal('');
  const [msg, setMsg] = createSignal('');

  const totalOf = (g: LayerGroup) =>
    props.data.facilities.filter(f => f.group === g && f.floor === props.store.floor()).length;

  const doSearch = () => {
    const f = props.store.searchFacility(kw());
    if (!f) {
      setMsg('未找到匹配编号的设施');
      return;
    }
    setMsg(`定位到 ${TYPE_META[f.type].name} ${f.code}（${f.roomName}）`);
    props.store.setFloor(f.floor);
    props.engine()?.locateFacility(f);
    props.store.selectFacility(f);
  };

  return (
    <aside class="sidebar">
      <div class="panel-section">
        <h4>设备编号搜索</h4>
        <div class="search-box">
          <input
            value={kw()}
            placeholder="如 F3-GC-0218"
            onInput={e => setKw(e.currentTarget.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
          />
          <button class="primary" onClick={doSearch}>定位</button>
        </div>
        <Show when={msg()}>
          <div class="hint mt8" style={{ color: msg().startsWith('未') ? '#dc2626' : '#15803d' }}>{msg()}</div>
        </Show>
      </div>

      <div class="panel-section">
        <h4>图层分组（开关后视口无闪烁重排）</h4>
        {GROUPS.map(g => (
          <div class="layer-row">
            <span class="layer-dot" style={{ background: GROUP_META[g].color }} />
            <label>{GROUP_META[g].name}</label>
            <span class="muted" style={{ 'font-size': '11px' }}>{totalOf(g)}</span>
            <input
              type="checkbox"
              checked={props.store.layers()[g]}
              onChange={() => props.store.toggleLayer(g)}
            />
          </div>
        ))}
        <div class="hint">
          消防：洗眼器 · 气防：气瓶柜 · 危化品：通风橱 · 水电：管线
        </div>
      </div>

      <div class="panel-section">
        <h4>楼层切换</h4>
        <div class="floor-grid">
          {props.data.floorList.map(fl => (
            <button
              class={props.store.floor() === fl.floor ? 'active' : ''}
              onClick={() => props.store.setFloor(fl.floor)}
            >
              {fl.label}
            </button>
          ))}
        </div>
      </div>

      <div class="panel-section">
        <h4>图例</h4>
        {(Object.keys(TYPE_META) as (keyof typeof TYPE_META)[]).map(t => (
          <div class="layer-row">
            <span
              style={{
                width: '18px', height: '18px', 'border-radius': '50%',
                background: TYPE_META[t].color, color: '#fff',
                display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center',
                'font-size': '11px', 'font-weight': 700
              }}
            >{TYPE_META[t].short}</span>
            <label>{TYPE_META[t].name}</label>
          </div>
        ))}
      </div>

      <div class="panel-section">
        <h4>数据概览</h4>
        <div class="hint">
          全楼设施总数：<strong>{props.data.facilities.length.toLocaleString()}</strong> 个<br />
          房间总数：{props.data.rooms.length} 间 · {props.data.floors} 个楼层<br />
          当前层设施：
          <strong>
            {props.data.facilities.filter(f => f.floor === props.store.floor()).length.toLocaleString()}
          </strong> 个
        </div>
      </div>
    </aside>
  );
}
