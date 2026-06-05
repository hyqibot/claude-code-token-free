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

function syncDraftImRuntime(selection: RuntimeSelection | undefined): void {
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

function loadSelections(): Record<string, RuntimeSelection> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, RuntimeSelection>
    const selections = parsed && typeof parsed === 'object' ? parsed : {}
    const draft = selections[DRAFT_RUNTIME_SELECTION_KEY]
    if (draft?.modelId?.trim()) {
      syncDraftImRuntime(draft)
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
      if (key === DRAFT_RUNTIME_SELECTION_KEY) {
        syncDraftImRuntime(selection)
      }
      return { selections }
    }),

  clearSelection: (key) =>
    set((state) => {
      if (!(key in state.selections)) return state
      const { [key]: _removed, ...rest } = state.selections
      persistSelections(rest)
      if (key === DRAFT_RUNTIME_SELECTION_KEY) {
        syncDraftImRuntime(undefined)
      }
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
