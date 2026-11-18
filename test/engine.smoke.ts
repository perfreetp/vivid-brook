// 引擎冒烟测试: node 直接跑, 不依赖 DOM
import { computeLighting, GRID_W, GRID_H, rasterizeHeights } from '../src/engine/lighting';
import { sunPosition } from '../src/engine/solar';

const scene = {
  buildings: [
    { id: 'b1', name: 'A', floors: 3, polygon: [{ x: 50, y: 50 }, { x: 70, y: 50 }, { x: 70, y: 60 }, { x: 50, y: 60 }] },
  ],
  lights: [
    { id: 'l1', type: 'street', name: 'L1', pos: { x: 100, y: 75 }, height: 6, radius: 18, kelvin: 3000, intensity: 2600, on: true },
  ],
  blocks: [
    { id: 'q1', name: '街坊1', polygon: [{ x: 40, y: 40 }, { x: 160, y: 40 }, { x: 160, y: 120 }, { x: 40, y: 120 }] },
  ],
  annotations: [],
};

// 太阳位置
const s1 = sunPosition('summer', 12, 31.3);
const s2 = sunPosition('winter', 20, 31.3);
console.log('夏至正午高度角(应~82°):', (s1.altitude * 180 / Math.PI).toFixed(1));
console.log('冬至20点高度角(应<0, 夜晚):', (s2.altitude * 180 / Math.PI).toFixed(1));

// 高度图
const hm = rasterizeHeights(scene as any);
console.log('建筑内高度(应9):', hm[55 * GRID_W + 55], ' 建筑外(应0):', hm[10 * GRID_W + 10]);

// 白天
const day = computeLighting(scene as any, { date: 'summer', hour: 12, latitude: 31.3 });
console.log('--- 夏至正午 ---');
console.log('开阔地照度(应>50000):', day.lux[75 * GRID_W + 100].toFixed(0));
console.log('暗区块数(白天应很少):', day.zones.length, ' 暗区面积:', day.darkArea);
console.log('街坊平均照度:', day.blockStats[0].avgLux.toFixed(0), ' 暗区占比:', (day.blockStats[0].darkRatio * 100).toFixed(1) + '%');

// 夜晚
const night = computeLighting(scene as any, { date: 'winter', hour: 20, latitude: 31.3 });
const li = 75 * GRID_W + 100;
console.log('--- 冬至20点(夜晚) ---');
console.log('night 标志(应true):', night.night);
console.log('灯下照度(应>20):', night.lux[li].toFixed(1));
console.log('远处暗格照度(应<20):', night.lux[10 * GRID_W + 10].toFixed(2));
console.log('暗区块数:', night.zones.length, ' 暗区面积:', night.darkArea);
console.log('街坊平均照度:', night.blockStats[0].avgLux.toFixed(1), ' 暗区占比:', (night.blockStats[0].darkRatio * 100).toFixed(1) + '%');

// 遮挡: 建筑正后方(灯在100,75, 建筑50-70x50-60 不在路径上, 换一个测试)
const scene2 = {
  ...scene,
  lights: [{ id: 'l2', type: 'street', name: 'L2', pos: { x: 40, y: 55 }, height: 2, radius: 30, kelvin: 3000, intensity: 2600, on: true }],
};
const occl = computeLighting(scene2 as any, { date: 'winter', hour: 20, latitude: 31.3 });
const behind = 55 * GRID_W + 80; // 建筑(50-70,50-60)东侧, 灯在(40,55)高2m -> 应被9m建筑遮挡
const front = 55 * GRID_W + 45;  // 灯同侧 -> 可见
console.log('--- 遮挡测试(灯高2m, 建筑高9m) ---');
console.log('遮挡侧照度(应接近0.3):', occl.lux[behind].toFixed(2));
console.log('无遮挡侧照度(应明显更大):', occl.lux[front].toFixed(2));
console.log('OK');
