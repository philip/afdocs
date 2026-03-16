import { parse } from 'node-html-parser';

const SPA_MARKERS = ['id="___gatsby"', 'id="__next"', 'id="__nuxt"', 'id="root"'];

export interface RenderingAnalysis {
  /** Whether the page appears to be server-rendered with real content. */
  hasContent: boolean;
  /** Whether known SPA framework markers were found. */
  hasSpaMarkers: boolean;
  /** Which SPA marker was found, if any. */
  spaMarker: string | null;
  /** Number of content headings found (excluding nav-only headings). */
  contentHeadings: number;
  /** Number of paragraphs with substantial prose (>30 chars). */
  contentParagraphs: number;
  /** Number of code blocks found. */
  codeBlocks: number;
  /** Whether a <main> or [role="main"] element with children exists. */
  hasMainContent: boolean;
  /** Visible text length after stripping script/style/noscript. */
  visibleTextLength: number;
  /** Total HTML length. */
  htmlLength: number;
}

/**
 * Analyze whether an HTML page contains server-rendered content or is
 * a client-side-rendered SPA shell.
 *
 * Unlike a simple text-ratio heuristic, this checks for concrete content
 * signals: headings, paragraphs with prose, code blocks, and main content
 * regions. SSR sites with heavy bundled assets (low text ratio but real
 * content) will pass; true SPA shells (framework marker + no content) will fail.
 */
export function analyzeRendering(html: string): RenderingAnalysis {
  const htmlLength = html.length;

  // Check for SPA framework markers
  let spaMarker: string | null = null;
  for (const marker of SPA_MARKERS) {
    if (html.includes(marker)) {
      spaMarker = marker;
      break;
    }
  }
  const hasSpaMarkers = spaMarker !== null;

  // Parse and strip non-content elements
  const root = parse(html);
  const body = root.querySelector('body') ?? root;

  for (const el of body.querySelectorAll('script, style, noscript, svg')) {
    el.remove();
  }

  // Visible text
  const visibleText = body.textContent.replace(/\s+/g, ' ').trim();
  const visibleTextLength = visibleText.length;

  // Content signals: headings with substantive text
  const headings = body.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let contentHeadings = 0;
  for (const h of headings) {
    const text = h.textContent.trim();
    // Skip very short headings that are likely nav labels
    if (text.length > 3) contentHeadings++;
  }

  // Content signals: paragraphs with prose
  const paragraphs = body.querySelectorAll('p');
  let contentParagraphs = 0;
  for (const p of paragraphs) {
    const text = p.textContent.trim();
    if (text.length > 30) contentParagraphs++;
  }

  // Content signals: code blocks
  const codeBlocks = body.querySelectorAll('pre, code').length;

  // Content signals: main content region with substantive content inside it.
  // An SPA shell can have a <main> element with just a page title and breadcrumbs,
  // so we check for real content (paragraphs, code) inside <main> specifically.
  const main = body.querySelector('main, [role="main"]');
  let hasMainContent = false;
  if (main) {
    const mainParas = main.querySelectorAll('p');
    let mainParagraphs = 0;
    for (const p of mainParas) {
      if (p.textContent.trim().length > 30) mainParagraphs++;
    }
    const mainCode = main.querySelectorAll('pre, code').length;
    hasMainContent = mainParagraphs >= 2 || mainCode >= 1;
  }

  // Determine if the page has real content
  // A page has content if it has enough content signals, regardless of text ratio
  const hasContent =
    contentHeadings >= 3 ||
    contentParagraphs >= 5 ||
    (hasMainContent && contentHeadings >= 1) ||
    codeBlocks >= 3 ||
    !hasSpaMarkers; // No SPA markers = traditional server-rendered, assume content

  return {
    hasContent,
    hasSpaMarkers,
    spaMarker,
    contentHeadings,
    contentParagraphs,
    codeBlocks,
    hasMainContent,
    visibleTextLength,
    htmlLength,
  };
}
