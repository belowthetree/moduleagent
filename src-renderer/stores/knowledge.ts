import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { KnowledgeEntry, KnowledgeListItem } from '../types/preload'

export const useKnowledgeStore = defineStore('knowledge', () => {
  // ── 状态 ──
  const entries = ref<KnowledgeListItem[]>([])
  const selectedEntry = ref<KnowledgeListItem | null>(null)
  const selectedContent = ref<string>('')

  // ── 操作 ──
  async function fetchList(): Promise<void> {
    try {
      entries.value = await window.moduleAgent.knowledgeList()
    } catch {
      entries.value = []
    }
  }

  async function read(filename: string): Promise<KnowledgeEntry | null> {
    try {
      return await window.moduleAgent.knowledgeRead(filename)
    } catch {
      return null
    }
  }

  async function selectByFilename(filename: string): Promise<void> {
    const item = entries.value.find(e => e.filename === filename)
    if (!item) return
    selectedEntry.value = item
    const entry = await read(filename)
    selectedContent.value = entry?.content || ''
  }

  async function save(entry: KnowledgeEntry): Promise<boolean> {
    const result = await window.moduleAgent.knowledgeSave(entry)
    if (result.success) {
      await fetchList()
      if (selectedEntry.value?.filename === entry.filename) {
        selectedEntry.value = entries.value.find(e => e.filename === entry.filename) || null
        selectedContent.value = entry.content
      }
    }
    return result.success
  }

  async function create(name: string): Promise<KnowledgeEntry | null> {
    const result = await window.moduleAgent.knowledgeCreate(name)
    if (result && !('error' in result)) {
      await fetchList()
      return result as KnowledgeEntry
    }
    return null
  }

  async function remove(filename: string): Promise<boolean> {
    const result = await window.moduleAgent.knowledgeDelete(filename)
    if (result.success) {
      if (selectedEntry.value?.filename === filename) {
        selectedEntry.value = null
        selectedContent.value = ''
      }
      await fetchList()
    }
    return result.success
  }

  function clearSelection(): void {
    selectedEntry.value = null
    selectedContent.value = ''
  }

  return {
    entries,
    selectedEntry,
    selectedContent,
    fetchList,
    read,
    selectByFilename,
    save,
    create,
    remove,
    clearSelection,
  }
})
