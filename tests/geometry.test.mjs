import {
  findSelfIntersections, offsetOpenPath, bufferOpenPath, runBoolean,
  snapPoint, polylineLength, polygonArea, reversePoints, GRID_SIZE,
} from '../src/lib/geometry.ts';
import { makeFeature, defaultLayers } from '../src/lib/factory.ts';

const layers = defaultLayers();
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : (fail++, console.log('FAIL:', name)); };

const bow = [{x:0,y:0},{x:100,y:100},{x:100,y:0},{x:0,y:100}];
ok('self-intersection detected', findSelfIntersections(bow).length === 1);
ok('simple quad no self-intersection', findSelfIntersections([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]).length === 0);

const line = [{x:0,y:0},{x:100,y:0}];
const off = offsetOpenPath(line, 5);
ok('offset left distance', Math.abs(off.left[0].y - 5) < 1e-9 && Math.abs(off.left[0].x) < 1e-9);
ok('offset right distance', Math.abs(off.right[0].y + 5) < 1e-9);
ok('offset keeps vertex count', off.left.length === 2 && off.right.length === 2);

const buf = bufferOpenPath(line, 5);
ok('buffer produces ring', buf.length === 4 && buf[0].y === 5 && buf[2].y === -5);

const mk = (pts, w=0) => { const f = makeFeature('pool', layers[2].id, pts); f.width = w; return f; };
const r1 = mk([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]);
const r2 = mk([{x:50,y:50},{x:150,y:50},{x:150,y:150},{x:50,y:150}]);
const u = runBoolean('union', [r1, r2]);
ok('union one polygon', u.polygons.length === 1);
ok('union area ~17500', Math.abs(polygonArea(u.polygons[0][0]) - 17500) < 1);
const inter = runBoolean('intersection', [r1, r2]);
ok('intersection area 2500', Math.abs(polygonArea(inter.polygons[0][0]) - 2500) < 1);
const diff = runBoolean('difference', [r1, r2]);
ok('difference keeps hole or split', diff.polygons.length >= 1);
const diffArea = diff.polygons.reduce((s, poly) => s + polygonArea(poly[0]) - poly.slice(1).reduce((a,h)=>a+polygonArea(h),0), 0);
ok('difference area 7500', Math.abs(diffArea - 7500) < 1);

const c1 = makeFeature('intake', layers[0].id, [{x:0,y:0},{x:100,y:0}]); c1.width = 10;
const c2 = makeFeature('intake', layers[0].id, [{x:50,y:-20},{x:50,y:20}]); c2.width = 10;
const cu = runBoolean('union', [c1, c2]);
ok('open path boolean union works', cu.polygons.length >= 1);

const vt = { scale: 2, ox: 0, oy: 0, width: 800, height: 600 };
// (4,4) 世界 → 屏幕对角线 11.3px，在 12px 阈值内 → 吸附 (0,0)
const s0 = snapPoint({x: 4, y: 4}, [], null, vt);
ok('grid snap within 12px', s0 && s0.type === 'grid' && s0.point.x === 0 && s0.point.y === 0);
// (9,9) → 18px 超阈值 → 不吸附
ok('grid snap outside threshold null', snapPoint({x: 9, y: 9}, [], null, vt) === null);

const f1 = makeFeature('drain', layers[1].id, [{x: 50, y: 50}, {x: 80, y: 80}]);
const s2 = snapPoint({x: 50.8, y: 50.5}, [f1], null, vt);
ok('endpoint snap priority over alignment', s2 && s2.type === 'endpoint' && s2.point.x === 50 && s2.point.y === 50);
const s3 = snapPoint({x: 65, y: 65}, [f1], null, vt);
ok('midpoint snap', s3 && s3.type === 'midpoint');
// 纯水平对齐（远离端点 10m，屏幕 20px 不触发端点，但 y 差 1m=2px 触发对齐）
const s4 = snapPoint({x: 30, y: 50.8}, [f1], null, vt);
ok('horizontal alignment snap', s4 && s4.type === 'horizontal' && s4.point.y === 50 && s4.point.x === 30);

ok('polyline length', Math.abs(polylineLength([{x:0,y:0},{x:30,y:0},{x:30,y:40}], false) - 70) < 1e-9);
ok('square area', polygonArea([{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]) === 100);
const rev = reversePoints([{x:1,y:1},{x:2,y:2},{x:3,y:3}]);
ok('reverse order', rev[0].x === 3 && rev[2].x === 1);
ok('grid size 20m', GRID_SIZE === 20);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
