import Toolbar from './components/Toolbar';
import EditorCanvas from './components/EditorCanvas';
import Terrain3D from './components/Terrain3D';
import LayersPanel from './components/LayersPanel';
import PropertyPanel from './components/PropertyPanel';
import WorkflowPanel from './components/WorkflowPanel';
import { useEditor } from './state/store';

export default function App() {
  const s = useEditor();
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">盐</span>
          <div>
            <h1>盐田纳潮沟渠与卤水池矢量图编辑器</h1>
            <p>
              {s.project.name} · 客户：{s.project.customer} · 下单 {new Date(s.project.createdAt).toLocaleDateString('zh-CN')} ·
              截止 {new Date(s.project.deadline).toLocaleDateString('zh-CN')}
            </p>
          </div>
        </div>
        <div className="header-meta">
          <span>要素 {s.features.length}</span>
          <span>图层 {s.layers.length}</span>
          <span>工单 {s.entries.length}</span>
        </div>
      </header>

      <Toolbar />

      <main className="workspace">
        <aside className="sidebar left">
          <LayersPanel />
          <PropertyPanel />
        </aside>

        <section className="stage">
          <EditorCanvas />
          <Terrain3D />
        </section>

        <aside className="sidebar right">
          <WorkflowPanel />
        </aside>
      </main>
    </div>
  );
}
