# Issues

## Bug: `__tuiRenderer` global never set (renderer leak on `/quit`)

- **File**: `src/tui/renderer.tsx` + `src/tui/commands.ts`
- **Severity**: Low (minor leak, Ctrl+C exit works fine)
- **Description**: `commands.ts:129` accesses `(globalThis as any).__tuiRenderer` to call `renderer.destroy()` during `/quit` exit. However, `renderer.tsx` stores the renderer as a local variable only — `(globalThis as any).__tuiRenderer` is never assigned. Result: `/quit` leaks the renderer (orphaned, never destroyed).
- **Fix**: Add `(globalThis as any).__tuiRenderer = renderer` after `const renderer = await createCliRenderer({...})` in `renderer.tsx:11`.
