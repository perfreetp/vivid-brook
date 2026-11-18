import { useStore } from './store/store';
import MapView from './map/MapView';
import TopBar from './ui/TopBar';
import SearchBar from './ui/SearchBar';
import InfoPanel from './ui/InfoPanel';
import LayerTree from './ui/LayerTree';
import DispatchPanel from './ui/DispatchPanel';
import Dashboard from './ui/Dashboard';
import Popup from './ui/Popup';
import BatchBar from './ui/BatchBar';

const TABS = [
  { key: 'layers', name: '图层' },
  { key: 'dispatch', name: '检修派单' },
  { key: 'dashboard', name: '统计看板' },
];

export default function App() {
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <div className="map-wrap">
          <MapView />
          <Popup />
          <BatchBar />
        </div>
        <aside className="sidebar">
          <SearchBar />
          <InfoPanel />
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={sidebarTab === t.key ? 'on' : ''} onClick={() => setSidebarTab(t.key)}>
                {t.name}
              </button>
            ))}
          </div>
          <div className="sidebar-body">
            {sidebarTab === 'layers' && <LayerTree />}
            {sidebarTab === 'dispatch' && <DispatchPanel />}
            {sidebarTab === 'dashboard' && <Dashboard />}
          </div>
        </aside>
      </div>
    </div>
  );
}
