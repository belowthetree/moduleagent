// ---------------------------------------------------------------------------
// main/handlers/fileNameSanitize.ts — 渲染层输入文件名清洗
//
// IPC handler 在 path.join 前必须清洗渲染层传入的名称：
// - 路径分隔符与 Windows 非法字符（<>:"/\|?*）替换为 '_'
// - 清洗后为 '' / '.' / '..' 直接抛错拒绝，防止 '../' 路径穿越逃出目标目录
//   （抛出的 Error 由 handler 现有 try/catch 捕获并按失败返回）
// ---------------------------------------------------------------------------

/** 清洗文件名/目录名；输入会导致目录逃逸时抛错拒绝 */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '_');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error(`非法文件名: ${name}`);
  }
  return cleaned;
}
