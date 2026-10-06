// 验证驱动：每个场景一个独立进程，模拟“中断后重新进入页面”。
// localStorage 用文件模拟，FAIL_WRITES=1 时 entries 主键写入抛错（中断），断点日志键不受影响。
import fs from 'node:fs'

const storeFile = process.env.STORE_FILE as string
let data: Record<string, string> = {}
try {
  data = JSON.parse(fs.readFileSync(storeFile, 'utf8')) as Record<string, string>
} catch {
  data = {}
}
const persist = () => fs.writeFileSync(storeFile, JSON.stringify(data))
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      if (process.env.FAIL_WRITES === '1' && k.includes(':entries')) {
        throw new Error('QuotaExceededError: 模拟写入中断')
      }
      data[k] = String(v)
      persist()
    },
    removeItem: (k: string) => {
      delete data[k]
      persist()
    },
  },
}

const {
  getDrill,
  getPendingTx,
  headcountOf,
  implementDrill,
  resumePendingTx,
  rosterOf,
  saveRoster,
  startPrepare,
  submitSummary,
} = await import('@/api/drill-service')
const { listRows, saveRows } = await import('@/data/local-store')

let failures = 0
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`PASS ${label}`)
  } else {
    failures += 1
    console.log(`FAIL ${label} :: ${JSON.stringify(detail)}`)
  }
}

const scenario = process.argv[2]

if (scenario === 's1') {
  const r1 = startPrepare(1)
  check('s1 开始筹备', r1.ok, r1)
  const r2 = saveRoster(1, ['张三', '李四', '王五'])
  check('s1 保存名单', r2.ok, r2)
  const d = getDrill(1)!
  check('s1 名单已落库', rosterOf(d).length === 3, d['参演名单'])
  check('s1 人数按名单计入', d['参演人数'] === 3, d['参演人数'])
  check('s1 状态筹备中', d.status === '筹备中', d.status)
}

if (scenario === 's2') {
  // 新进程 = 中断后重新进入：名单必须还在，不是空名单
  const d = getDrill(1)!
  check('s2 重新进入名单仍在', rosterOf(d).join(',') === '张三,李四,王五', d['参演名单'])
  check('s2 种子名单完整', rosterOf(getDrill(2)!).length === 4)
}

if (scenario === 's3') {
  saveRoster(1, [])
  const r = implementDrill(1)
  check('s3 空名单阻止实施', !r.ok && r.message.includes('参演名单为空'), r)
  check('s3 状态未被推进', getDrill(1)!.status === '筹备中')
  check('s3 人数回到待补录', headcountOf(getDrill(1)!) === null)
  saveRoster(1, ['张三', '李四', '王五'])
}

if (scenario === 's4') {
  // 缺少参演人数：提示待补录，而不是校验失败
  const crafted = { ...getDrill(1)!, 参演人数: '' }
  check('s4 缺人数视为待补录', headcountOf({ ...crafted, 参演名单: [] }) === null)
  check('s4 缺人数可按名单计', headcountOf(crafted) === 3)
  saveRows('drill', listRows('drill').map((row) => (Number(row.id) === 1 ? crafted : row)))
  const r = implementDrill(1)
  check('s4 缺人数不阻塞实施', r.ok, r)
  check('s4 人数按名单补入', getDrill(1)!['参演人数'] === 3, getDrill(1)!['参演人数'])
  check('s4 状态已实施', getDrill(1)!.status === '已实施')
}

if (scenario === 's5') {
  const r = implementDrill(1)
  check('s5 重复实施被拒', !r.ok && r.message.includes('请勿重复提交'), r)
  check('s5 状态仍已实施', getDrill(1)!.status === '已实施')
}

if (scenario === 's6') {
  // FAIL_WRITES=1：提交总结时写入中断
  const r = submitSummary(1, { 演练评价: '优秀', 讲评: '响应迅速', 撤离结果: '全部撤离' })
  check('s6 提交失败已上报', !r.ok, r)
  const d = getDrill(1)!
  check('s6 缓存不留半份讲评', String(d['讲评']) === '', d['讲评'])
  check('s6 状态未被推进', d.status === '已实施', d.status)
  const tx = getPendingTx(1)
  check('s6 断点已记录', tx?.op === 'summarize' && tx.failedStep === '讲评与撤离结果', tx)
}

if (scenario === 's7') {
  // 写入恢复后重新进入：从失败点继续
  const before = getDrill(1)!
  check('s7 中断后无残留', String(before['讲评']) === '' && before.status === '已实施')
  const r = resumePendingTx(1)
  check('s7 断点续办成功', r.ok, r)
  const d = getDrill(1)!
  check('s7 状态已总结', d.status === '已总结')
  check('s7 讲评已写入', d['讲评'] === '响应迅速', d['讲评'])
  check('s7 撤离结果已写入', d['撤离结果'] === '全部撤离')
  check('s7 评价已写入', d['演练评价'] === '优秀')
  check('s7 断点已清除', getPendingTx(1) === null)
}

if (scenario === 's8') {
  const r = submitSummary(1, { 演练评价: '不合格', 讲评: '篡改', 撤离结果: '篡改' })
  check('s8 重复总结被拒', !r.ok && r.message.includes('保留原评价'), r)
  check('s8 原讲评保留', getDrill(1)!['讲评'] === '响应迅速')
  check('s8 原评价保留', getDrill(1)!['演练评价'] === '优秀')
}

if (scenario === 's9') {
  // 历史已总结演练（种子 DRIL-0004）：原评价必须保留
  const r = submitSummary(4, { 演练评价: '不合格', 讲评: '篡改', 撤离结果: '篡改' })
  check('s9 历史总结被拒', !r.ok, r)
  const d = getDrill(4)!
  check('s9 历史评价保留', d['演练评价'] === '良好', d['演练评价'])
  check('s9 历史讲评保留', String(d['讲评']).includes('预警广播'), d['讲评'])
  const r2 = saveRoster(3, ['新人'])
  check('s9 实施后名单锁定', !r2.ok && r2.message.includes('锁定'), r2)
  check('s9 名单未被改动', rosterOf(getDrill(3)!).length === 6)
}

if (failures > 0) {
  process.exit(1)
}
console.log(`scenario ${scenario} done`)
