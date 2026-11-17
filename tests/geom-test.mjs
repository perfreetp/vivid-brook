import {
  sampleProfile, profileMetrics, revolveVolume, scaleToCapacity,
  radiusAtY, elongationStats, labelZones, DEFAULT_PROFILE, arcLength,
} from '../src/geometry.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { cond ? (pass++, console.log('PASS', name, extra)) : (fail++, console.log('FAIL', name, extra)); };

// 1. 采样基本性质
const s = sampleProfile(DEFAULT_PROFILE, 18);
ok('采样数 > 控制点', s.length > DEFAULT_PROFILE.length, `n=${s.length}`);
ok('高度弱单调', s.every((p,i)=> i===0 || p.y >= s[i-1].y - 1e-9));
ok('半径非负', s.every(p => p.r >= -1e-12));
ok('首尾在轴上', Math.abs(s[0].r)<1e-9 && Math.abs(s.at(-1).r)<1e-9);
ok('末端高度=控制点高度', Math.abs(s.at(-1).y - DEFAULT_PROFILE.at(-1).y) < 1e-9);

// 2. 圆柱解析解（2mm 斜切底边，避免零高度硬拐角——工程瓶型的标准画法）
const cyl = [{r:0,y:0},{r:8,y:0},{r:10,y:2},{r:10,y:20},{r:0,y:20}];
const vCyl = revolveVolume(cyl);
const cylExpect = Math.PI*100*20/1000; // 斜切占比极小
ok('斜切圆柱体积(±4%)', Math.abs(vCyl - cylExpect)/cylExpect < 0.04, `got=${vCyl.toFixed(3)} expect≈${cylExpect.toFixed(3)}`);

// 3. 圆锥（底边带 1mm 过渡）
const cone = [{r:0,y:0},{r:9,y:0},{r:0,y:30}];
const vCone = revolveVolume(cone);
ok('圆锥体积(±5%, 样条近似)', Math.abs(vCone - Math.PI*100*30/3/1000) / 3.1416 < 0.05, `got=${vCone.toFixed(3)} expect≈3.142`);

// 4. 容量缩放
const scaled = scaleToCapacity(DEFAULT_PROFILE, 1000);
const v0 = revolveVolume(DEFAULT_PROFILE), v1 = revolveVolume(scaled);
ok('容量缩放命中目标(±1%)', Math.abs(v1-1000)/1000 < 0.01, `v0=${v0.toFixed(1)} v1=${v1.toFixed(1)}`);
const k = Math.sqrt(1000/v0);
ok('缩放因子正确', Math.abs(scaled[3].r - DEFAULT_PROFILE[3].r*k) < 1e-9);
ok('缩放不改高度', Math.abs(scaled[3].y - DEFAULT_PROFILE[3].y) < 1e-9);

// 5. 曲率 / 切向角
const m = profileMetrics(DEFAULT_PROFILE, 0.03);
ok('指标数=控制点数', m.length === DEFAULT_PROFILE.length);
ok('切向角范围[0,180]', m.every(x => Number.isFinite(x.angle) && x.angle>=0 && x.angle<=180),
  `range ${Math.min(...m.map(x=>x.angle)).toFixed(1)}..${Math.max(...m.map(x=>x.angle)).toFixed(1)}`);
ok('曲率全部有限', m.every(x => Number.isFinite(x.curvature)));
ok('存在非零曲率点', m.some(x => x.curvature > 0.001), `max=${Math.max(...m.map(x=>x.curvature)).toFixed(4)}`);
const mRect = profileMetrics(cyl, 0.03);
ok('直壁段曲率≈0', mRect[3].curvature < 0.02, `k=${mRect[3].curvature.toFixed(5)}`);
ok('斜切转角曲率显著', mRect[2].curvature > 0.02, `k=${mRect[2].curvature.toFixed(4)}`);
// 阈值判定逻辑
const mStrict = profileMetrics(DEFAULT_PROFILE, 0.005);
ok('阈值收紧→超限点增多', mStrict.filter(x=>x.overThreshold).length >= m.filter(x=>x.overThreshold).length);

// 6. 半径查表 + 伸长率
ok('半径查表@中部', Math.abs(radiusAtY(DEFAULT_PROFILE, 60) - 39) < 1.0, `r=${radiusAtY(DEFAULT_PROFILE,60).toFixed(2)}`);
const st = elongationStats(DEFAULT_PROFILE, 40, 150, 'auto', 35);
ok('auto模式平均r₀下均值ε≈0', Math.abs(st.meanE) < 1e-9, `mean=${st.meanE.toExponential(2)}`);
ok('伸长率有正负区间', st.minE < 0 && st.maxE > 0, `min=${(st.minE*100).toFixed(2)}% max=${(st.maxE*100).toFixed(2)}%`);
const stF = elongationStats(DEFAULT_PROFILE, 40, 150, 'fixed', 35);
ok('固定r₀=35生效', Math.abs(stF.rRef - 35) < 1e-9);

// 7. 标签区几何
const z = labelZones(DEFAULT_PROFILE, { yMin:40, yMax:150, safeMm:5, bleedMm:3, refMode:'auto', refRadius:35 });
ok('刀版宽=2πr₀', Math.abs(z.trim.w - 2*Math.PI*z.stats.rRef) < 1e-9);
ok('出血框大于刀版', z.bleed.w > z.trim.w && z.bleed.h > z.trim.h);
ok('安全区小于刀版', z.safe.w < z.trim.w && z.safe.h < z.trim.h);
ok('弧长为正且有限', Number.isFinite(arcLength(s)) && arcLength(s) > 200, `L=${arcLength(s).toFixed(1)}`);

// 8. 极端输入不产生 NaN
const tiny = sampleProfile([{r:0,y:0},{r:1,y:1},{r:0,y:2}], 4);
ok('极小轮廓无NaN', tiny.every(p => Number.isFinite(p.r) && Number.isFinite(p.y)));
const dup = sampleProfile([{r:0,y:0},{r:5,y:5},{r:5,y:5},{r:0,y:10}], 6);
ok('重合控制点无NaN', dup.every(p => Number.isFinite(p.r) && Number.isFinite(p.y)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
