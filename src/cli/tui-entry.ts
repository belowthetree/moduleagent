// TUI 入口点 — 必须使用 Bun 运行
// 在 @opentui/core 加载前设置 — wcwidth 修正 CJK 光标位置
process.env.OPENTUI_FORCE_WCWIDTH = 'true';

async function main() {
  const args = process.argv.slice(2);
  
  // 解析 --project 标志
  let projectRoot = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      projectRoot = args[++i]!;
    }
  }

  if (!projectRoot) {
    // 优先使用上次保存的项目根目录，回退向上搜索
    const { getLastProjectRoot, resolveProjectRoot } = await import('../tui/config.js');
    projectRoot = await getLastProjectRoot() || resolveProjectRoot();
  }

  try {
    const { startTui } = await import('../tui/renderer.js');
    await startTui(projectRoot);
  } catch (err) {
    console.error('TUI failed to start:', (err as Error).message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', (err as Error).message);
  process.exit(1);
});
