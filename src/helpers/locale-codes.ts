// ISO 639-1 language codes.
// Stable standard (~184 codes, last major revision 2002). Used to validate
// locale-like path segments instead of a broad regex that would match
// non-locale 2-letter segments like "go", "ai", "my", "io", "up", "do".
const ISO_639_1 = new Set([
  'aa',
  'ab',
  'ae',
  'af',
  'ak',
  'am',
  'an',
  'ar',
  'as',
  'av',
  'ay',
  'az',
  'ba',
  'be',
  'bg',
  'bh',
  'bi',
  'bm',
  'bn',
  'bo',
  'br',
  'bs',
  'ca',
  'ce',
  'ch',
  'co',
  'cr',
  'cs',
  'cu',
  'cv',
  'cy',
  'da',
  'de',
  'dv',
  'dz',
  'ee',
  'el',
  'en',
  'eo',
  'es',
  'et',
  'eu',
  'fa',
  'ff',
  'fi',
  'fj',
  'fo',
  'fr',
  'fy',
  'ga',
  'gd',
  'gl',
  'gn',
  'gu',
  'gv',
  'ha',
  'he',
  'hi',
  'ho',
  'hr',
  'ht',
  'hu',
  'hy',
  'hz',
  'ia',
  'id',
  'ie',
  'ig',
  'ii',
  'ik',
  'io',
  'is',
  'it',
  'iu',
  'ja',
  'jv',
  'ka',
  'kg',
  'ki',
  'kj',
  'kk',
  'kl',
  'km',
  'kn',
  'ko',
  'kr',
  'ks',
  'ku',
  'kv',
  'kw',
  'ky',
  'la',
  'lb',
  'lg',
  'li',
  'ln',
  'lo',
  'lt',
  'lu',
  'lv',
  'mg',
  'mh',
  'mi',
  'mk',
  'ml',
  'mn',
  'mr',
  'ms',
  'mt',
  'my',
  'na',
  'nb',
  'nd',
  'ne',
  'ng',
  'nl',
  'nn',
  'no',
  'nr',
  'nv',
  'ny',
  'oc',
  'oj',
  'om',
  'or',
  'os',
  'pa',
  'pi',
  'pl',
  'ps',
  'pt',
  'qu',
  'rm',
  'rn',
  'ro',
  'ru',
  'rw',
  'sa',
  'sc',
  'sd',
  'se',
  'sg',
  'si',
  'sk',
  'sl',
  'sm',
  'sn',
  'so',
  'sq',
  'sr',
  'ss',
  'st',
  'su',
  'sv',
  'sw',
  'ta',
  'te',
  'tg',
  'th',
  'ti',
  'tk',
  'tl',
  'tn',
  'to',
  'tr',
  'ts',
  'tt',
  'tw',
  'ty',
  'ug',
  'uk',
  'ur',
  'uz',
  've',
  'vi',
  'vo',
  'wa',
  'wo',
  'xh',
  'yi',
  'yo',
  'za',
  'zh',
  'zu',
]);

/**
 * Test whether a path segment is a valid locale code.
 * Accepts ISO 639-1 language codes ("en", "de") and BCP 47 language-region
 * subtags where the language part is a valid ISO 639-1 code ("pt-br", "zh-cn").
 */
export function isLocaleSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  if (ISO_639_1.has(lower)) return true;
  const hyphen = lower.indexOf('-');
  if (hyphen === 2 && lower.length === 5) {
    return ISO_639_1.has(lower.slice(0, 2));
  }
  return false;
}

/**
 * Check whether a single locale code at `position` represents a real locale
 * prefix by testing for structural duplication: if stripping the code from
 * prefixed URLs produces paths that overlap with unprefixed URLs in the set,
 * the code is a locale variant, not a topic segment.
 *
 * Example: `/docs/de/intro` stripped → `/docs/intro` matches the unprefixed
 * URL `/docs/intro` → structural duplication confirmed.
 */
export function hasStructuralDuplication(
  urls: string[],
  position: number,
  localeCode: string,
): boolean {
  const strippedPaths = new Set<string>();
  const unprefixedPaths = new Set<string>();

  for (const url of urls) {
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      if (segments.length > position && segments[position].toLowerCase() === localeCode) {
        const stripped = [...segments.slice(0, position), ...segments.slice(position + 1)].join(
          '/',
        );
        strippedPaths.add(stripped);
      } else if (segments.length > position && !isLocaleSegment(segments[position])) {
        unprefixedPaths.add(segments.join('/'));
      }
    } catch {
      continue;
    }
  }

  if (strippedPaths.size === 0 || unprefixedPaths.size === 0) return false;

  let overlap = 0;
  for (const path of strippedPaths) {
    if (unprefixedPaths.has(path)) overlap++;
  }

  return overlap > strippedPaths.size * 0.5;
}
