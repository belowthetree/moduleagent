import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { WorkflowListItem, WorkflowDetail, WorkflowStatus, StepEditData } from '../types/preload'

export const useWorkflowStore = defineStore('workflow', () => {
  // ── 状态 ──
  const workflows = ref<WorkflowListItem[]>([])
  const selectedWorkflow = ref<WorkflowDetail | null>(null)
  const executionState = ref<WorkflowStatus | null>(null)

  const selectedSteps = computed(() => selectedWorkflow.value?.steps ?? [])

  // ── 查询 ──
  async function fetchList(): Promise<void> {
    try {
      workflows.value = await window.moduleAgent.workflowList()
    } catch {
      workflows.value = []
    }
  }

  async function loadWorkflow(name: string): Promise<WorkflowDetail | null> {
    try {
      const result = await window.moduleAgent.workflowLoad(name)
      if ('error' in result) return null
      selectedWorkflow.value = result as WorkflowDetail
      return result as WorkflowDetail
    } catch {
      return null
    }
  }

  async function selectWorkflow(name: string): Promise<void> {
    await loadWorkflow(name)
    executionState.value = null
    // Also load status
    try {
      executionState.value = await window.moduleAgent.workflowStatus(name)
    } catch { /* ignore */ }
  }

  // ── CRUD ──
  async function createWorkflow(name: string): Promise<boolean> {
    const result = await window.moduleAgent.workflowCreate(name)
    if (result.success) {
      await fetchList()
    }
    return result.success
  }

  async function deleteWorkflow(name: string): Promise<boolean> {
    const result = await window.moduleAgent.workflowDelete(name)
    if (result.success) {
      if (selectedWorkflow.value?.name === name) {
        selectedWorkflow.value = null
        executionState.value = null
      }
      await fetchList()
    }
    return result.success
  }

  async function saveStep(wfName: string, stepName: string, data: StepEditData): Promise<boolean> {
    // Build STEP.md content as YAML frontmatter + markdown body
    const frontmatter: Record<string, unknown> = { name: data.name }
    if (data.description) frontmatter.description = data.description
    if (data.input) frontmatter.input = data.input
    if (data.acceptance) frontmatter.acceptance = data.acceptance
    if (data.agent) frontmatter.agent = data.agent

    const yaml = Object.entries(frontmatter)
      .map(([key, value]) => {
        if (value === undefined || value === null) return null
        if (typeof value === 'object') {
          return key + ':\n' + Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => {
              if (Array.isArray(v)) {
                return '  ' + k + ':\n' + v.map(item => '    - ' + (typeof item === 'object' ? JSON.stringify(item).replace(/"/g, '') : item)).join('\n')
              }
              return '  ' + k + ': ' + v
            }).join('\n')
        }
        return key + ': ' + value
      })
      .filter(Boolean)
      .join('\n')

    const content = '---\n' + yaml + '\n---\n\n' + (data.body || '')
    const result = await window.moduleAgent.workflowStepSave(wfName, stepName, content)
    if (result.success && selectedWorkflow.value?.name === wfName) {
      await loadWorkflow(wfName)
    }
    return result.success
  }

  async function addStep(wfName: string): Promise<string | null> {
    const result = await window.moduleAgent.workflowStepAdd(wfName)
    if (result.success && result.stepName) {
      if (selectedWorkflow.value?.name === wfName) {
        await loadWorkflow(wfName)
      }
      return result.stepName
    }
    return null
  }

  async function deleteStep(wfName: string, stepName: string): Promise<boolean> {
    const result = await window.moduleAgent.workflowStepDelete(wfName, stepName)
    if (result.success && selectedWorkflow.value?.name === wfName) {
      await loadWorkflow(wfName)
    }
    return result.success
  }

  // ── 执行 ──
  async function executeWorkflow(name: string, userInput?: string): Promise<boolean> {
    const result = await window.moduleAgent.workflowExecute(name, userInput)
    if (result.success) {
      executionState.value = {
        status: 'completed',
        currentStep: result.results?.length ?? 0,
        totalSteps: result.results?.length ?? 0,
        results: result.results ?? [],
      }
    } else {
      executionState.value = await window.moduleAgent.workflowStatus(name)
    }
    return result.success
  }

  async function cancelWorkflow(name: string): Promise<void> {
    await window.moduleAgent.workflowCancel(name)
    executionState.value = await window.moduleAgent.workflowStatus(name)
  }

  async function refreshStatus(name: string): Promise<void> {
    try {
      executionState.value = await window.moduleAgent.workflowStatus(name)
    } catch { /* ignore */ }
  }

  function clearSelection(): void {
    selectedWorkflow.value = null
    executionState.value = null
  }

  return {
    workflows,
    selectedWorkflow,
    executionState,
    selectedSteps,
    fetchList,
    loadWorkflow,
    selectWorkflow,
    createWorkflow,
    deleteWorkflow,
    saveStep,
    addStep,
    deleteStep,
    executeWorkflow,
    cancelWorkflow,
    refreshStatus,
    clearSelection,
  }
})
