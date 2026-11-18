import { createSignal } from 'solid-js';
import { generateBuilding } from './data/generator';
import { createStore } from './state/store';
import { MapEngine } from './engine/mapEngine';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';
import QuizPanel from './components/QuizPanel';

const data = generateBuilding();

export default function App() {
  const store = createStore(data);
  const [engine, setEngine] = createSignal<MapEngine>();

  return (
    <div class="app">
      <header class="topbar">
        <div>
          <div class="title">实验室安全设施分层渲染与识图考核平台</div>
          <div class="sub">正交相机平面图 · 视口裁剪 · 聚合渲染 · 识图考核</div>
        </div>
        <div class="role-switch">
          <button
            class={store.role() === 'teacher' ? 'active' : ''}
            onClick={() => store.saveRole('teacher')}
          >老师端</button>
          <button
            class={store.role() === 'student' ? 'active' : ''}
            onClick={() => store.saveRole('student')}
          >学员端</button>
        </div>
      </header>

      <div class="main">
        <Sidebar data={data} store={store} engine={engine} />
        <MapView data={data} store={store} engineRef={setEngine} />
        <QuizPanel store={store} data={data} />
      </div>
    </div>
  );
}
