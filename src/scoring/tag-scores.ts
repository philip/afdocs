import type { ReportResult } from '../types.js';
import type { CheckScore, TagCheckBreakdown, TagScore } from './types.js';
import { toGrade } from './score.js';
import { CHECK_WEIGHTS } from './weights.js';

/**
 * Extract the page-results array and a status normalizer for a check.
 *
 * Returns undefined for single-resource checks (no per-page data).
 */
function getPageItems(
  details: Record<string, unknown>,
  checkId: string,
): Array<{ url: string; status: string }> | undefined {
  // Known page-array field names and their status mapping
  const arrayField = PAGE_ARRAY_FIELDS[checkId] ?? 'pageResults';
  const arr = details[arrayField] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(arr) || arr.length === 0) return undefined;

  const statusMapper = STATUS_MAPPERS[checkId] ?? defaultStatusMapper;

  return arr
    .filter((item) => typeof item.url === 'string')
    .map((item) => ({
      url: item.url as string,
      status: statusMapper(item),
    }));
}

function defaultStatusMapper(item: Record<string, unknown>): string {
  if (typeof item.status === 'string') return item.status;
  return 'skip';
}

// Checks that use a non-standard field name for their page array
const PAGE_ARRAY_FIELDS: Record<string, string> = {
  'tabbed-content-serialization': 'tabbedPages',
  'section-header-quality': 'analyses',
  'cache-header-hygiene': 'endpointResults',
};

// Checks that don't store a `status` string directly and need custom mapping
const STATUS_MAPPERS: Record<string, (item: Record<string, unknown>) => string> = {
  'content-negotiation': (item) => {
    switch (item.classification) {
      case 'markdown-with-correct-type':
        return 'pass';
      case 'markdown-with-wrong-type':
        return 'warn';
      case 'html':
        return 'fail';
      default:
        return 'skip';
    }
  },

  'markdown-url-support': (item) => {
    if (item.skipped) return 'skip';
    return item.supported ? 'pass' : 'fail';
  },

  'http-status-codes': (item) => {
    switch (item.classification) {
      case 'correct-error':
        return 'pass';
      case 'soft-404':
        return 'fail';
      default:
        return 'skip';
    }
  },

  'redirect-behavior': (item) => {
    switch (item.classification) {
      case 'no-redirect':
      case 'same-host':
        return 'pass';
      case 'cross-host':
        return 'warn';
      case 'js-redirect':
        return 'fail';
      default:
        return 'skip';
    }
  },

  'auth-gate-detection': (item) => {
    switch (item.classification) {
      case 'accessible':
        return 'pass';
      case 'soft-auth-gate':
        return 'warn';
      case 'auth-required':
      case 'auth-redirect':
        return 'fail';
      default:
        return 'skip';
    }
  },

  'llms-txt-directive': (item) => {
    if (item.error) return 'skip';
    if (!item.found) return 'fail';
    if (typeof item.positionPercent === 'number' && item.positionPercent > 50) return 'warn';
    return 'pass';
  },

  'section-header-quality': (item) => {
    if (item.hasGenericMajority) return 'fail';
    if (item.hasCrossGroupGeneric) return 'warn';
    return 'pass';
  },
};

// Single-resource checks that should be excluded from tag scoring
const SINGLE_RESOURCE_CHECKS = new Set([
  'llms-txt-exists',
  'llms-txt-valid',
  'llms-txt-size',
  'llms-txt-links-resolve',
  'llms-txt-links-markdown',
  'llms-txt-coverage',
]);

/**
 * Compute per-tag aggregate scores from curated page tags.
 *
 * For each tag, walks all per-page check results, filters to the tag's URLs,
 * and computes a weighted aggregate score.
 *
 * Returns undefined when no tags are present.
 */
export function computeTagScores(
  report: ReportResult,
  checkScores: Record<string, CheckScore>,
): Record<string, TagScore> | undefined {
  const urlTags = report.urlTags;
  if (!urlTags || Object.keys(urlTags).length === 0) return undefined;

  // Build tag -> URL set
  const tagUrls = new Map<string, Set<string>>();
  for (const [url, tag] of Object.entries(urlTags)) {
    let urls = tagUrls.get(tag);
    if (!urls) {
      urls = new Set();
      tagUrls.set(tag, urls);
    }
    urls.add(url);
  }

  const tagScores: Record<string, TagScore> = {};

  for (const [tag, urls] of tagUrls) {
    let earned = 0;
    let max = 0;
    const checks: TagCheckBreakdown[] = [];

    for (const result of report.results) {
      if (SINGLE_RESOURCE_CHECKS.has(result.id)) continue;
      if (!result.details) continue;

      const cs = checkScores[result.id];
      if (!cs) continue;

      const items = getPageItems(result.details, result.id);
      if (!items) continue;

      // Filter to this tag's URLs
      const tagItems = items.filter((item) => urls.has(item.url));
      if (tagItems.length === 0) continue;

      let pass = 0;
      let warn = 0;
      let total = 0;

      for (const item of tagItems) {
        if (item.status === 'pass') {
          pass++;
          total++;
        } else if (item.status === 'warn') {
          warn++;
          total++;
        } else if (item.status === 'fail') {
          total++;
        }
        // skip/error excluded from proportion
      }

      if (total === 0) continue;

      const warnCoeff = CHECK_WEIGHTS[result.id]?.warnCoefficient ?? 0.5;
      const proportion = (pass + warn * warnCoeff) / total;
      earned += proportion * cs.effectiveWeight;
      max += cs.effectiveWeight;

      checks.push({
        checkId: result.id,
        category: result.category,
        weight: cs.effectiveWeight,
        proportion,
        pages: tagItems,
      });
    }

    // Skip tags where no per-page checks contributed data.
    // A score of 0 would imply "all checks failed," which is different from
    // "no checks produced results for these URLs."
    if (max === 0) continue;

    const score = Math.round((earned / max) * 100);
    tagScores[tag] = {
      score,
      grade: toGrade(score),
      pageCount: urls.size,
      checks,
    };
  }

  return Object.keys(tagScores).length > 0 ? tagScores : undefined;
}
