import { useState } from 'react';
import { useStore } from '../store/store';
import { COMPONENTS } from '../data/surveyData';

export default function SearchBar() {
  const [q, setQ] = useState('');
  const [miss, setMiss] = useState(false);
  const flyTo = useStore((s) => s.flyTo);
  const setSelection = useStore((s) => s.setSelection);
  const setFocused = useStore((s) => s.setFocused);

  const go = () => {
    const query = q.trim().toUpperCase();
    if (!query) return;
    const comp = COMPONENTS.find((c) => c.id.toUpperCase().includes(query));
    if (!comp) { setMiss(true); return; }
    setMiss(false);
    setSelection([comp.id]);
    setFocused(comp.id);
    flyTo({ x: comp.x, y: comp.y, worldWidth: 80 });
  };

  return (
    <div className="search-bar">
      <input
        placeholder="输入构件编号直达,如 SP-1-0031"
        value={q}
        onChange={(e) => { setQ(e.target.value); setMiss(false); }}
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
      <button className="btn" onClick={go}>定位</button>
      {miss && <span className="miss">未找到该编号</span>}
    </div>
  );
}
