import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SVGTree from '../SVGTree.vue'
import type { TreeNode, AgentStatus } from '../../../../types/preload'

function tn(name: string, children: TreeNode[] = []): TreeNode {
  return { name, path: `/path/${name}`, description: `Description for ${name}`, children }
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

function mockBoundingRect(el: HTMLElement, rect?: Partial<DOMRect>) {
  const defaults: DOMRect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) }
  el.getBoundingClientRect = () => ({ ...defaults, ...rect }) as DOMRect
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

  it('click node emits select event with correct TreeNode', async () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    const rects = wrapper.findAll('.node-rect')
    await rects[1]!.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect((wrapper.emitted('select') as TreeNode[][])[0]![0]).toEqual(tree.children[0])
  })

  it('collapse/expand toggle hides and shows children', async () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    expect(wrapper.findAll('.node-rect')).toHaveLength(5)

    const buttons = wrapper.findAll('.expand-btn')
    expect(buttons).toHaveLength(2)

    await buttons[1]!.trigger('click')
    await nextTick()
    expect(wrapper.findAll('.node-rect')).toHaveLength(3)

    const buttonsAfterCollapse = wrapper.findAll('.expand-btn')
    expect(buttonsAfterCollapse).toHaveLength(2)
    await buttonsAfterCollapse[1]!.trigger('click')
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
    expect(dots[0]!.classes()).toContain('dot-streaming')
    expect(dots[1]!.classes()).toContain('dot-idle')
    expect(dots[2]!.classes()).toContain('dot-error')

    expect(wrapper.find('.node-rect.agent-streaming').exists()).toBe(true)
    expect(wrapper.find('.node-rect.agent-idle').exists()).toBe(true)
    expect(wrapper.find('.node-rect.agent-error').exists()).toBe(true)
  })

  it('pan updates transform on middle-mouse drag and stops on mouseup', async () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    const svgEl = wrapper.find('.tree-svg').element as SVGElement
    const panelEl = wrapper.find('.tree-panel').element as HTMLElement
    mockBoundingRect(panelEl)

    await wrapper.find('.tree-panel').trigger('mousedown', { button: 1, clientX: 100, clientY: 100 })
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 160, clientY: 140 }))
    await nextTick()
    expect(svgEl.style.transform).toContain('translate(80px, 60px)')

    window.dispatchEvent(new MouseEvent('mouseup'))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }))
    await nextTick()
    expect(svgEl.style.transform).toContain('translate(80px, 60px)')
  })

  it('zoom: wheel changes scale within 0.3-2.5 bounds', async () => {
    const tree = buildTwoLevelTree()
    const wrapper = mountComponent({ root: tree })
    const panelEl = wrapper.find('.tree-panel').element as HTMLElement
    mockBoundingRect(panelEl)

    await wrapper.find('.tree-panel').trigger('wheel', { deltaY: -100, clientX: 400, clientY: 300 })
    await nextTick()
    expect(wrapper.find('.tree-svg').element.style.transform).toContain('scale(1.1)')

    await wrapper.find('.tree-panel').trigger('wheel', { deltaY: 100, clientX: 400, clientY: 300 })
    await nextTick()
    expect(wrapper.find('.tree-svg').element.style.transform).toContain('scale(0.99)')

    for (let i = 0; i < 15; i++) {
      await wrapper.find('.tree-panel').trigger('wheel', { deltaY: 100, clientX: 400, clientY: 300 })
      await nextTick()
    }
    expect(wrapper.find('.tree-svg').element.style.transform).toContain('scale(0.3)')
  })
})
