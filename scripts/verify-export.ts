// 临时导出格式验证（由 verify 流程调用，可保留作为工具）
import { exportObj, exportHeightmapRaw, exportHeightmapPng8 } from '../src/terrain/exporter';
import { VERTS } from '../src/terrain/config';
import { writeFileSync } from 'node:fs';

const h = new Float64Array(VERTS * VERTS);
for (let i = 0; i < h.length; i++) h[i] = Math.sin(i * 0.01) * 1.2;

const obj = await exportObj(h);
const objText = await obj.text();
const vCount = (objText.match(/^v /gm) || []).length;
const fCount = (objText.match(/^f /gm) || []).length;
console.log('OBJ 顶点数:', vCount, '(期望', VERTS * VERTS, ')');
console.log('OBJ 三角面数:', fCount, '(期望', (VERTS - 1) ** 2 * 2, ')');
console.log('OBJ 首顶点:', objText.split('\n')[1]);
writeFileSync('test-output.obj', objText);

const { raw, meta } = exportHeightmapRaw(h);
const rawBuf = Buffer.from(await raw.arrayBuffer());
console.log('RAW 字节数:', rawBuf.length, '(期望', VERTS * VERTS * 2, ')');
console.log('RAW 元数据:', (await meta.text()).replace(/\s+/g, ' ').slice(0, 130));

const png = exportHeightmapPng8(h);
const pngBuf = Buffer.from(await png.arrayBuffer());
console.log('PNG 魔数:', pngBuf.subarray(0, 8).toString('hex'), '(PNG 应为 89504e470d0a1a0a)');
console.log('PNG IHDR 宽高:', pngBuf.readUInt32BE(16), 'x', pngBuf.readUInt32BE(20), `(期望 ${VERTS}x${VERTS})`);
console.log('PNG 字节数:', pngBuf.length);

const ok =
  vCount === VERTS * VERTS &&
  fCount === (VERTS - 1) ** 2 * 2 &&
  rawBuf.length === VERTS * VERTS * 2 &&
  pngBuf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' &&
  pngBuf.readUInt32BE(16) === VERTS;
console.log(ok ? '\n导出格式验证通过 ✅' : '\n导出格式验证失败 ❌');
process.exit(ok ? 0 : 1);
