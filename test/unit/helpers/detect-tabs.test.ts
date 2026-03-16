import { describe, it, expect } from 'vitest';
import { detectTabGroups } from '../../../src/helpers/detect-tabs.js';

describe('detectTabGroups', () => {
  it('returns empty array for HTML with no tabs', () => {
    const html = '<html><body><h1>Hello</h1><p>No tabs here.</p></body></html>';
    expect(detectTabGroups(html)).toEqual([]);
  });

  it('detects Docusaurus tabs', () => {
    const html = `
      <div>
        <ul role="tablist">
          <li class="tabs__item" role="tab">Python</li>
          <li class="tabs__item" role="tab">JavaScript</li>
        </ul>
        <div role="tabpanel"><pre>import requests</pre></div>
        <div role="tabpanel"><pre>const fetch = require('node-fetch');</pre></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('docusaurus');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels).toHaveLength(2);
    expect(groups[0].panels[0].label).toBe('Python');
    expect(groups[0].panels[1].label).toBe('JavaScript');
  });

  it('detects MkDocs Material tabs', () => {
    const html = `
      <div class="tabbed-set">
        <div class="tabbed-labels">
          <label>Bash</label>
          <label>PowerShell</label>
        </div>
        <div class="tabbed-content">
          <div class="tabbed-block"><pre>echo hello</pre></div>
          <div class="tabbed-block"><pre>Write-Host hello</pre></div>
        </div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('mkdocs');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Bash');
  });

  it('detects Sphinx tabs', () => {
    const html = `
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">C++</div>
        <div class="sphinx-tabs-tab">Rust</div>
        <div class="sphinx-tabs-panel"><pre>std::cout</pre></div>
        <div class="sphinx-tabs-panel"><pre>println!</pre></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('sphinx');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('C++');
  });

  it('detects Microsoft Learn tabs', () => {
    const html = `
      <div class="tabGroup">
        <a role="tab" data-tab="csharp">C#</a>
        <a role="tab" data-tab="java">Java</a>
        <section role="tabpanel" data-tab="csharp"><pre>Console.WriteLine</pre></section>
        <section role="tabpanel" data-tab="java"><pre>System.out.println</pre></section>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('microsoft-learn');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('C#');
  });

  it('detects generic ARIA tabs', () => {
    const html = `
      <div>
        <div role="tablist">
          <button role="tab">Tab A</button>
          <button role="tab">Tab B</button>
        </div>
        <div role="tabpanel"><p>Content A</p></div>
        <div role="tabpanel"><p>Content B</p></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('generic-aria');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Tab A');
  });

  it('does not double-detect Docusaurus tabs as generic ARIA', () => {
    const html = `
      <div>
        <ul role="tablist">
          <li class="tabs__item" role="tab">Python</li>
          <li class="tabs__item" role="tab">Node</li>
        </ul>
        <div role="tabpanel"><pre>python code</pre></div>
        <div role="tabpanel"><pre>node code</pre></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('docusaurus');
  });

  it('detects multiple tab groups on same page', () => {
    const html = `
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">A</div>
        <div class="sphinx-tabs-panel"><p>Panel A</p></div>
      </div>
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">B</div>
        <div class="sphinx-tabs-panel"><p>Panel B</p></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(2);
  });

  it('includes htmlSlice as outerHTML of the container', () => {
    const html = `
      <div class="tabbed-set"><div class="tabbed-labels"><label>X</label></div><div class="tabbed-content"><div class="tabbed-block">content</div></div></div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].htmlSlice).toContain('tabbed-set');
    expect(groups[0].htmlSlice).toContain('content');
  });

  it('handles empty HTML gracefully', () => {
    expect(detectTabGroups('')).toEqual([]);
  });

  it('skips tab groups with no panels (likely navigation)', () => {
    const html = `
      <div class="tabGroup">
        <a role="tab" data-tab="one">One</a>
      </div>
    `;
    // Tabs without panels are typically site navigation, not content
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(0);
  });

  it('detects MDX-style <Tabs>/<Tab name="..."> (MongoDB pattern)', () => {
    const md = `
# Guide

<Tabs>

<Tab name="Python">

## Python Setup

\`\`\`python
pip install pymongo
\`\`\`

</Tab>

<Tab name="Node.js">

## Node.js Setup

\`\`\`bash
npm install mongodb
\`\`\`

</Tab>

</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('mdx');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Python');
    expect(groups[0].panels[1].label).toBe('Node.js');
  });

  it('detects MDX-style <Tabs>/<TabItem label="..."> (Docusaurus MDX pattern)', () => {
    const md = `
<Tabs>
<TabItem label="npm">

\`\`\`bash
npm install foo
\`\`\`

</TabItem>
<TabItem label="yarn">

\`\`\`bash
yarn add foo
\`\`\`

</TabItem>
</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('mdx');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('npm');
    expect(groups[0].panels[1].label).toBe('yarn');
  });

  it('detects multiple MDX tab groups', () => {
    const md = `
<Tabs>
<Tab name="A">Content A</Tab>
<Tab name="B">Content B</Tab>
</Tabs>

Some text between.

<Tabs>
<Tab name="X">Content X</Tab>
<Tab name="Y">Content Y</Tab>
<Tab name="Z">Content Z</Tab>
</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(2);
    expect(groups[0].tabCount).toBe(2);
    expect(groups[1].tabCount).toBe(3);
  });

  it('falls back to TabItem value attribute when label is absent', () => {
    const md = `
<Tabs>
<TabItem value="go">Go code</TabItem>
<TabItem value="rust">Rust code</TabItem>
</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(1);
    expect(groups[0].panels[0].label).toBe('go');
    expect(groups[0].panels[1].label).toBe('rust');
  });

  it('detects multiple consecutive MDX <Tabs> groups separated by markdown', () => {
    const md = `
# Getting Started

<Tabs>
<Tab name="macOS">

Install with Homebrew:

\`\`\`bash
brew install myapp
\`\`\`

</Tab>
<Tab name="Linux">

Install with apt:

\`\`\`bash
sudo apt install myapp
\`\`\`

</Tab>
</Tabs>

## Configuration

After installing, configure the app:

<Tabs>
<Tab name="macOS">

\`\`\`bash
myapp config --os darwin
\`\`\`

</Tab>
<Tab name="Linux">

\`\`\`bash
myapp config --os linux
\`\`\`

</Tab>
</Tabs>

## Advanced Usage

For power users, here are some tips:

<Tabs>
<Tab name="macOS">

Use launchd to run as a service.

</Tab>
<Tab name="Linux">

Use systemd to run as a service.

</Tab>
<Tab name="Windows">

Use NSSM to run as a service.

</Tab>
</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(3);
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('macOS');
    expect(groups[1].tabCount).toBe(2);
    expect(groups[1].panels[0].label).toBe('macOS');
    expect(groups[2].tabCount).toBe(3);
    expect(groups[2].panels[2].label).toBe('Windows');
  });

  it('finds panels via ancestor walking (grandparent container)', () => {
    // LeafyGreen-style: tablist and tabpanels are not direct siblings.
    // The tabpanels are inside a separate wrapper div, both under a
    // shared grandparent container.
    const html = `
      <div class="tab-container">
        <div class="tab-header">
          <div role="tablist">
            <button role="tab">Go</button>
            <button role="tab">Rust</button>
          </div>
        </div>
        <div class="tab-body">
          <div role="tabpanel"><pre>fmt.Println("hello")</pre></div>
          <div role="tabpanel"><pre>println!("hello");</pre></div>
        </div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('generic-aria');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Go');
    expect(groups[0].panels[1].label).toBe('Rust');
  });

  it('finds panels via ancestor walking (great-grandparent container)', () => {
    // Even deeper nesting: tablist is 3 levels below the container
    // that holds the tabpanels.
    const html = `
      <div class="outer">
        <div class="section">
          <div class="inner">
            <div role="tablist">
              <button role="tab">Alpha</button>
              <button role="tab">Beta</button>
            </div>
          </div>
        </div>
        <div role="tabpanel"><p>Alpha content</p></div>
        <div role="tabpanel"><p>Beta content</p></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Alpha');
    expect(groups[0].panels[1].label).toBe('Beta');
  });

  it('textOf strips embedded style tags from tab labels', () => {
    const html = `
      <div>
        <div role="tablist">
          <button role="tab"><style>.some-class{color:red}</style>Clean Label</button>
          <button role="tab"><style>.other{font-size:12px}</style>Another Label</button>
        </div>
        <div role="tabpanel"><p>Content 1</p></div>
        <div role="tabpanel"><p>Content 2</p></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('generic-aria');
    expect(groups[0].panels[0].label).toBe('Clean Label');
    expect(groups[0].panels[1].label).toBe('Another Label');
  });

  it('findContainerWithPanels returns null when panels are too deep', () => {
    // Tablist nested 5+ levels deep from any ancestor with tabpanels.
    // maxDepth is 4, so it should not find any panels.
    const html = `
      <div class="root">
        <div class="level1">
          <div class="level2">
            <div class="level3">
              <div class="level4">
                <div class="level5">
                  <div role="tablist">
                    <button role="tab">Tab 1</button>
                    <button role="tab">Tab 2</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div role="tabpanel"><p>Panel 1</p></div>
        <div role="tabpanel"><p>Panel 2</p></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(0);
  });

  it('handles unclosed MDX Tabs tag gracefully', () => {
    const md = `
# Guide

<Tabs>

<Tab name="Python">

\`\`\`python
pip install pymongo
\`\`\`

</Tab>

<Tab name="Node.js">

\`\`\`bash
npm install mongodb
\`\`\`

</Tab>
    `;
    // No closing </Tabs>, so findTabsBlocks should handle gracefully
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(0);
  });

  it('handles more panels than labels (null label fallback)', () => {
    // MkDocs with 1 label but 2 panel blocks — second panel gets null label
    const html = `
      <div class="tabbed-set">
        <div class="tabbed-labels"><label>Only Label</label></div>
        <div class="tabbed-content">
          <div class="tabbed-block"><pre>first</pre></div>
          <div class="tabbed-block"><pre>second</pre></div>
        </div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('mkdocs');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Only Label');
    expect(groups[0].panels[1].label).toBeNull();
  });

  it('handles more tabs than panels (empty html fallback)', () => {
    // Sphinx with 2 tabs but only 1 panel — second panel gets empty html
    const html = `
      <div class="sphinx-tabs">
        <div class="sphinx-tabs-tab">Tab A</div>
        <div class="sphinx-tabs-tab">Tab B</div>
        <div class="sphinx-tabs-panel"><pre>only panel</pre></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('sphinx');
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Tab A');
    expect(groups[0].panels[0].html).toContain('only panel');
    expect(groups[0].panels[1].label).toBe('Tab B');
    expect(groups[0].panels[1].html).toBe('');
  });

  it('handles MS Learn with more tabs than panels', () => {
    const html = `
      <div class="tabGroup">
        <a role="tab" data-tab="a">A</a>
        <a role="tab" data-tab="b">B</a>
        <a role="tab" data-tab="c">C</a>
        <section role="tabpanel" data-tab="a"><pre>only A</pre></section>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].tabCount).toBe(3);
    expect(groups[0].panels[0].label).toBe('A');
    expect(groups[0].panels[1].label).toBe('B');
    expect(groups[0].panels[1].html).toBe('');
    expect(groups[0].panels[2].label).toBe('C');
    expect(groups[0].panels[2].html).toBe('');
  });

  it('generic ARIA handles more tabs than panels', () => {
    const html = `
      <div>
        <div role="tablist">
          <button role="tab">X</button>
          <button role="tab">Y</button>
          <button role="tab">Z</button>
        </div>
        <div role="tabpanel"><p>only X</p></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('generic-aria');
    expect(groups[0].tabCount).toBe(3);
    expect(groups[0].panels[2].label).toBe('Z');
    expect(groups[0].panels[2].html).toBe('');
  });

  it('MDX skips <Tab> inside nested <Tabs> (depth tracking)', () => {
    // Outer Tabs with inner nested Tabs — findTabsBlocks returns the outer
    // block as a single unit, and depth tracking skips the inner <Tab> elements
    const md = `
<Tabs>
<Tab name="Outer A">

<Tabs>
<Tab name="Inner 1">Nested content 1</Tab>
<Tab name="Inner 2">Nested content 2</Tab>
</Tabs>

</Tab>
<Tab name="Outer B">Outer B content</Tab>
</Tabs>
    `;
    const groups = detectTabGroups(md);
    // Only the outer group is detected; inner <Tab>s are skipped by depth check
    expect(groups).toHaveLength(1);
    expect(groups[0].tabCount).toBe(2);
    expect(groups[0].panels[0].label).toBe('Outer A');
    expect(groups[0].panels[1].label).toBe('Outer B');
  });

  it('MDX Tab without label attribute returns null label', () => {
    const md = `
<Tabs>
<Tab>Content with no label attribute</Tab>
</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(1);
    expect(groups[0].panels[0].label).toBeNull();
  });

  it('Docusaurus handles more panels than tabs (null label fallback)', () => {
    const html = `
      <div>
        <ul role="tablist">
          <li class="tabs__item" role="tab">Only Tab</li>
        </ul>
        <div role="tabpanel"><pre>panel 1</pre></div>
        <div role="tabpanel"><pre>panel 2</pre></div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('docusaurus');
    expect(groups[0].panels[0].label).toBe('Only Tab');
    expect(groups[0].panels[1].label).toBeNull();
  });

  it('Sphinx detector skips container already claimed by MkDocs', () => {
    // A .sphinx-tabs container nested inside a .tabbed-set (MkDocs).
    // MkDocs runs first and claims the outer container. Sphinx should
    // skip the inner .sphinx-tabs since it's inside the claimed region.
    const html = `
      <div class="tabbed-set">
        <div class="tabbed-labels"><label>Outer</label></div>
        <div class="tabbed-content">
          <div class="tabbed-block">
            <div class="sphinx-tabs">
              <div class="sphinx-tabs-tab">Inner</div>
              <div class="sphinx-tabs-panel"><pre>inner content</pre></div>
            </div>
          </div>
        </div>
      </div>
    `;
    const groups = detectTabGroups(html);
    // MkDocs claims the outer container; Sphinx skips the inner one
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('mkdocs');
  });

  it('MDX handles unclosed <Tab> tag (no matching </Tab>)', () => {
    const md = `
<Tabs>
<Tab name="Alpha">content with no closing tag
</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(1);
    expect(groups[0].panels[0].label).toBe('Alpha');
    // Content should include everything after the opening tag
    expect(groups[0].panels[0].html).toContain('content with no closing tag');
  });

  it('MDX skips <Tabs> block with no <Tab> children', () => {
    const md = `
<Tabs>
Just some text, no Tab elements here.
</Tabs>
    `;
    const groups = detectTabGroups(md);
    expect(groups).toHaveLength(0);
  });

  it('Docusaurus detector uses ancestor walking when panels are not siblings', () => {
    // Docusaurus with a wrapper structure where tablist and panels
    // share a grandparent rather than a direct parent.
    const html = `
      <div class="tabs-wrapper">
        <div class="tabs-header">
          <ul role="tablist">
            <li class="tabs__item" role="tab">npm</li>
            <li class="tabs__item" role="tab">yarn</li>
            <li class="tabs__item" role="tab">pnpm</li>
          </ul>
        </div>
        <div class="tabs-content">
          <div role="tabpanel"><pre>npm install foo</pre></div>
          <div role="tabpanel"><pre>yarn add foo</pre></div>
          <div role="tabpanel"><pre>pnpm add foo</pre></div>
        </div>
      </div>
    `;
    const groups = detectTabGroups(html);
    expect(groups).toHaveLength(1);
    expect(groups[0].framework).toBe('docusaurus');
    expect(groups[0].tabCount).toBe(3);
    expect(groups[0].panels[0].label).toBe('npm');
    expect(groups[0].panels[1].label).toBe('yarn');
    expect(groups[0].panels[2].label).toBe('pnpm');
  });
});
