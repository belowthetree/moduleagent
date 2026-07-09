// ---------------------------------------------------------------------------
// renderer/src/components/__tests__/SVGTree.test.ts — SVGTree 组件单元测试
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SVGTree from '../SVGTree.vue'
import type { TreeNode, AgentStatus, LayoutNode } from '../../../../types/shared'

function tn(name: string, children: TreeNode[] = []): TreeNode {
  return { name, path: `/path/${name}`, description: `Description for ${name}`, children, cwd: '/test' }
}

function buildTwoLevelTree(): TreeNode {
  return tn('root', [
    tn('child1', [tn('grandchild1'), tn('grandchild2')]),
    tn('child2'),
  ])
}

function mountComponent(overrides: {
  root?: TreeNode | null
  selectedNode?: TreeNode | null
  runningAgents?: Map<string, AgentStatus>
} = {}) {
  return mount(SVGTree, {
    props: {
      root: overrides.root ?? null,
      selectedNode: overrides.selectedNode ?? null,
      runningAgents: overrides.runningAgents ?? new Map(),
    },
  })
}

function getLayoutNode(wrapper: ReturnType<typeof mount>, name: string): LayoutNode | undefined {
  const vm = wrapper.vm as any
  return vm.visibleNodes?.find((n: LayoutNode) => n.data.name === name)
}

describe('SVGTree', () => {
  it('empty tree: root=null → no crash', () => {
    const mountFn = () => mountComponent({ root: null })
    expect(mountFn).not.toThrow()
    const wrapper = mountFn()
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('renders correct number of rect and path elements', () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    expect(wrapper.findAll('.node-rect')).toHaveLength(5)
    expect(wrapper.findAll('.edge-line')).toHaveLength(4)
  })

  it('click node emits select event with correct TreeNode', () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    const child1Node = getLayoutNode(wrapper, 'child1')!
    const vm = wrapper.vm as any
    vm.onNodeClick(child1Node)
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect((wrapper.emitted('select') as TreeNode[][])[0]![0]).toEqual(tree.children[0])
  })

  it('collapse/expand toggle hides and shows children', async () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    expect(wrapper.findAll('.node-rect')).toHaveLength(5)

    const child1Node = getLayoutNode(wrapper, 'child1')!
    expect(child1Node.data.children.length).toBeGreaterThan(0)

    const vm = wrapper.vm as any
    vm.onCollapseClick(child1Node)
    await nextTick()
    expect(wrapper.findAll('.node-rect')).toHaveLength(3)

    vm.onCollapseClick(child1Node)
    await nextTick()
    expect(wrapper.findAll('.node-rect')).toHaveLength(5)
  })

  it('selectedNode matches → .active class applied', () => {
    const tree = buildTwoLevelTree()
    const child1 = tree.children[0]!
    const wrapper = mountComponent({ root: tree, selectedNode: child1 })
    expect(wrapper.findAll('.node-rect.active')).toHaveLength(1)
  })

  it('agent status dots: correct dot classes and rect agent-* classes', () => {
    const tree = buildTwoLevelTree()
    const agents = new Map<string, AgentStatus>()
    agents.set('child1', 'streaming')
    agents.set('child2', 'idle')
    agents.set('grandchild2', 'error')
    const wrapper = mountComponent({ root: tree, runningAgents: agents })

    const dots = wrapper.findAll('.node-status-dot')
    expect(dots).toHaveLength(3)

    // Check that all expected dot classes exist (order-independent)
    const allClasses = dots.map(d => d.classes().join(' ')).join('|')
    expect(allClasses).toContain('dot-streaming')
    expect(allClasses).toContain('dot-idle')
    expect(allClasses).toContain('dot-error')

    expect(wrapper.find('.node-rect.agent-streaming').exists()).toBe(true)
    expect(wrapper.find('.node-rect.agent-idle').exists()).toBe(true)
    expect(wrapper.find('.node-rect.agent-error').exists()).toBe(true)
  })

  it('pan updates transform on middle-mouse drag and stops on mouseup', async () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    const svgEl = wrapper.find('.tree-svg').element as SVGElement

    const vm = wrapper.vm as any
    // Simulate mousedown with button 1 (middle button)
    vm.onMouseDown({ button: 1, clientX: 100, clientY: 100, preventDefault: () => {} } as MouseEvent)
    vm.onMouseMove({ clientX: 160, clientY: 140 } as MouseEvent)
    await nextTick()
    expect(svgEl.style.transform).toContain('translate(80px, 60px)')

    vm.onMouseUp()
    vm.onMouseMove({ clientX: 200, clientY: 200 } as MouseEvent)
    await nextTick()
    expect(svgEl.style.transform).toContain('translate(80px, 60px)')
  })

  it('zoom: wheel changes scale within 0.3-2.5 bounds', async () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    const panelEl = wrapper.find('.tree-panel').element as HTMLElement
    const rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 } as DOMRect
    panelEl.getBoundingClientRect = () => rect

    await wrapper.find('.tree-panel').trigger('wheel', { deltaY: -100, clientX: 400, clientY: 300 })
    await nextTick()
    expect(wrapper.find('.tree-svg').element.style.transform).toMatch(/scale\(1\.1\d*\)/)

    await wrapper.find('.tree-panel').trigger('wheel', { deltaY: 100, clientX: 400, clientY: 300 })
    await nextTick()
    expect(wrapper.find('.tree-svg').element.style.transform).toMatch(/scale\(0\.99\d*\)/)

    for (let i = 0; i < 15; i++) {
      await wrapper.find('.tree-panel').trigger('wheel', { deltaY: 100, clientX: 400, clientY: 300 })
      await nextTick()
    }
    expect(wrapper.find('.tree-svg').element.style.transform).toMatch(/scale\(0\.3\d*\)/)
  })
})
