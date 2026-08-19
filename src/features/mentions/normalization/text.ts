
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code, match) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (code < 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

const NON_CONTENT_ELEMENTS = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const BLOCK_LEVEL_TAGS =
  /<\/?(p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|blockquote|figure|figcaption|hr)\b[^>]*>/gi;

export function stripHtml(value: string): string {
  const withoutCode = value.replace(NON_CONTENT_ELEMENTS, ' ');
  const withBoundaries = withoutCode.replace(BLOCK_LEVEL_TAGS, ' ');
  const withoutComments = withBoundaries.replace(/<!--[\s\S]*?-->/g, ' ');
  const withoutTags = withoutComments.replace(/<\/?[a-zA-Z][^>]*>/g, '');
  return collapseWhitespace(decodeHtmlEntities(withoutTags));
}

export function looksLikeHtml(value: string): boolean {
  return /<\/?[a-zA-Z][^>]*>/.test(value) || /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/.test(value);
}

export function normalizeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = looksLikeHtml(value) ? stripHtml(value) : collapseWhitespace(value);
  return text.length > 0 ? text : null;
}
