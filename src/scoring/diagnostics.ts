import type { CheckResult, ReportResult } from '../types.js';
import type { Diagnostic, DiagnosticSeverity } from './types.js';
import { MIN_PAGES_FOR_SCORING } from '../constants.js';

interface DiagnosticDefinition {
  id: string;
  severity: DiagnosticSeverity;
  /** Evaluated in dependency order. Can reference prior diagnostic results. */
  triggers: (
    results: Map<string, CheckResult>,
    triggered: Set<string>,
    report: ReportResult,
  ) => boolean;
  message: (
    results: Map<string, CheckResult>,
    triggered: Set<string>,
    report: ReportResult,
  ) => string;
  resolution: string;
}

// Evaluated in this order (dependency order matters)
const DIAGNOSTIC_DEFINITIONS: DiagnosticDefinition[] = [
  // --- markdown discovery diagnostics must be first (others reference them) ---
  {
    id: 'markdown-undiscoverable',
    severity: 'warning',
    triggers: (results) => {
      const mdSupport = results.get('markdown-url-support');
      if (mdSupport?.status !== 'pass') return false;

      const cn = results.get('content-negotiation');
      const directiveHtml = results.get('llms-txt-directive-html');

      return cn?.status !== 'pass' && directiveHtml?.status !== 'pass';
    },
    message: () =>
      'Your site serves markdown at .md URLs, but agents have no way to ' +
      'discover this. No agent-facing directive points to your llms.txt, ' +
      'and the server does not support content negotiation. Most agents ' +
      'will default to the HTML path and never benefit from your markdown ' +
      'support.',
    resolution:
      'Add a directive near the top of each docs page pointing to your ' +
      'llms.txt, and implement content negotiation for Accept: text/markdown. ' +
      'The directive is the primary discovery mechanism (it reaches all ' +
      'agents); content negotiation provides a fast path for agents that ' +
      'request markdown by default.',
  },

  {
    id: 'markdown-partially-discoverable',
    severity: 'warning',
    triggers: (results) => {
      const mdSupport = results.get('markdown-url-support');
      if (mdSupport?.status !== 'pass') return false;

      const cn = results.get('content-negotiation');
      const directiveHtml = results.get('llms-txt-directive-html');

      return cn?.status === 'pass' && directiveHtml?.status !== 'pass';
    },
    message: () =>
      'Your site serves markdown and supports content negotiation, but ' +
      'has no agent-facing directive on HTML pages pointing to llms.txt. ' +
      'Agents that send Accept: text/markdown (Claude Code, Cursor, ' +
      'OpenCode) get markdown automatically, but the majority of agents ' +
      'fetch HTML by default and have no signal to try the markdown path.',
    resolution:
      'Add a directive near the top of each docs page pointing to your ' +
      'llms.txt. If your site serves markdown, mention that in the ' +
      'directive too. The directive reaches all agents, not just the ones ' +
      'that request markdown by default.',
  },

  {
    id: 'truncated-index',
    severity: 'warning',
    triggers: (results) => {
      const exists = results.get('llms-txt-exists');
      const size = results.get('llms-txt-size');
      return (exists?.status === 'pass' || exists?.status === 'warn') && size?.status === 'fail';
    },
    message: (results) => {
      const sizeResult = results.get('llms-txt-size');
      const d = sizeResult?.details;
      const sizes = (d?.sizes as Array<{ characters?: number }>) ?? [];
      const maxSize = Math.max(...sizes.map((s) => s.characters ?? 0), 0);
      const visiblePct = maxSize > 0 ? Math.round((100_000 / maxSize) * 100) : 0;

      return (
        `Your llms.txt is ${maxSize.toLocaleString()} characters. Agents ` +
        `see roughly the first 100,000 characters (${visiblePct}% of the ` +
        "file). Links, structure, and freshness beyond that point don't " +
        'affect agent experience. Quality checks on the invisible portion ' +
        'are discounted in the score.'
      );
    },
    resolution:
      'Split into a root index linking to section-level llms.txt files, ' +
      "each under 50,000 characters. See the spec's progressive disclosure " +
      'recommendation.',
  },

  {
    id: 'spa-shell-html-invalid',
    severity: 'info',
    triggers: (results) => {
      const rs = results.get('rendering-strategy');
      if (!rs || rs.status === 'pass' || rs.status === 'skip') return false;

      const d = rs.details;
      if (!d) return false;

      const spaShells = (d.spaShells as number) ?? 0;
      const sparseContent = (d.sparseContent as number) ?? 0;
      const total = ((d.serverRendered as number) ?? 0) + sparseContent + spaShells;
      // Trigger when >25% of pages are SPA shells or sparse
      return total > 0 && (spaShells + sparseContent) / total > 0.25;
    },
    message: (results) => {
      const rs = results.get('rendering-strategy');
      const d = rs?.details;
      const spaShells = (d?.spaShells as number) ?? 0;
      const sparseContent = (d?.sparseContent as number) ?? 0;
      const affected = spaShells + sparseContent;
      const total = ((d?.serverRendered as number) ?? 0) + affected;

      const mdSupport = results.get('markdown-url-support');
      const mdNote =
        mdSupport?.status === 'pass'
          ? ' Your markdown path still works for agents that can discover it.'
          : ' Agents currently have no alternative path to content on affected pages.';

      return (
        `${affected} of ${total} sampled pages use client-side rendering. ` +
        'Agents receive an empty shell for these pages instead of ' +
        'documentation content. Page size and content structure scores for ' +
        'the HTML path are discounted because they are partially measuring ' +
        `shells rather than content.${mdNote}`
      );
    },
    resolution:
      'Enable server-side rendering or static generation for affected page ' +
      'types. If only specific page templates use client-side content ' +
      'loading, target those templates rather than rebuilding the entire site.',
  },

  {
    id: 'no-viable-path',
    severity: 'critical',
    triggers: (results, triggered) => {
      const exists = results.get('llms-txt-exists');

      // llms.txt either missing or effectively broken (<10% of links resolve)
      const llmsUsable = (() => {
        if (exists?.status === 'fail') return false;
        if (exists?.status !== 'pass' && exists?.status !== 'warn') return false;
        const linksResolve = results.get('llms-txt-links-resolve');
        if (!linksResolve) return true; // not tested, assume usable
        const resolveRate = linksResolve.details?.resolveRate as number | undefined;
        if (resolveRate !== undefined && resolveRate < 10) return false;
        return true;
      })();

      if (llmsUsable) return false;

      const rs = results.get('rendering-strategy');
      if (rs && rs.status !== 'fail' && rs.status !== 'skip') return false;

      const mdSupport = results.get('markdown-url-support');
      if (mdSupport?.status === 'fail') return true;
      if (
        triggered.has('markdown-undiscoverable') ||
        triggered.has('markdown-partially-discoverable')
      )
        return true;

      return false;
    },
    message: (results) => {
      const exists = results.get('llms-txt-exists');
      const linksResolve = results.get('llms-txt-links-resolve');
      const resolveRate = linksResolve?.details?.resolveRate as number | undefined;

      const llmsReason =
        exists?.status === 'fail'
          ? 'There is no llms.txt for navigation'
          : `The llms.txt exists but only ${resolveRate ?? 0}% of links resolve, making it effectively unusable`;

      return (
        `Agents have no effective way to access your documentation. ${llmsReason}, ` +
        'there is no discoverable markdown path, and the HTML responses either ' +
        "don't contain content or weren't tested. This is the lowest-possible " +
        'agent accessibility state.'
      );
    },
    resolution:
      'The single highest-impact action is creating an llms.txt at your ' +
      'site root with working links. If your site uses client-side rendering, ' +
      'enabling server-side rendering is the second priority.',
  },

  {
    id: 'auth-no-alternative',
    severity: 'critical',
    triggers: (results) => {
      const authGate = results.get('auth-gate-detection');
      const authAlt = results.get('auth-alternative-access');
      return authGate?.status === 'fail' && authAlt?.status === 'fail';
    },
    message: () =>
      'Your documentation requires authentication, and no alternative ' +
      'access paths were detected. Agents that encounter your docs will ' +
      'fall back on training data or seek secondary sources that may be ' +
      'inaccurate.',
    resolution:
      'Consider providing a public llms.txt as a navigational index, ' +
      'ungating API references and integration guides, or shipping docs ' +
      'with your SDK/package. See the spec\'s "Making Private Docs ' +
      'Agent-Accessible" section for options ordered by implementation effort.',
  },

  {
    id: 'page-size-no-markdown-escape',
    severity: 'warning',
    triggers: (results, triggered) => {
      const pageSize = results.get('page-size-html');
      if (pageSize?.status !== 'fail') return false;

      const mdSupport = results.get('markdown-url-support');
      if (mdSupport?.status === 'fail') return true;
      if (
        triggered.has('markdown-undiscoverable') ||
        triggered.has('markdown-partially-discoverable')
      )
        return true;

      return false;
    },
    message: (results) => {
      const d = results.get('page-size-html')?.details;
      const failBucket = (d?.failBucket as number) ?? 0;

      return (
        `${failBucket} pages exceed agent truncation limits on the HTML ` +
        'path, and there is no discoverable markdown path for agents to ' +
        'get smaller representations. Agents will silently receive ' +
        'truncated content on these pages.'
      );
    },
    resolution:
      'Either reduce HTML page sizes (break large pages, reduce inline ' +
      'CSS/JS), or provide markdown versions and ensure agents can discover ' +
      'them via content negotiation or an llms.txt directive.',
  },

  // --- run-level diagnostics (don't depend on other diagnostics) ---

  {
    id: 'single-page-sample',
    severity: 'warning',
    triggers: (_results, _triggered, report) => {
      const isDiscoveryBased =
        report.samplingStrategy === 'random' || report.samplingStrategy === 'deterministic';
      return (
        isDiscoveryBased &&
        report.testedPages !== undefined &&
        report.testedPages < MIN_PAGES_FOR_SCORING
      );
    },
    message: (_results, _triggered, report) => {
      const n = report.testedPages ?? 0;
      const pageWord = n === 1 ? 'page was' : 'pages were';
      return (
        `Only ${n} ${pageWord} discovered and tested (minimum ${MIN_PAGES_FOR_SCORING} ` +
        'needed for reliable scoring). Page-level category scores (page size, ' +
        'content structure, URL stability, etc.) may not represent the site. ' +
        'These categories are marked as N/A in the score.'
      );
    },
    resolution:
      'If your site has an llms.txt, ensure it contains working links so ' +
      'the tool can discover more pages. If testing a preview deployment, ' +
      'use --canonical-origin to rewrite cross-origin llms.txt links. You ' +
      'can also provide specific pages with --urls.',
  },

  {
    id: 'cross-origin-llms-txt',
    severity: 'warning',
    triggers: (results) => {
      const linkResolve = results.get('llms-txt-links-resolve');
      if (!linkResolve || linkResolve.status === 'skip') return false;
      const d = linkResolve.details;
      if (!d) return false;
      const sameOrigin = d.sameOrigin as { total?: number } | undefined;
      const crossOrigin = d.crossOrigin as { total?: number } | undefined;
      return (sameOrigin?.total ?? 0) === 0 && (crossOrigin?.total ?? 0) > 0;
    },
    message: (results) => {
      const d = results.get('llms-txt-links-resolve')?.details;
      const crossOrigin = d?.crossOrigin as { total?: number; dominantOrigin?: string } | undefined;
      const total = crossOrigin?.total ?? 0;
      const dominant = crossOrigin?.dominantOrigin ?? 'an external origin';
      return (
        `All ${total} links in your llms.txt point to ${dominant}, not ` +
        'the origin being tested. This typically happens when testing a ' +
        'preview or staging deployment whose llms.txt still references the ' +
        'production domain. Page discovery falls back to a single page.'
      );
    },
    resolution:
      'Use --canonical-origin <production-origin> to rewrite cross-origin ' +
      'links during testing. For example: --canonical-origin https://docs.example.com',
  },

  {
    id: 'gzipped-sitemap-skipped',
    severity: 'info',
    triggers: (results) => {
      for (const result of results.values()) {
        const warnings = result.details?.discoveryWarnings as string[] | undefined;
        if (warnings?.some((w) => w.includes('gzipped sitemap'))) return true;
      }
      return false;
    },
    message: (results) => {
      const urls: string[] = [];
      for (const result of results.values()) {
        const warnings = result.details?.discoveryWarnings as string[] | undefined;
        if (!warnings) continue;
        for (const w of warnings) {
          if (w.includes('gzipped sitemap')) {
            const match = w.match(/:\s*(.+)$/);
            if (match) urls.push(match[1]);
          }
        }
      }
      const urlNote = urls.length > 0 ? ` (${urls.join(', ')})` : '';
      return (
        `A gzipped sitemap was skipped during URL discovery${urlNote}. ` +
        'If this is the only sitemap source, it may have reduced the number ' +
        'of pages discovered for testing.'
      );
    },
    resolution:
      'Provide an uncompressed sitemap.xml alongside the gzipped version, ' +
      'or supply specific pages via --urls for targeted testing.',
  },

  {
    id: 'rate-limiting-severe',
    severity: 'warning',
    triggers: (results) => {
      let totalTested = 0;
      let totalRateLimited = 0;
      for (const result of results.values()) {
        const d = result.details;
        if (!d) continue;
        const rl = d.rateLimited as number | undefined;
        if (rl === undefined) continue;

        const pageResults = d.pageResults as unknown[] | undefined;
        const testedLinks = d.testedLinks as number | undefined;
        const tested = testedLinks ?? pageResults?.length ?? 0;

        totalTested += tested;
        totalRateLimited += rl;
      }
      return totalTested > 0 && totalRateLimited / totalTested > 0.2;
    },
    message: (results) => {
      let totalTested = 0;
      let totalRateLimited = 0;
      for (const result of results.values()) {
        const d = result.details;
        if (!d) continue;
        const rl = d.rateLimited as number | undefined;
        if (rl === undefined) continue;
        const pageResults = d.pageResults as unknown[] | undefined;
        const testedLinks = d.testedLinks as number | undefined;
        totalTested += testedLinks ?? pageResults?.length ?? 0;
        totalRateLimited += rl;
      }
      const pct = totalTested > 0 ? Math.round((totalRateLimited / totalTested) * 100) : 0;
      return (
        `${pct}% of tested URLs returned HTTP 429 (rate limited). Check ` +
        'results may be unreliable because rate-limited requests are not ' +
        'retried indefinitely.'
      );
    },
    resolution:
      'Increase --request-delay to slow down requests, or contact the site ' +
      'operator to allowlist your IP or user-agent for testing.',
  },
];

/**
 * Evaluate all interaction diagnostics against a set of check results.
 * Returns triggered diagnostics in evaluation order.
 */
export function evaluateDiagnostics(
  results: Map<string, CheckResult>,
  report: ReportResult,
): Diagnostic[] {
  const triggered = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  for (const def of DIAGNOSTIC_DEFINITIONS) {
    if (def.triggers(results, triggered, report)) {
      triggered.add(def.id);
      diagnostics.push({
        id: def.id,
        severity: def.severity,
        message: def.message(results, triggered, report),
        resolution: def.resolution,
      });
    }
  }

  return diagnostics;
}
