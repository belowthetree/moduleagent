<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAgentStore } from '../stores/agent'
import { useConfigStore } from '../stores/config'
import RoleConfigDialog from './RoleConfigDialog.vue'

const agentStore = useAgentStore()
const configStore = useConfigStore()

const emit = defineEmits<{
  select: [roleName: string]
}>()

const showConfigDialog = ref(false)
const editingRole = ref<import('../../../types/preload').RoleConfigData | null>(null)

onMounted(() => {
  agentStore.fetchRoles()
  agentStore.ensureRoleStatusListener()
})

function openAddDialog(): void {
  editingRole.value = {
    name: '',
    description: '',
    visibleModulePaths: [],
    agents: {
      default: {
        command: configStore.agentCmd || 'opencode',
        args: configStore.agentArgs ? [configStore.agentArgs] : ['acp'],
      },
    },
  }
  showConfigDialog.value = true
}

function openEditDialog(role: import('../../../types/preload').RoleConfigData): void {
  editingRole.value = { ...role }
  showConfigDialog.value = true
}

async function onSaveRole(role: import('../../../types/preload').RoleConfigData): Promise<void> {
  await agentStore.saveRole(role)
  showConfigDialog.value = false
  editingRole.value = null
}

async function onDeleteRole(name: string): Promise<void> {
  await agentStore.deleteRole(name)
}

function selectRole(name: string): void {
  emit('select', name)
}
</script>

<template>
  <div class="role-panel">
    <div class="role-list-header">
      <span class="role-list-title">角色 Agent</span>
      <button class="btn-add" @click="openAddDialog">+ 添加</button>
    </div>

    <div class="role-cards">
      <div
        v-for="role in agentStore.roles"
        :key="role.name"
        class="role-card"
        :class="{ active: agentStore.selectedRoleAgent === role.name }"
        @click="selectRole(role.name)"
      >
        <div class="role-card-header">
          <span class="role-card-name">{{ role.name }}</span>
          <div class="role-card-actions">
            <button class="btn-card-edit" @click.stop="openEditDialog(role)">✎</button>
            <button class="btn-card-delete" @click.stop="onDeleteRole(role.name)">✕</button>
          </div>
        </div>
        <div class="role-card-desc">{{ role.description || '无描述' }}</div>
        <div class="role-card-paths">
          {{ role.visibleModulePaths.length > 0 ? role.visibleModulePaths.join(', ') : '全部模块可见' }}
        </div>
        <div v-if="role.knowledgeRefs?.length" class="role-card-knowledge">
          知识: {{ role.knowledgeRefs.map(k => k.name).join(', ') }}
        </div>
      </div>

      <div v-if="agentStore.roles.length === 0" class="role-empty">
        <p>暂无角色 Agent</p>
        <p class="role-empty-hint">点击"添加"创建新的角色 Agent</p>
      </div>
    </div>

    <!-- 配置对话框 -->
    <RoleConfigDialog
      v-if="showConfigDialog && editingRole"
      :visible="showConfigDialog"
      :role="editingRole"
      @close="showConfigDialog = false; editingRole = null"
      @save="onSaveRole"
    />
  </div>
</template>

<style scoped>
.role-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.role-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.role-list-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.btn-add {
  padding: 4px 12px;
  border: 1px solid var(--el-color-primary);
  border-radius: 6px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-add:hover {
  opacity: 0.85;
}

.role-cards {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-card {
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.role-card:hover {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.role-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.role-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.role-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.role-card-actions {
  display: flex;
  gap: 4px;
}

.btn-card-edit, .btn-card-delete {
  width: 24px;
  height: 24px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-card-edit:hover {
  color: var(--el-color-primary);
  border-color: var(--el-color-primary);
}

.btn-card-delete:hover {
  color: var(--el-color-danger);
  border-color: var(--el-color-danger);
}

.role-card-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.role-card-paths {
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}

.role-card-knowledge {
  font-size: 10px;
  color: var(--el-color-primary);
  margin-top: 2px;
}

.role-empty {
  text-align: center;
  padding: 40px 0;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.role-empty-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-top: 4px;
}
</style>
