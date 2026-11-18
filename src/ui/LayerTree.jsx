import { useStore } from '../store/store';
import { TYPES, TYPE_LIST, PIPE_DIAMS, PIPE_COLORS, STATS } from '../data/surveyData';

const LAYERS = [
  { key: 'device', name: '设备层', desc: `救生椅 / 灯杆 / 喷淋头 / 排水篦子 / 监控(共 ${STATS.components} 个)` },
  { key: 'pipeline', name: '管线层', desc: `按管径分色,交叉处自动断开(共 ${STATS.pipes} 段)` },
  { key: 'green', name: '绿化层', desc: `乔木点位 ${STATS.trees} 处` },
  { key: 'warn', name: '警戒线层', desc: '池体安全警戒范围(红色虚线)' },
];

export default function LayerTree() {
  const layers = useStore((s) => s.layers);
  const toggleLayer = useStore((s) => s.toggleLayer);
  const typeToggles = useStore((s) => s.typeToggles);
  const toggleType = useStore((s) => s.toggleType);

  return (
    <div className="layer-tree">
      {LAYERS.map((l) => (
        <div key={l.key} className="layer-node">
          <label className="layer-row">
            <input type="checkbox" checked={layers[l.key]} onChange={() => toggleLayer(l.key)} />
            <span className="layer-name">{l.name}</span>
          </label>
          <div className="layer-desc">{l.desc}</div>
          {l.key === 'device' && layers.device && (
            <div className="sub-types">
              {TYPE_LIST.map((t) => (
                <label key={t} className="sub-type">
                  <input type="checkbox" checked={typeToggles[t]} onChange={() => toggleType(t)} />
                  <span className="dot" style={{ background: TYPES[t].color }} />
                  {TYPES[t].name}
                </label>
              ))}
            </div>
          )}
          {l.key === 'pipeline' && layers.pipeline && (
            <div className="sub-types">
              {PIPE_DIAMS.map((d) => (
                <span key={d} className="pipe-legend">
                  <i style={{ background: PIPE_COLORS[d] }} />DN{d}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
