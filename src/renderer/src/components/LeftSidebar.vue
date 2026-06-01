<!--
  LeftSidebar.vue — 左侧边栏
  标签页切换（模块树 / 角色 Agent）
-->

<script setup lang="ts">
defineProps<{
  activeTab: string
}>()

defineEmits<{
  tabChange: [tabId: string]
}>()

const tabs = [
  { id: 'tree', label: '节点树', icon: '🌳' },
  { id: 'roles', label: '角色 Agent', icon: '👤' },
  { id: 'knowledge', label: '知识', icon: '📚' },
  { id: 'workflow', label: '工作流', icon: '⚡' },
]
</script>

<template>
  <div class="tab-bar">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="tab-btn"
      :class="{ active: activeTab === tab.id }"
      :title="tab.label"
      @click="$emit('tabChange', tab.id)"
    >
      <span class="tab-icon">{{ tab.icon }}</span>
      <span class="tab-label">{{ tab.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  width: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color);
  flex-shrink: 0;
}

.tab-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  color: var(--el-text-color-secondary);
  transition: background 0.15s, color 0.15s;
}

.tab-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.tab-btn.active {
  background: var(--el-color-primary);
  color: #fff;
}

.tab-icon {
  font-size: 16px;
  line-height: 1;
}

.tab-label {
  font-size: 9px;
  line-height: 1;
  white-space: nowrap;
}
</style>
