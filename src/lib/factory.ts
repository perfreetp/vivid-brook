import type { Feature, FeatureKind, Layer, Pt } from '../types';
import { uid } from './geometry';

export const KIND_META: Record<FeatureKind, { label: string; color: string; fill: string; pathType: 'open' | 'closed' }> = {
  intake: { label: '纳潮渠', color: '#2f7fd1', fill: 'rgba(47,127,209,0.14)', pathType: 'open' },
  drain: { label: '排淡沟', color: '#16a37a', fill: 'rgba(22,163,122,0.14)', pathType: 'open' },
  pool: { label: '卤水池', color: '#d98a2b', fill: 'rgba(217,138,43,0.16)', pathType: 'closed' },
};

export function makeLayer(name: string, color: string): Layer {
  return { id: uid('layer'), name, color, visible: true, locked: false };
}

export function makeFeature(kind: FeatureKind, layerId: string, points: Pt[] = []): Feature {
  const meta = KIND_META[kind];
  const seq = Math.floor(Math.random() * 900 + 100);
  return {
    id: uid('feat'),
    name: `${meta.label}-${seq}`,
    kind,
    pathType: meta.pathType,
    role: 'main',
    points,
    holes: [],
    layerId,
    width: kind === 'pool' ? 0 : kind === 'intake' ? 12 : 6,
    slope: 1.5,
    depth: kind === 'pool' ? 1.8 : 2.5,
    note: '',
    visible: true,
    locked: false,
  };
}

export function defaultLayers(): Layer[] {
  return [
    makeLayer('纳潮渠层', KIND_META.intake.color),
    makeLayer('排淡沟层', KIND_META.drain.color),
    makeLayer('卤水池层', KIND_META.pool.color),
  ];
}

/** 生成演示数据，便于首次打开即可体验全部功能 */
export function demoFeatures(layers: Layer[]): Feature[] {
  const [l1, l2, l3] = layers;
  const intake = makeFeature('intake', l1.id, [
    { x: -180, y: 120 },
    { x: -60, y: 100 },
    { x: 40, y: 60 },
    { x: 120, y: 20 },
  ]);
  intake.width = 16;
  intake.slope = 1.5;
  intake.name = '纳潮渠-主渠';

  const drain = makeFeature('drain', l2.id, [
    { x: -160, y: -140 },
    { x: -40, y: -90 },
    { x: 60, y: -110 },
    { x: 170, y: -60 },
  ]);
  drain.width = 8;
  drain.name = '排淡沟-北线';

  const pool = makeFeature('pool', l3.id, [
    { x: -80, y: -40 },
    { x: 60, y: -40 },
    { x: 80, y: 40 },
    { x: -60, y: 60 },
  ]);
  pool.width = 4;
  pool.depth = 2.0;
  pool.name = '卤水池-一号';

  const pool2 = makeFeature('pool', l3.id, [
    { x: 120, y: -160 },
    { x: 240, y: -150 },
    { x: 250, y: -60 },
    { x: 130, y: -70 },
  ]);
  pool2.name = '卤水池-二号';
  pool2.depth = 1.6;

  return [intake, drain, pool, pool2];
}
