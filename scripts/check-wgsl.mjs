import { readFileSync } from 'node:fs'
import { WgslReflect } from '../node_modules/wgsl_reflect/wgsl_reflect.module.js'

const src = readFileSync(new URL('../src/lib/webgpu/renderer.js', import.meta.url), 'utf8')
const m = src.match(/const WGSL = \/\* wgsl \*\/`([\s\S]*?)`/)
if (!m) { console.error('WGSL block not found'); process.exit(1) }
try {
  const r = new WgslReflect(m[1])
  console.log('WGSL OK | vertex:', r.entry.vertex.map(e => e.name).join(','),
    '| fragment:', r.entry.fragment.map(e => e.name).join(','),
    '| uniforms:', r.uniforms.length, '| storage:', r.storage.length)
} catch (e) {
  console.error('WGSL parse FAILED:', e.message)
  process.exit(1)
}
