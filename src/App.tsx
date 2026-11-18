import { createEffect, on } from 'solid-js';
import { CanvasView } from './components/CanvasView';
import { SidePanel } from './components/SidePanel';
import { store, env, setResult, setComputing } from './model/store';
import { computeLighting } from './engine/lighting';

export default function App() {
  // 场景或环境变化 -> 防抖重算光照
  let timer: any = null;
  createEffect(on(
    () => [
      JSON.stringify(store.scene.buildings),
      JSON.stringify(store.scene.lights),
      JSON.stringify(store.scene.blocks),
      env().date, env().hour, env().latitude,
    ] as const,
    () => {
      setComputing(true);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const res = computeLighting(store.scene, env());
        setResult(res);
        setComputing(false);
      }, 120);
    },
    { defer: false }
  ));

  return (
    <div class="app">
      <div class="canvas-wrap">
        <CanvasView />
      </div>
      <SidePanel />
    </div>
  );
}
