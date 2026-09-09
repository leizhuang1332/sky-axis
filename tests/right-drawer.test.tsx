/**
 * RightDrawer 组件测试 —— PR-C / 迭代 4 新增 UI 原语。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染到 HTML 字符串再断言。
 * 不引 @testing-library/react —— 包级轻量化约定。
 *
 * 覆盖目标：
 *   - 基本 props：title / onClose / children / footer / loading 都正确渲染
 *   - role/aria：role=dialog + aria-modal + aria-label 与 title 一致
 *   - loading=true 时关闭按钮 disabled + 显示「处理中…」tag
 *   - ESC 关闭通过 Modal 同源 keydown listener 实现（语义层镜像 Modal.test.tsx，
 *     实际 useEffect 触发留给 E2E；这里只断言「不抛错 + role/aria 正确」）
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RightDrawer } from '../src/client/ui/RightDrawer.tsx'

describe('RightDrawer 基本渲染', () => {
  it('渲染 title + children + 关闭按钮 + role/aria', () => {
    const html = renderToStaticMarkup(
      <RightDrawer title="回退" onClose={vi.fn()}>
        <p>body content</p>
      </RightDrawer>,
    )
    expect(html).toContain('回退')
    expect(html).toContain('body content')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="回退"')
    // 关闭按钮（× 字符）
    expect(html).toContain('×')
  })

  it('footer 提供时渲染，缺省时不渲染', () => {
    const withFooter = renderToStaticMarkup(
      <RightDrawer title="t" onClose={vi.fn()} footer={<button type="button">submit</button>}>
        x
      </RightDrawer>,
    )
    expect(withFooter).toContain('<button')
    expect(withFooter).toContain('submit')

    const noFooter = renderToStaticMarkup(
      <RightDrawer title="t" onClose={vi.fn()}>x</RightDrawer>,
    )
    expect(noFooter.length).toBeLessThan(withFooter.length)
  })

  it('loading=true 时显示「处理中…」tag + 关闭按钮 disabled', () => {
    const html = renderToStaticMarkup(
      <RightDrawer title="t" onClose={vi.fn()} loading>x</RightDrawer>,
    )
    expect(html).toContain('处理中…')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>×<\/button>/)
  })

  it('loading=false 或缺省时不显示「处理中…」tag', () => {
    const a = renderToStaticMarkup(<RightDrawer title="t" onClose={vi.fn()}>x</RightDrawer>)
    const b = renderToStaticMarkup(<RightDrawer title="t" onClose={vi.fn()} loading={false}>x</RightDrawer>)
    expect(a).not.toContain('处理中…')
    expect(b).not.toContain('处理中…')
  })
})

describe('RightDrawer overlay + ESC 守卫（不抛错）', () => {
  it('overlay click + ESC keydown 路径不抛错（镜像 Modal 行为）', () => {
    // RightDrawer 的 useEffect 同步注册 keydown listener + overlay onClick handler。
    // 完整的事件触发留给 E2E；这里只确保服务端渲染无副作用。
    const onClose = vi.fn()
    expect(() => {
      renderToStaticMarkup(
        <RightDrawer title="t" onClose={onClose}>
          <span>x</span>
        </RightDrawer>,
      )
    }).not.toThrow()
    expect(onClose).not.toHaveBeenCalled()
  })
})