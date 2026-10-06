import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// v2：应急演练把状态、参与人员名单、讲评撤离结果放在同一行同一次写入里，
// 老版本分行/分键写入的半成品数据不再沿用，直接回到示例数据重新走流程。
const STORAGE_KEY = 'geohazard-monitor-prevention:entries:v2'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/**
 * 整模块整体落盘：先构造好完整的新数据再写 localStorage，写成功才切换内存缓存。
 * localStorage 单次 setItem 要么完整成功要么抛错，失败时缓存保持原状，
 * 不会出现「状态已改、名单没存」这类跨字段的半份数据。
 */
function persist(next: Record<string, EntryRow[]>): void {
  const snapshot = cache
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  cache = next
  // 极端情况下（存储被清空/隐私模式）setItem 未抛错但内容没落住：回滚缓存，调用方按失败处理。
  if (
    typeof window !== 'undefined' &&
    window.localStorage &&
    window.localStorage.getItem(STORAGE_KEY) !== JSON.stringify(next)
  ) {
    cache = snapshot
    throw new Error('数据写入后校验失败，已回滚')
  }
}

export function saveRows(key: string, rows: EntryRow[]): void {
  persist({ ...allRows(), [key]: rows })
}

/**
 * 单条记录的事务式更新：读取当前行交给 updater 产出新行，
 * 整模块一起落盘，落盘失败抛出异常且缓存不动。
 * updater 里抛错同样不会留下任何已写入内容。
 */
export function commitRow(
  key: string,
  id: number,
  updater: (row: EntryRow) => EntryRow,
): { row: EntryRow; index: number } {
  const rows = listRows(key).map((row) => clone(row))
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    throw new Error(`没有找到编号为 ${id} 的记录`)
  }
  rows[index] = updater(rows[index])
  persist({ ...allRows(), [key]: rows })
  return { row: rows[index], index }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
