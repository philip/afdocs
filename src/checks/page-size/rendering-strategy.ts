import { registerCheck } from '../registry.js';
import { discoverAndSamplePages } from '../../helpers/get-page-urls.js';
import { fetchPage } from '../../helpers/fetch-page.js';
import { analyzeRendering, type RenderingAnalysis } from '../../helpers/detect-rendering.js';
import type { CheckContext, CheckResult, CheckStatus } from '../../types.js';

interface PageRenderingResult {
  url: string;
  status: CheckStatus;
  analysis: RenderingAnalysis;
  error?: string;
}

function pageStatus(analysis: RenderingAnalysis): CheckStatus {
  if (!analysis.hasSpaMarkers) return 'pass';
  if (analysis.hasContent) return 'pass';

  // SPA markers present but sparse content — borderline
  if (
    analysis.contentHeadings >= 1 ||
    analysis.contentParagraphs >= 2 ||
    analysis.codeBlocks >= 1
  ) {
    return 'warn';
  }

  return 'fail';
}

function worstStatus(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('warn')) return 'warn';
  return 'pass';
}

async function check(ctx: CheckContext): Promise<CheckResult> {
  const id = 'rendering-strategy';
  const category = 'page-size';

  const {
    urls: pageUrls,
    totalPages,
    sampled: wasSampled,
    warnings,
  } = await discoverAndSamplePages(ctx);

  const results: PageRenderingResult[] = [];
  const concurrency = ctx.options.maxConcurrency;

  for (let i = 0; i < pageUrls.length; i += concurrency) {
    const batch = pageUrls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url): Promise<PageRenderingResult> => {
        try {
          const page = await fetchPage(ctx, url);

          // Only analyze HTML responses — markdown responses are inherently accessible
          if (!page.isHtml) {
            return {
              url,
              status: 'pass',
              analysis: {
                hasContent: true,
                hasSpaMarkers: false,
                spaMarker: null,
                contentHeadings: 0,
                contentParagraphs: 0,
                codeBlocks: 0,
                hasMainContent: false,
                visibleTextLength: page.body.length,
                htmlLength: 0,
              },
            };
          }

          const analysis = analyzeRendering(page.body);
          return { url, status: pageStatus(analysis), analysis };
        } catch (err) {
          return {
            url,
            status: 'fail',
            analysis: {
              hasContent: false,
              hasSpaMarkers: false,
              spaMarker: null,
              contentHeadings: 0,
              contentParagraphs: 0,
              codeBlocks: 0,
              hasMainContent: false,
              visibleTextLength: 0,
              htmlLength: 0,
            },
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    results.push(...batchResults);
  }

  const successful = results.filter((r) => !r.error);
  const fetchErrors = results.filter((r) => r.error).length;

  if (successful.length === 0) {
    const suffix = fetchErrors > 0 ? `; ${fetchErrors} failed to fetch` : '';
    return {
      id,
      category,
      status: 'fail',
      message: `Could not fetch any pages to analyze${suffix}`,
      details: {
        totalPages,
        testedPages: results.length,
        sampled: wasSampled,
        fetchErrors,
        pageResults: results,
        discoveryWarnings: warnings,
      },
    };
  }

  const spaShells = successful.filter((r) => r.status === 'fail');
  const sparse = successful.filter((r) => r.status === 'warn');
  const ok = successful.filter((r) => r.status === 'pass');
  const overallStatus = worstStatus(successful.map((r) => r.status));
  const pageLabel = wasSampled ? 'sampled pages' : 'pages';

  // Identify the framework from the first failing page for the message
  const firstShell = spaShells[0];
  const frameworkHint = firstShell?.analysis.spaMarker
    ? ` (${firstShell.analysis.spaMarker.replace('id="', '').replace('"', '')} detected)`
    : '';

  let message: string;
  if (overallStatus === 'pass') {
    message = `All ${successful.length} ${pageLabel} contain server-rendered content`;
  } else if (spaShells.length > 0) {
    message =
      `${spaShells.length} of ${successful.length} ${pageLabel} appear to be ` +
      `client-side rendered SPA shells${frameworkHint}; ` +
      `agents using HTTP fetches will see no content`;
    if (sparse.length > 0) {
      message += `; ${sparse.length} more have page structure but little substantive content`;
    }
  } else {
    message =
      `${sparse.length} of ${successful.length} ${pageLabel} have server-rendered ` +
      `page structure but little substantive content; agents will see headings ` +
      `and navigation but not the page's actual documentation`;
  }

  if (fetchErrors > 0) {
    message += `; ${fetchErrors} failed to fetch`;
  }

  return {
    id,
    category,
    status: overallStatus,
    message,
    details: {
      totalPages,
      testedPages: results.length,
      sampled: wasSampled,
      serverRendered: ok.length,
      sparseContent: sparse.length,
      spaShells: spaShells.length,
      fetchErrors,
      pageResults: results,
      discoveryWarnings: warnings,
    },
  };
}

registerCheck({
  id: 'rendering-strategy',
  category: 'page-size',
  description:
    'Whether pages contain server-rendered content or are client-side rendered SPA shells',
  dependsOn: [],
  run: check,
});
