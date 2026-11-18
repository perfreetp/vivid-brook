import type { SceneManager } from '../three/SceneManager';
import type { TerrainGrid } from '../math/terrain';

/**
 * 应用级上下文：组件之间不直接相互引用，
 * 通过 context 上的回调与共享服务协作。
 */
export interface AppContext {
  scene: SceneManager | null;
  /** 重新构建地形栅格（导入数据或修改分辨率后调用） */
  rebuildTerrain: () => TerrainGrid | null;
  /** 触发堤线/断面等场景重绘 */
  refreshScene: () => void;
  /** 执行测地线展开 */
  runUnfold: () => void;
}

export const ctx: AppContext = {
  scene: null,
  rebuildTerrain: () => null,
  refreshScene: () => {},
  runUnfold: () => {}
};
