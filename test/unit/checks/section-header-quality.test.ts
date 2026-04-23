import { describe, it, expect } from 'vitest';
import { createContext } from '../../../src/runner.js';
import { getCheck } from '../../../src/checks/registry.js';
import '../../../src/checks/index.js';

describe('section-header-quality', () => {
  const check = getCheck('section-header-quality')!;

  function makeCtx(tabbedResult?: {
    status: string;
    tabbedPages: Array<{
      url: string;
      tabGroups: Array<{
        framework: string;
        tabCount: number;
        htmlSlice: string;
        panels: Array<{ label: string | null; html: string }>;
      }>;
      totalTabbedChars: number;
      status: string;
    }>;
  }) {
    const ctx = createContext('http://test.local', { requestDelay: 0 });

    if (tabbedResult) {
      ctx.previousResults.set('tabbed-content-serialization', {
        id: 'tabbed-content-serialization',
        category: 'content-structure',
        status: tabbedResult.status as 'pass' | 'warn' | 'fail',
        message: 'test',
        details: { tabbedPages: tabbedResult.tabbedPages },
      });
    }

    return ctx;
  }

  it('skips when tabbed-content-serialization did not run', async () => {
    const ctx = createContext('http://test.local', { requestDelay: 0 });
    const result = await check.run(ctx);
    expect(result.status).toBe('skip');
  });

  it('passes when no tabbed content was found', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          { url: 'http://test.local/page', tabGroups: [], totalTabbedChars: 0, status: 'pass' },
        ],
      }),
    );
    expect(result.status).toBe('pass');
    expect(result.message).toContain('not applicable');
  });

  it('passes when headers include variant context', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'sphinx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Python Installation</h2><p>pip install foo</p></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Node Installation</h2><p>npm install foo</p></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.groupsWithGenericMajority).toBe(0);
  });

  it('fails when majority of headers are generic across panels', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'sphinx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Installation</h2><h3>Configuration</h3><h3>Usage</h3></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Installation</h2><h3>Configuration</h3><h3>Usage</h3></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.groupsWithGenericMajority).toBe(1);
    expect(result.details?.pagesAffected).toBe(1);
    expect(result.message).toContain("don't distinguish between variants");
  });

  it('passes when headers are unique to each panel', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'mkdocs',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Docker',
                    html: '<div><h2>Dockerfile Setup</h2><h3>Docker Compose</h3></div>',
                  },
                  {
                    label: 'Kubernetes',
                    html: '<div><h2>Helm Chart</h2><h3>kubectl apply</h3></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('pass');
  });

  it('warns when 25-50% of groups have generic majority', async () => {
    // 2 groups: 1 generic, 1 contextual = 50% → warn
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'sphinx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Installation</h2><h3>Setup</h3></div>' },
                  { label: 'Node', html: '<div><h2>Installation</h2><h3>Setup</h3></div>' },
                ],
              },
              {
                framework: 'sphinx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Python Guide</h2></div>' },
                  { label: 'Node', html: '<div><h2>Node Guide</h2></div>' },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('warn');
  });

  it('handles tab groups with fewer than 2 panels', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'sphinx',
                tabCount: 1,
                htmlSlice: '<div></div>',
                panels: [{ label: 'Only', html: '<div><h2>Installation</h2></div>' }],
              },
            ],
            totalTabbedChars: 50,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('pass');
    expect(result.message).toContain('fewer than 2 panels');
  });

  it('handles panels with no headers', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'mkdocs',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'A', html: '<div><p>Just text</p></div>' },
                  { label: 'B', html: '<div><p>More text</p></div>' },
                ],
              },
            ],
            totalTabbedChars: 50,
            status: 'pass',
          },
        ],
      }),
    );
    // No headers inside panels → can't evaluate, skip
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no section headers inside tab panels');
  });

  it('detects generic markdown headers in MDX panels', async () => {
    const result = await check.run(
      makeCtx({
        status: 'fail',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<Tabs></Tabs>',
                panels: [
                  {
                    label: 'Python',
                    html: '<Tab name="Python">\n\n## Installation\n\n## Configuration\n\n## Usage\n\n</Tab>',
                  },
                  {
                    label: 'Node',
                    html: '<Tab name="Node">\n\n## Installation\n\n## Configuration\n\n## Usage\n\n</Tab>',
                  },
                ],
              },
            ],
            totalTabbedChars: 200,
            status: 'fail',
          },
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.groupsWithGenericMajority).toBe(1);
  });

  it('fails when identical headers repeat across multiple tab groups without variant context', async () => {
    // 3 tab groups on same page, each with 2 panels, all sharing "Build a Search Query"
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/tutorial',
            tabGroups: [
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Build a Search Query</h2><p>python code</p></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Build a Search Query</h2><p>node code</p></div>',
                  },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Build a Search Query</h2><p>more python</p></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Build a Search Query</h2><p>more node</p></div>',
                  },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Build a Search Query</h2><p>even more</p></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Build a Search Query</h2><p>even more</p></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 300,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.details?.pagesAffected).toBe(1);
    expect(result.details?.crossGroupGenericGroupCount).toBe(3);
    expect(result.message).toContain('build a search query');
    expect(result.message).toContain('repeats across 3 tab groups');
    expect(result.details?.crossGroupRepeatedHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ header: 'build a search query', groupCount: 3 }),
      ]),
    );
  });

  it('passes cross-group when headers include panel labels', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/tutorial',
            tabGroups: [
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Python Setup</h2></div>' },
                  { label: 'Node', html: '<div><h2>Node Setup</h2></div>' },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Python Config</h2></div>' },
                  { label: 'Node', html: '<div><h2>Node Config</h2></div>' },
                ],
              },
            ],
            totalTabbedChars: 200,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.pagesAffected).toBe(0);
    expect(result.details?.crossGroupGenericGroupCount).toBe(0);
    expect(result.message).toContain('headers include variant context');
  });

  it('skips cross-group analysis for pages with only one tab group', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'sphinx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Python Installation</h2></div>' },
                  { label: 'Node', html: '<div><h2>Node Installation</h2></div>' },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.crossGroupTotalGroupCount).toBe(0);
  });

  it('warns when cross-group generic ratio is between 25-50%', async () => {
    // 4 tab groups on one page. Groups 1 and 2 share "Getting Started" (cross-group generic).
    // Groups 3 and 4 have unique headers. crossGroupGenericGroupCount = 2, total = 4, ratio = 0.5 → warn.
    // Within-group: each group has label-contextual headers so within-group passes.
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/tutorial',
            tabGroups: [
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Getting Started</h2><h3>Python Basics</h3></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Getting Started</h2><h3>Node Basics</h3></div>',
                  },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Getting Started</h2><h3>Python Advanced</h3></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Getting Started</h2><h3>Node Advanced</h3></div>',
                  },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Python Config</h2></div>' },
                  { label: 'Node', html: '<div><h2>Node Config</h2></div>' },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Python Deployment</h2></div>' },
                  { label: 'Node', html: '<div><h2>Node Deployment</h2></div>' },
                ],
              },
            ],
            totalTabbedChars: 400,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('warn');
    expect(result.details?.crossGroupGenericGroupCount).toBe(2);
    expect(result.details?.crossGroupTotalGroupCount).toBe(4);
  });

  it('sorts cross-group repeated headers by group count to find worst', async () => {
    // 4 tab groups. "Overview" appears in 3 groups, "Setup" appears in 2 groups.
    // The message should mention "overview" (the worst offender) not "setup".
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/guide',
            tabGroups: [
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Overview</h2><h3>Setup</h3></div>' },
                  { label: 'Node', html: '<div><h2>Overview</h2><h3>Setup</h3></div>' },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Overview</h2></div>' },
                  { label: 'Node', html: '<div><h2>Overview</h2></div>' },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Overview</h2><h3>Setup</h3></div>' },
                  { label: 'Node', html: '<div><h2>Overview</h2><h3>Setup</h3></div>' },
                ],
              },
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  { label: 'Python', html: '<div><h2>Python Testing</h2></div>' },
                  { label: 'Node', html: '<div><h2>Node Testing</h2></div>' },
                ],
              },
            ],
            totalTabbedChars: 400,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.message).toContain('overview');
    expect(result.message).toContain('repeats across');
    // "overview" appears in 3 groups, "setup" in 2 — worst should be "overview"
    expect(result.details?.crossGroupRepeatedHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ header: 'overview', groupCount: 3 }),
        expect.objectContaining({ header: 'setup', groupCount: 2 }),
      ]),
    );
  });

  // Callout/admonition heading exclusion tests (issue #51)
  it('excludes callout headings inside <aside> elements', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'generic-aria',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><aside><h2>Warning</h2><p>Be careful</p></aside></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><aside><h2>Warning</h2><p>Be careful</p></aside></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    // No section headers remain after excluding callout headings
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no section headers inside tab panels');
  });

  it('excludes callout headings inside elements with ARIA role="note"', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'generic-aria',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><div role="note"><h3>Note</h3><p>Info here</p></div></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><div role="note"><h3>Note</h3><p>Info here</p></div></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no section headers inside tab panels');
  });

  it('excludes callout headings inside elements with admonition class', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'mkdocs',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><div class="admonition warning"><h3>Warning</h3><p>Careful</p></div></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><div class="admonition warning"><h3>Warning</h3><p>Careful</p></div></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no section headers inside tab panels');
  });

  it('excludes callout headings inside elements with data-* callout attributes', async () => {
    // Twilio Paste pattern: data-paste-element="CALLOUT" on ancestor
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'generic-aria',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><div data-paste-element="CALLOUT"><div><h2 data-paste-element="CALLOUT_HEADING">Warning</h2></div></div></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><div data-paste-element="CALLOUT"><div><h2 data-paste-element="CALLOUT_HEADING">Warning</h2></div></div></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no section headers inside tab panels');
  });

  it('counts section headers but ignores callout headings in the same panel', async () => {
    // Panels have both a real section header and a callout heading.
    // Only the section header should be counted; the callout should be ignored.
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'generic-aria',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Python Setup</h2><aside><h3>Warning</h3><p>Be careful</p></aside></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Node Setup</h2><aside><h3>Warning</h3><p>Be careful</p></aside></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    // "Python Setup" and "Node Setup" include variant context → pass
    // "Warning" in <aside> is excluded from analysis entirely
    expect(result.status).toBe('pass');
    expect(result.details?.groupsWithGenericMajority).toBe(0);
  });

  // Framework-specific callout pattern tests
  it('excludes Bootstrap alert headings (role="alert" + alert-heading)', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'generic-aria',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><div class="alert alert-warning" role="alert"><h4 class="alert-heading">Warning!</h4><p>Check your configuration.</p></div></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><div class="alert alert-warning" role="alert"><h4 class="alert-heading">Warning!</h4><p>Check your configuration.</p></div></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no section headers inside tab panels');
  });

  it('excludes headings inside Docusaurus admonition containers', async () => {
    // Docusaurus uses class names containing "admonition" and "alert"
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'docusaurus',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><div class="theme-admonition theme-admonition-warning admonition_xJq3 alert alert--warning"><h5>Deprecation Notice</h5><p>This API will be removed.</p></div></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><div class="theme-admonition theme-admonition-warning admonition_xJq3 alert alert--warning"><h5>Deprecation Notice</h5><p>This API will be removed.</p></div></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 100,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('skip');
    expect(result.message).toContain('no section headers inside tab panels');
  });

  it('excludes headings inside Sphinx/MkDocs admonition with nested content', async () => {
    // Sphinx/MkDocs admonition titles use <p>, but user content inside
    // the admonition could contain headings (e.g., a long note with sections)
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'sphinx',
                tabCount: 2,
                htmlSlice: '<div></div>',
                panels: [
                  {
                    label: 'Python',
                    html: '<div><h2>Python Setup</h2><div class="admonition note"><p class="admonition-title">Note</p><h4>Prerequisites</h4><p>You need Python 3.8+</p></div></div>',
                  },
                  {
                    label: 'Node',
                    html: '<div><h2>Node Setup</h2><div class="admonition note"><p class="admonition-title">Note</p><h4>Prerequisites</h4><p>You need Node 18+</p></div></div>',
                  },
                ],
              },
            ],
            totalTabbedChars: 200,
            status: 'pass',
          },
        ],
      }),
    );
    // "Python Setup" / "Node Setup" are section headers → counted, contextual → pass
    // "Prerequisites" inside .admonition → excluded
    expect(result.status).toBe('pass');
    expect(result.details?.groupsWithGenericMajority).toBe(0);
  });

  it('detects contextual markdown headers in MDX panels', async () => {
    const result = await check.run(
      makeCtx({
        status: 'pass',
        tabbedPages: [
          {
            url: 'http://test.local/page',
            tabGroups: [
              {
                framework: 'mdx',
                tabCount: 2,
                htmlSlice: '<Tabs></Tabs>',
                panels: [
                  {
                    label: 'Python',
                    html: '<Tab name="Python">\n\n## Python Installation\n\n## Python Configuration\n\n</Tab>',
                  },
                  {
                    label: 'Node',
                    html: '<Tab name="Node">\n\n## Node Installation\n\n## Node Configuration\n\n</Tab>',
                  },
                ],
              },
            ],
            totalTabbedChars: 200,
            status: 'pass',
          },
        ],
      }),
    );
    expect(result.status).toBe('pass');
    expect(result.details?.groupsWithGenericMajority).toBe(0);
  });
});
