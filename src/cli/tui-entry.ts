// TUI entry point — must be run with Bun
// Set BEFORE @opentui/core loads — wcwidth corrects CJK cursor position
process.env.OPENTUI_FORCE_WCWIDTH = 'true';

async function main() {
  const args = process.argv.slice(2);
  
  // Parse --project flag
  let projectRoot = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1]) {
      projectRoot = args[++i]!;
    }
  }

  if (!projectRoot) {
    // Prefer the last saved project root, fall back to upward search
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
