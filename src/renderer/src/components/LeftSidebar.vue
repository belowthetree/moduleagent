<!--
  LeftSidebar.vue — 左侧边栏
  52px 图标栏：标签页切换（节点树 / 角色 Agent / 知识 / 工作流）
-->

<script setup lang="ts">
// 图标替换原 emoji（🌳👤📚⚡），label 文案保持不变
import { Files, User, Collection, Lightning } from '@element-plus/icons-vue'

defineProps<{
  activeTab: string
}>()

defineEmits<{
  tabChange: [tabId: string]
}>()

const tabs = [
  { id: 'tree', label: '节点树', icon: Files },
  { id: 'roles', label: '角色 Agent', icon: User },
  { id: 'knowledge', label: '知识', icon: Collection },
  { id: 'workflow', label: '工作流', icon: Lightning },
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
      <el-icon class="tab-icon" :size="16"><component :is="tab.icon" /></el-icon>
      <span class="tab-label">{{ tab.label }}</span>
    </button>
  </div>
</template>

<style scoped>
/* ── 52px 图标栏 ── */
.tab-bar {
  width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--app-space-1);
  padding: var(--app-space-2) 0;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-light);
  flex-shrink: 0;
}

/* 36px 图标按钮：圆角 8px，激活态软底 + 主色图标 */
.tab-btn {
  position: relative;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--app-radius-md);
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  color: var(--el-text-color-secondary);
  transition: background var(--app-transition-fast), color var(--app-transition-fast);
}

.tab-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.tab-btn:active {
  background: var(--el-fill-color-dark);
}

.tab-btn.active {
  background: var(--app-accent-soft);
  color: var(--el-color-primary);
}

/* 左侧 2px 主色指示条（贴图标栏左缘，激活时展开） */
.tab-btn::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 2px;
  height: 16px;
  border-radius: 0 2px 2px 0;
  background: var(--el-color-primary);
  transition: transform var(--app-transition-fast);
}

.tab-btn.active::before {
  transform: translateY(-50%) scaleY(1);
}

.tab-icon {
  line-height: 1;
}

.tab-label {
  font-size: 9px;
  line-height: 1;
  white-space: nowrap;
}
</style>
