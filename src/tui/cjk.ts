/**
 * East Asian Width — 计算字符串中每个字符的终端列宽。
 *
 * Unicode East Asian Width 属性:
 *   W (Wide) / F (Fullwidth) → 2 列
 *   其余（含 Narrow, Neutral, Halfwidth, Ambiguous） → 1 列
 *
 * CJK 统一汉字、全角标点、日文假名、韩文等均返回 2。
 */

// Unicode ranges that should be treated as wide (2 columns).
// This is a practical subset covering CJK and common fullwidth chars.
const WIDE_RANGES: Array<[number, number]> = [
  // CJK Radicals Supplement
  [0x2e80, 0x2eff],
  // Kangxi Radicals
  [0x2f00, 0x2fdf],
  // Ideographic Description Characters
  [0x2ff0, 0x2fff],
  // CJK Symbols and Punctuation
  [0x3000, 0x303f], // includes fullwidth space (3000), fullwidth punctuation
  // Hiragana
  [0x3040, 0x309f],
  // Katakana
  [0x30a0, 0x30ff],
  // Bopomofo
  [0x3100, 0x312f],
  // Hangul Compatibility Jamo
  [0x3130, 0x318f],
  // Kanbun
  [0x3190, 0x319f],
  // Bopomofo Extended
  [0x31a0, 0x31bf],
  // CJK Strokes
  [0x31c0, 0x31ef],
  // Katakana Phonetic Extensions
  [0x31f0, 0x31ff],
  // Enclosed CJK Letters and Months
  [0x3200, 0x32ff],
  // CJK Compatibility
  [0x3300, 0x33ff],
  // CJK Unified Ideographs Extension A
  [0x3400, 0x4dbf],
  // CJK Unified Ideographs
  [0x4e00, 0x9fff],
  // Yi Syllables
  [0xa000, 0xa4cf],
  // Hangul Syllables
  [0xac00, 0xd7af],
  // CJK Compatibility Ideographs
  [0xf900, 0xfaff],
  // Halfwidth and Fullwidth Forms (fullwidth variants)
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  // CJK Unified Ideographs Extension B–H
  [0x20000, 0x2ffff],
  [0x30000, 0x3ffff],
  // General Punctuation — fullwidth forms
  // CJK Compatibility Forms
  [0xfe30, 0xfe6f],
];

function isWide(codePoint: number): boolean {
  // Narrow fast-path
  if (codePoint < 0x2e80) return false;
  // Binary search over sorted ranges
  let lo = 0;
  let hi = WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const [start, end] = WIDE_RANGES[mid]!;
    if (codePoint < start) {
      hi = mid - 1;
    } else if (codePoint > end) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * 返回字符串在终端中的显示列宽。
 * CJK 字符 = 2 列，ASCII = 1 列，组合标记 = 0 列。
 */
export function cjkDisplayWidth(str: string): number {
  let width = 0;
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i);
    if (cp === undefined) continue;

    // Surrogate pairs — skip the low surrogate
    if (cp >= 0x10000) {
      i++; // skip low surrogate
    }

    // Combining marks & zero-width chars → 0 width
    if (_isZeroWidth(cp)) continue;

    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

/**
 * 返回子串 str.slice(0, endIndex) 的显示宽度。
 * 用于计算光标在指定字符偏移处的视觉列位置。
 */
export function cjkWidthUpTo(str: string, endIndex: number): number {
  return cjkDisplayWidth(str.slice(0, endIndex));
}

// ── Zero-width detection ────────────────────────────────────────

function _isZeroWidth(cp: number): boolean {
  // Combining Diacritical Marks (0300–036F)
  if (cp >= 0x0300 && cp <= 0x036f) return true;
  // Combining Diacritical Marks Extended, etc.
  if (cp >= 0x0483 && cp <= 0x0489) return true;
  if (cp >= 0x0591 && cp <= 0x05bd) return true;
  if (cp >= 0x0610 && cp <= 0x061a) return true;
  // Devanagari, Bengali, etc. combining
  if (cp >= 0x0900 && cp <= 0x097f) return true; // broad filter
  // Thai combining
  if (cp >= 0x0e31 && cp <= 0x0e4e) return true;
  // Zero-width joiner / non-joiner
  if (cp === 0x200d || cp === 0x200c) return true;
  // Variation selectors
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true;
  // Combining Half Marks
  if (cp >= 0xfe20 && cp <= 0xfe2f) return true;
  // General punctuation zero-width: soft hyphen
  if (cp === 0x00ad) return true;
  return false;
}
