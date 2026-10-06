import { commitRow, listRows } from '@/data/local-store'
import { filterRows, moduleMeta } from './local-service'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

/**
 * 应急演练专用工作流服务。
 *
 * 根因说明：旧版把「演练状态」和「参与人员名单 / 讲评撤离结果」拆在不同的写入里，
 * 筹备中断后名单那次写入没落盘，状态却已经进入「筹备中」；页面又把「名单字段不存在
 * 或为空数组」一律当成「还没开始筹备、可以直接实施」，于是重新进入只看到空名单、
 * 讲评撤离结果丢失、空态还被误判为可实施。名单丢失和空态误判是同一个根因：
 * 状态与名单不在同一条记录、同一次写入里，读取侧又缺了「已筹备但名单为空」这一档。
 *
 * 修复约束：
 * 1. 状态、participants、review 全部挂在同一条演练行上，任何流转都走 commitRow
 *    单事务落盘，写入失败整份回滚，不会留下半份讲评；
 * 2. 中断恢复直接读取事务里最后一次成功落盘的行，从失败的那个动作继续；
 * 3. 实施前显式区分「名单为空（禁止实施）」和「参演人数待补录（不拦，只标注待补录）」；
 * 4. 已总结/已归档是终态，总结只读，历史评价不被覆盖；
 * 5. 同一动作并发/重复提交只允许一个生效（inFlight 去重 + 状态机校验双保险）。
 */

export const DRILL_KEY = 'drill'

export const DRILL_STATUS = {
  pending: '待筹备',
  preparing: '筹备中',
  implemented: '已实施',
  summarized: '已总结',
  archived: '已归档',
} as const

const FLOW_STATUSES = [
  DRILL_STATUS.pending,
  DRILL_STATUS.preparing,
  DRILL_STATUS.implemented,
  DRILL_STATUS.summarized,
  DRILL_STATUS.archived,
]
const TERMINAL_STATUSES: string[] = [DRILL_STATUS.summarized, DRILL_STATUS.archived]

export type DrillParticipant = {
  name: string
  role: string
  unit: string
  phone: string
}

export type DrillReview = {
  /** 讲评内容（实施时填写，总结时原样保留，总结只补总体评价） */
  comment: string
  /** 撤离结果 */
  evacuationResult: string
  /** 撤离人数：允许为空，表示待补录，不作为校验失败 */
  evacuatedCount: number | null
  /** 总体评价：提交总结时写入 */
  drillRating: string
  /** 总结补充说明 */
  summaryComment: string
  implementedAt: string
  summarizedAt: string
}

export type DrillRow = EntryRow & {
  participants: DrillParticipant[]
  review: DrillReview | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读取侧归一：旧数据缺 participants/review 时补成明确的空值，杜绝 undefined 被当成「没筹备过」。 */
export function normalizeDrill(row: EntryRow): DrillRow {
  const participants: DrillParticipant[] = Array.isArray(row.participants)
    ? (row.participants as unknown[]).filter(isRecord).map((item) => ({
        name: String(item.name ?? '').trim(),
        role: String(item.role ?? '').trim(),
        unit: String(item.unit ?? '').trim(),
        phone: String(item.phone ?? '').trim(),
      }))
    : []
  const reviewSource = isRecord(row.review) ? row.review : null
  const review: DrillReview | null = reviewSource
    ? {
        comment: String(reviewSource.comment ?? ''),
        evacuationResult: String(reviewSource.evacuationResult ?? ''),
        evacuatedCount:
          reviewSource.evacuatedCount === null || reviewSource.evacuatedCount === ''
            ? null
            : Number(reviewSource.evacuatedCount) || 0,
        drillRating: String(reviewSource.drillRating ?? ''),
        summaryComment: String(reviewSource.summaryComment ?? ''),
        implementedAt: String(reviewSource.implementedAt ?? ''),
        summarizedAt: String(reviewSource.summarizedAt ?? ''),
      }
    : null
  return { ...row, participants, review }
}

function pendingFlag(status: string): boolean {
  return !TERMINAL_STATUSES.includes(status)
}

export function getDrill(id: number): DrillRow | null {
  const row = listRows(DRILL_KEY).find((item) => Number(item.id) === Number(id))
  return row ? normalizeDrill(row) : null
}

export function listDrills(filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(DRILL_KEY), filters).map(normalizeDrill) as EntryRow[]
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 计划参演人数：空串/未登记视为待补录（null），不是非法值。 */
export function plannedCount(row: DrillRow): number | null {
  const raw = row['参演人数']
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return null
  }
  const count = Number(raw)
  return Number.isFinite(count) && count > 0 ? count : null
}

/** 名单是否为空：唯一允许拦截实施的硬条件。 */
export function isRosterEmpty(row: DrillRow): boolean {
  return row.participants.filter((person) => person.name !== '').length === 0
}

/** 实施前检查：空名单阻止实施；参演人数缺失只提示待补录，不构成校验失败。 */
export function checkImplementable(row: DrillRow): { ok: boolean; reason: string } {
  if (row.status !== DRILL_STATUS.preparing) {
    return { ok: false, reason: `当前状态为「${row.status}」，只有筹备中的演练可以实施` }
  }
  if (isRosterEmpty(row)) {
    return { ok: false, reason: '参与人员名单为空，无法实施演练，请先补录参演人员名单' }
  }
  return { ok: true, reason: plannedCount(row) === null ? '参演人数待补录（不影响实施，实施后请尽快补录）' : '' }
}

/** 同一条记录同一动作只允许一个请求落盘，防止重复提交。 */
const inFlight = new Set<string>()

function runOnce(id: number, action: string, task: () => ActionResult): ActionResult {
  const token = `${id}:${action}`
  if (inFlight.has(token)) {
    return { ok: false, message: '上一次提交尚未完成，请勿重复操作' }
  }
  inFlight.add(token)
  try {
    return task()
  } catch (error) {
    return { ok: false, message: `${error instanceof Error ? error.message : '操作失败'}，事务已回滚，可从失败的这一步继续` }
  } finally {
    inFlight.delete(token)
  }
}

function requireStatus(row: EntryRow, allowed: string[], label: string): ActionResult | null {
  if (!allowed.includes(String(row.status))) {
    return {
      ok: false,
      message: `${label}要求演练处于「${allowed.join(' / ')}」，当前为「${row.status}」`,
    }
  }
  return null
}

export function beginPreparation(id: number): ActionResult {
  return runOnce(id, '开始筹备', () => {
    commitRow(DRILL_KEY, id, (row) => {
      const rejected = requireStatus(row, [DRILL_STATUS.pending], '开始筹备')
      if (rejected) {
        throw new Error(rejected.message)
      }
      return {
        ...row,
        status: DRILL_STATUS.preparing,
        pending: pendingFlag(DRILL_STATUS.preparing),
        演练状态: DRILL_STATUS.preparing,
      }
    })
    return { ok: true, message: '已进入筹备阶段，可登记参与人员名单' }
  })
}

/**
 * 保存名单（含计划参演人数）：状态与名单同事务落盘。
 * 待筹备状态下保存名单直接进入筹备中，中断后重进读到的就是最后一次成功保存的名单。
 */
export function saveRoster(
  id: number,
  participants: DrillParticipant[],
  plannedHeadcount: number | null,
): ActionResult {
  return runOnce(id, '保存名单', () => {
    const cleaned = participants.map((person) => ({
      name: person.name.trim(),
      role: person.role.trim(),
      unit: person.unit.trim(),
      phone: person.phone.trim(),
    }))
    commitRow(DRILL_KEY, id, (row) => {
      const rejected = requireStatus(
        row,
        [DRILL_STATUS.pending, DRILL_STATUS.preparing],
        '登记名单',
      )
      if (rejected) {
        throw new Error(rejected.message)
      }
      return {
        ...row,
        status: DRILL_STATUS.preparing,
        pending: pendingFlag(DRILL_STATUS.preparing),
        participants: cleaned,
        '参演人数': plannedHeadcount === null ? '' : plannedHeadcount,
        演练状态: DRILL_STATUS.preparing,
      }
    })
    return {
      ok: true,
      message:
        cleaned.filter((person) => person.name !== '').length === 0
          ? '名单已暂存（当前为空），空名单不能实施演练'
          : `名单已保存，共 ${cleaned.filter((person) => person.name !== '').length} 名参演人员`,
    }
  })
}

export type ImplementInput = {
  evacuationResult: string
  evacuatedCount: number | null
  comment: string
}

/**
 * 实施演练：空名单硬拦截；通过后把状态、撤离结果、讲评放进同一条行记录一次写入。
 * 写入失败整行回滚——状态仍停在筹备中、不会留下没有状态支撑的半份讲评，
 * 重新进入可从事务失败点（实施这一步）继续。
 */
export function implementDrill(id: number, input: ImplementInput): ActionResult {
  return runOnce(id, '实施演练', () => {
    const current = getDrill(id)
    if (!current) {
      return { ok: false, message: `没有找到编号为 ${id} 的演练记录` }
    }
    const check = checkImplementable(current)
    if (!check.ok) {
      return { ok: false, message: check.reason }
    }
    commitRow(DRILL_KEY, id, (row) => {
      const rejected = requireStatus(row, [DRILL_STATUS.preparing], '实施演练')
      if (rejected) {
        throw new Error(rejected.message)
      }
      const review: DrillReview = {
        comment: input.comment.trim(),
        evacuationResult: input.evacuationResult.trim(),
        evacuatedCount: input.evacuatedCount,
        drillRating: '',
        summaryComment: '',
        implementedAt: new Date().toISOString(),
        summarizedAt: '',
      }
      return {
        ...row,
        status: DRILL_STATUS.implemented,
        pending: pendingFlag(DRILL_STATUS.implemented),
        review,
      }
    })
    return {
      ok: true,
      message:
        plannedCount(current) === null
          ? '演练已实施，讲评与撤离结果已保存；参演人数仍待补录'
          : '演练已实施，讲评与撤离结果已保存',
    }
  })
}

export type SummaryInput = {
  drillRating: string
  summaryComment: string
}

/**
 * 提交总结：只有已实施可以提交，已总结/已归档是终态，重复提交直接拒绝，
 * 历史讲评、撤离结果和原评价一律保留，总结只补总体评价。
 */
export function submitSummary(id: number, input: SummaryInput): ActionResult {
  return runOnce(id, '提交总结', () => {
    const current = getDrill(id)
    if (!current) {
      return { ok: false, message: `没有找到编号为 ${id} 的演练记录` }
    }
    if (TERMINAL_STATUSES.includes(current.status)) {
      return { ok: false, message: '该演练已总结，历史评价与总结已归档保留，不能重复提交' }
    }
    if (current.status !== DRILL_STATUS.implemented) {
      return { ok: false, message: `当前状态为「${current.status}」，演练实施后才能提交总结` }
    }
    if (input.drillRating.trim() === '') {
      return { ok: false, message: '请填写演练总体评价后再提交总结' }
    }
    commitRow(DRILL_KEY, id, (row) => {
      const rejected = requireStatus(row, [DRILL_STATUS.implemented], '提交总结')
      if (rejected) {
        throw new Error(rejected.message)
      }
      if (!isRecord(row.review)) {
        // 状态机上不该出现：没有讲评却已实施。宁可不写，也不补造半份讲评。
        throw new Error('缺少实施阶段的讲评与撤离结果，不能提交总结')
      }
      const previous = normalizeDrill(row).review as DrillReview
      const review: DrillReview = {
        ...previous,
        drillRating: input.drillRating.trim(),
        summaryComment: input.summaryComment.trim(),
        summarizedAt: new Date().toISOString(),
      }
      return {
        ...row,
        status: DRILL_STATUS.summarized,
        pending: pendingFlag(DRILL_STATUS.summarized),
        abnormal: false,
        review,
        '演练评价': review.drillRating,
        演练状态: DRILL_STATUS.summarized,
      }
    })
    return { ok: true, message: '总结已提交，讲评、撤离结果与评价已完整归档' }
  })
}

/** 中断恢复提示：筹备中重进时告诉用户从事务失败点继续。 */
export function resumeHint(row: DrillRow): string {
  if (row.status === DRILL_STATUS.preparing) {
    if (isRosterEmpty(row)) {
      return '上次筹备在名单保存前中断，当前名单为空：请先补录名单，空名单不能实施演练。'
    }
    const countPart = plannedCount(row) === null ? '计划参演人数待补录；' : ''
    return `已恢复到上次筹备进度：名单已保存 ${row.participants.length} 名参演人员，${countPart}可继续补充或直接实施。`
  }
  if (row.status === DRILL_STATUS.implemented) {
    return '演练已实施，讲评与撤离结果已保存；如上次总结提交失败，可从下方继续提交总结。'
  }
  return ''
}

export function drillMeta() {
  return moduleMeta(DRILL_KEY)
}

export const DRILL_FLOW_STATUSES = FLOW_STATUSES
