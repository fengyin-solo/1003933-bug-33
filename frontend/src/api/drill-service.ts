import { listRows, saveRows } from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import type { ActionResult, DrillSummaryPayload, EntryRow, PendingTx } from '@/data/types'

// 应急演练专用服务：名单、讲评、撤离结果都存在演练记录本体上，
// 状态流转与业务负载走同一条原子写入路径，页面读取也只看这条路径。
const KEY = 'drill'
const meta = MODULE_BY_KEY.get(KEY)
if (!meta) {
  throw new Error('没有登记名为 drill 的业务模块')
}

const TX_KEY = 'geohazard-monitor-prevention:drill-pending-tx'

// 提交中的演练 id：重复点击/重复提交只放行第一个动作。
const inFlight = new Set<number>()

const OP_LABELS: Record<PendingTx['op'], string> = {
  prepare: '开始筹备',
  roster: '保存参演名单',
  implement: '实施演练',
  summarize: '提交总结',
}

export function opLabel(op: PendingTx['op']): string {
  return OP_LABELS[op]
}

// ---------- 中断续办日志 ----------

function readTxMap(): Record<string, PendingTx> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  try {
    return JSON.parse(window.localStorage.getItem(TX_KEY) ?? '{}') as Record<string, PendingTx>
  } catch {
    return {}
  }
}

function writeTxMap(map: Record<string, PendingTx>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    window.localStorage.setItem(TX_KEY, JSON.stringify(map))
  } catch {
    // 日志写不进去不阻塞主流程，主流程的失败信息已经返回给页面。
  }
}

export function getPendingTx(drillId: number): PendingTx | null {
  return readTxMap()[String(drillId)] ?? null
}

export function listPendingTx(): PendingTx[] {
  return Object.values(readTxMap())
}

function recordTx(tx: PendingTx): void {
  const map = readTxMap()
  map[String(tx.drillId)] = tx
  writeTxMap(map)
}

export function dismissPendingTx(drillId: number): void {
  const map = readTxMap()
  delete map[String(drillId)]
  writeTxMap(map)
}

// ---------- 读取：名单、人数、讲评都从记录本体取 ----------

export function getDrill(id: number): EntryRow | null {
  return listRows(KEY).find((row) => Number(row.id) === id) ?? null
}

export function rosterOf(drill: EntryRow): string[] {
  const raw = drill['参演名单']
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((name) => String(name).trim()).filter((name) => name !== '')
}

/** 参演人数：优先取记录值，缺省时按名单人数计，都没有返回 null（页面显示「待补录」）。 */
export function headcountOf(drill: EntryRow): number | null {
  const raw = drill['参演人数']
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) {
    return Number(raw)
  }
  const roster = rosterOf(drill)
  return roster.length > 0 ? roster.length : null
}

// ---------- 原子事务：校验 → 改一条记录 → 一次落库 ----------

type MutateResult = { ok: true; row: EntryRow; message: string } | { ok: false; message: string }

function transact(
  drillId: number,
  op: PendingTx['op'],
  failedStep: string,
  payload: PendingTx['payload'],
  mutate: (row: EntryRow) => MutateResult,
): ActionResult {
  if (inFlight.has(drillId)) {
    return { ok: false, message: '操作正在提交中，请勿重复提交' }
  }
  inFlight.add(drillId)
  try {
    const rows = listRows(KEY)
    const index = rows.findIndex((row) => Number(row.id) === drillId)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${drillId} 的演练记录` }
    }
    const result = mutate(rows[index])
    if (!result.ok) {
      return result
    }
    const next = [...rows]
    next[index] = result.row
    // saveRows 先落库再提交缓存，抛异常时记录本体不变，不会留下半份数据。
    saveRows(KEY, next)
    dismissPendingTx(drillId)
    return { ok: true, message: result.message }
  } catch (error) {
    const drill = listRows(KEY).find((row) => Number(row.id) === drillId)
    recordTx({
      op,
      drillId,
      drillCode: String(drill?.['演练编号'] ?? drillId),
      payload,
      failedStep,
      at: new Date().toISOString(),
    })
    const reason = error instanceof Error ? error.message : '未知原因'
    return {
      ok: false,
      message: `「${OP_LABELS[op]}」在写入「${failedStep}」时中断（${reason}），已记录断点，重新进入后可从失败点继续`,
    }
  } finally {
    inFlight.delete(drillId)
  }
}

// ---------- 业务动作 ----------

export function startPrepare(drillId: number): ActionResult {
  return transact(drillId, 'prepare', '演练状态', null, (row) => {
    const status = String(row.status)
    if (status === '筹备中') {
      return { ok: false, message: '演练已在筹备中，请勿重复提交' }
    }
    if (status !== '待筹备') {
      return { ok: false, message: `当前状态「${status}」不能开始筹备` }
    }
    return {
      ok: true,
      row: { ...row, status: '筹备中', 演练状态: '筹备中', pending: true },
      message: '演练已开始筹备，可录入参演名单',
    }
  })
}

export function saveRoster(drillId: number, names: string[]): ActionResult {
  const cleaned = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))]
  return transact(drillId, 'roster', '参演名单', cleaned, (row) => {
    const status = String(row.status)
    if (status === '已实施' || status === '已总结' || status === '已归档') {
      return { ok: false, message: '演练已实施，参演名单已锁定，不能再修改' }
    }
    // 名单是人数的唯一来源：非空按名单计入；清空名单则人数回到「待补录」。
    return {
      ok: true,
      row: { ...row, 参演名单: cleaned, 参演人数: cleaned.length > 0 ? cleaned.length : '' },
      message: cleaned.length > 0 ? `参演名单已保存，共 ${cleaned.length} 人` : '参演名单已清空，参演人数待补录',
    }
  })
}

export function implementDrill(drillId: number): ActionResult {
  return transact(drillId, 'implement', '演练状态', null, (row) => {
    const status = String(row.status)
    if (status === '已实施') {
      return { ok: false, message: '演练已实施，请勿重复提交' }
    }
    if (status === '已总结' || status === '已归档') {
      return { ok: false, message: `演练已${status === '已总结' ? '总结' : '归档'}，不能再实施` }
    }
    const roster = rosterOf(row)
    if (roster.length === 0) {
      return { ok: false, message: '参演名单为空，不能实施演练，请先在详情页补录名单' }
    }
    // 缺参演人数不视为校验失败：按名单人数计入，页面仍提示「待补录」由人工确认。
    const headcount = headcountOf(row) ?? roster.length
    return {
      ok: true,
      row: { ...row, status: '已实施', 演练状态: '已实施', 参演人数: headcount, pending: true },
      message: `演练已实施，参演 ${headcount} 人`,
    }
  })
}

export function submitSummary(drillId: number, payload: DrillSummaryPayload): ActionResult {
  return transact(drillId, 'summarize', '讲评与撤离结果', payload, (row) => {
    const status = String(row.status)
    // 历史已总结演练：原评价、讲评、撤离结果一律保留，重复提交不生效。
    if (status === '已总结' || status === '已归档') {
      return { ok: false, message: '演练已总结，保留原评价，请勿重复提交' }
    }
    if (status !== '已实施') {
      return { ok: false, message: '演练尚未实施，不能提交总结' }
    }
    if (payload.讲评.trim() === '') {
      return { ok: false, message: '讲评不能为空' }
    }
    if (payload.撤离结果.trim() === '') {
      return { ok: false, message: '撤离结果不能为空' }
    }
    // 评价、讲评、撤离结果、状态一次写入：要么全成，要么全不成，不会留下半份讲评。
    return {
      ok: true,
      row: {
        ...row,
        status: '已总结',
        演练状态: '已总结',
        演练评价: payload.演练评价 || String(row['演练评价'] ?? '') || '合格',
        讲评: payload.讲评.trim(),
        撤离结果: payload.撤离结果.trim(),
        pending: false,
      },
      message: '演练总结已提交',
    }
  })
}

/** 从失败点继续：按断点记录重放原操作，各动作自带状态校验，重复执行安全。 */
export function resumePendingTx(drillId: number): ActionResult {
  const tx = getPendingTx(drillId)
  if (!tx) {
    return { ok: false, message: '没有待续办的中断操作' }
  }
  switch (tx.op) {
    case 'prepare':
      return startPrepare(drillId)
    case 'roster':
      return saveRoster(drillId, (tx.payload as string[] | null) ?? [])
    case 'implement':
      return implementDrill(drillId)
    case 'summarize':
      return submitSummary(drillId, tx.payload as DrillSummaryPayload)
  }
}
