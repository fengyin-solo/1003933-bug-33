// 串联各场景：每个场景独立进程运行，共享同一个文件版 localStorage。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const storeFile = path.join(here, '.store.json')
const loader = path.join(here, 'ts-loader.mjs')
const driver = path.join(here, 'driver.ts')

fs.rmSync(storeFile, { force: true })

const steps = [
  ['s1', {}],
  ['s2', {}],
  ['s3', {}],
  ['s4', {}],
  ['s5', {}],
  ['s6', { FAIL_WRITES: '1' }],
  ['s7', {}],
  ['s8', {}],
  ['s9', {}],
]

let failed = false
for (const [scenario, extra] of steps) {
  try {
    const out = execFileSync('node', ['--no-warnings', '--loader', loader, driver, scenario], {
      cwd: here,
      env: { ...process.env, STORE_FILE: storeFile, ...extra },
      encoding: 'utf8',
    })
    process.stdout.write(out)
  } catch (error) {
    failed = true
    process.stdout.write(String(error.stdout ?? ''))
    process.stderr.write(String(error.stderr ?? error))
  }
}

fs.rmSync(storeFile, { force: true })

if (failed) {
  console.error('SCENARIOS FAILED')
  process.exit(1)
}
console.log('ALL SCENARIOS PASSED')
