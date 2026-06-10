import { create } from 'zustand'
import type { RuntimeSelection } from '../types/runtime'
import { adaptersApi } from '../api/adapters'

const STORAGE_KEY = 'cc-haha-session-runtime'

export const DRAFT_RUNTIME_SELECTION_KEY = '__draft__'

type SessionRuntimeStore = {
  selections: Record<string, RuntimeSelection>
  setSelection: (key: string, selection: RuntimeSelection) => void
  clearSelection: (key: string) => void
  moveSelection: (fromKey: string, toKey: string) => void
}

function syncImRuntimeDefault(selection: RuntimeSelection | undefined): void {
  if (typeof window === 'undefined') return
  const task = selection?.modelId?.trim()
    ? adaptersApi.setImRuntimeDefault({
        providerId: selection.providerId ?? null,
        modelId: selection.modelId.trim(),
      })
    : adaptersApi.clearImRuntimeDefault()
  void task.catch(() => {
    // IM 同步失败不阻塞桌面 UI
  })
}

function pickSelectionForImSync(
  selections: Record<string, RuntimeSelection>,
): RuntimeSelection | undefined {
  const draft = selections[DRAFT_RUNTIME_SELECTION_KEY]
  if (draft?.modelId?.trim()) return draft
  for (const [key, selection] of Object.entries(selections)) {
    if (key !== DRAFT_RUNTIME_SELECTION_KEY && selection?.modelId?.trim()) {
      return selection
    }
  }
  return undefined
}

function loadSelections(): Record<string, RuntimeSelection> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, RuntimeSelection>
    const selections = parsed && typeof parsed === 'object' ? parsed : {}
    const imSelection = pickSelectionForImSync(selections)
    if (imSelection) {
      syncImRuntimeDefault(imSelection)
    }
    return selections
  } catch {
    return {}
  }
}

function persistSelections(selections: Record<string, RuntimeSelection>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selections))
  } catch {
    // noop
  }
}

export const useSessionRuntimeStore = create<SessionRuntimeStore>((set) => ({
  selections: loadSelections(),

  setSelection: (key, selection) =>
    set((state) => {
      const selections = {
        ...state.selections,
        [key]: selection,
      }
      persistSelections(selections)
      if (selection.modelId?.trim()) {
        syncImRuntimeDefault(selection)
      }
      return { selections }
    }),

  clearSelection: (key) =>
    set((state) => {
      if (!(key in state.selections)) return state
      const { [key]: _removed, ...rest } = state.selections
      persistSelections(rest)
      syncImRuntimeDefault(pickSelectionForImSync(rest))
      return { selections: rest }
    }),

  moveSelection: (fromKey, toKey) =>
    set((state) => {
      const selection = state.selections[fromKey]
      if (!selection) return state
      const { [fromKey]: _removed, ...rest } = state.selections
      const selections = {
        ...rest,
        [toKey]: selection,
      }
      persistSelections(selections)
      return { selections }
    }),
}))
