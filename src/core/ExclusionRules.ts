export const BUILTIN_EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  'coverage',
  '.turbo',
];

export const BUILTIN_EXCLUDED_FILES = [
  '.DS_Store',
  'Thumbs.db',
  '.env',
  '.env.local',
];

export function isBuiltinExcluded(name: string): boolean {
  return BUILTIN_EXCLUDED_DIRS.includes(name) || BUILTIN_EXCLUDED_FILES.includes(name);
}
