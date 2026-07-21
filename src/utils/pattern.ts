function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globToRegExp(glob: string): RegExp {
  const token = '__DOUBLE_STAR__';
  const escaped = escapeRegExp(glob)
    .replace(/\\\*\\\*/g, token)
    .replace(/\\\*/g, '[^/]*')
    .replaceAll(token, '.*');
  return new RegExp(`^${escaped}$`);
}

export function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}
