// 极简 TS 加载钩子：用已装的 typescript 转译 .ts，并解析 @/ 别名，避免依赖 esbuild 原生二进制。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function resolve(specifier, context, nextResolve) {
  let target = specifier
  if (target.startsWith('@/')) {
    target = path.join(root, 'src', target.slice(2))
  }
  if (target.startsWith('/') || target.startsWith('.')) {
    const base = target.startsWith('/')
      ? target
      : path.resolve(path.dirname(fileURLToPath(context.parentURL)), target)
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
