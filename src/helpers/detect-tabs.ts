import { parse, type HTMLElement } from 'node-html-parser';

export interface TabPanel {
  label: string | null;
  html: string;
}

export interface DetectedTabGroup {
  framework: string;
  tabCount: number;
  htmlSlice: string;
  panels: TabPanel[];
}

type Detector = (
  root: HTMLElement,
  claimed: Set<HTMLElement>,
  source?: string,
) => DetectedTabGroup[];

function isDescendantOf(node: HTMLElement, ancestor: HTMLElement): boolean {
  let current = node.parentNode;
  while (current) {
    if (current === ancestor) return true;
    current = current.parentNode;
  }
  return false;
}

function isInsideClaimed(node: HTMLElement, claimed: Set<HTMLElement>): boolean {
  for (const container of claimed) {
    if (container === node || isDescendantOf(node, container)) return true;
  }
  return false;
}

function textOf(el: HTMLElement): string {
  // Clone to avoid mutating the original DOM, then strip <style> elements
  // that some component libraries (e.g. LeafyGreen) embed inside tab buttons.
  const clone = el.clone() as HTMLElement;
  for (const style of clone.querySelectorAll('style')) {
    style.remove();
  }
  return clone.textContent.trim();
}

/**
 * Walk up from `start` (exclusive) looking for the nearest ancestor that
 * contains `[role="tabpanel"]` children.  Some component libraries (e.g.
 * LeafyGreen) place the tablist and the tab-panels as siblings rather than
 * parent/child, so `tablist.parentNode` alone won't find the panels.
 * Stops after `maxDepth` levels to avoid scanning the whole document.
 */
function findContainerWithPanels(
  start: HTMLElement,
  claimed: Set<HTMLElement>,
  maxDepth = 4,
): { container: HTMLElement; panels: HTMLElement[] } | null {
  let current = start.parentNode as HTMLElement | null;
  for (let depth = 0; current && depth < maxDepth; depth++) {
    if (isInsideClaimed(current, claimed)) return null;
    const panels = current.querySelectorAll('[role="tabpanel"]') as unknown as HTMLElement[];
    if (panels.length > 0) return { container: current, panels: [...panels] };
    current = current.parentNode as HTMLElement | null;
  }
  return null;
}

const docusaurus: Detector = (root, claimed) => {
  const groups: DetectedTabGroup[] = [];
  // Docusaurus uses role="tablist" with tabs__item class children
  const tablists = root.querySelectorAll('[role="tablist"]');
  for (const tablist of tablists) {
    if (isInsideClaimed(tablist as HTMLElement, claimed)) continue;
    const tabs = tablist.querySelectorAll('.tabs__item');
    if (tabs.length === 0) continue;

    // Find the wrapping container (parent of both tablist and tabpanels).
    // Some component libraries put tablist and tabpanels as siblings rather
    // than direct parent/child, so we walk up until we find panels.
    const found = findContainerWithPanels(tablist as HTMLElement, claimed);
    if (!found) continue;
    const { container, panels } = found;

    const labels = tabs.map((t) => textOf(t as HTMLElement));
    const panelData: TabPanel[] = panels.map((p, i) => ({
      label: labels[i] ?? null,
      html: p.outerHTML,
    }));

    claimed.add(container);
    groups.push({
      framework: 'docusaurus',
      tabCount: tabs.length,
      htmlSlice: container.outerHTML,
      panels: panelData,
    });
  }
  return groups;
};

const mkdocs: Detector = (root, claimed) => {
  const groups: DetectedTabGroup[] = [];
  const containers = root.querySelectorAll('.tabbed-set');
  for (const container of containers) {
    const el = container as HTMLElement;
    if (isInsideClaimed(el, claimed)) continue;

    const labels = el.querySelectorAll('.tabbed-labels label, .tabbed-labels > *');
    const panels = el.querySelectorAll('.tabbed-content > .tabbed-block, .tabbed-content > *');

    if (labels.length === 0 && panels.length === 0) continue;

    const panelData: TabPanel[] = [];
    const count = Math.max(labels.length, panels.length);
    for (let i = 0; i < count; i++) {
      panelData.push({
        label: labels[i] ? textOf(labels[i] as HTMLElement) : null,
        html: panels[i] ? (panels[i] as HTMLElement).outerHTML : '',
      });
    }

    claimed.add(el);
    groups.push({
      framework: 'mkdocs',
      tabCount: count,
      htmlSlice: el.outerHTML,
      panels: panelData,
    });
  }
  return groups;
};

const sphinx: Detector = (root, claimed) => {
  const groups: DetectedTabGroup[] = [];
  const containers = root.querySelectorAll('.sphinx-tabs');
  for (const container of containers) {
    const el = container as HTMLElement;
    if (isInsideClaimed(el, claimed)) continue;

    const tabs = el.querySelectorAll('.sphinx-tabs-tab');
    const panels = el.querySelectorAll('.sphinx-tabs-panel');
    if (tabs.length === 0 && panels.length === 0) continue;

    const panelData: TabPanel[] = [];
    const count = Math.max(tabs.length, panels.length);
    for (let i = 0; i < count; i++) {
      panelData.push({
        label: tabs[i] ? textOf(tabs[i] as HTMLElement) : null,
        html: panels[i] ? (panels[i] as HTMLElement).outerHTML : '',
      });
    }

    claimed.add(el);
    groups.push({
      framework: 'sphinx',
      tabCount: count,
      htmlSlice: el.outerHTML,
      panels: panelData,
    });
  }
  return groups;
};

const msLearn: Detector = (root, claimed) => {
  const groups: DetectedTabGroup[] = [];
  const containers = root.querySelectorAll('.tabGroup');
  for (const container of containers) {
    const el = container as HTMLElement;
    if (isInsideClaimed(el, claimed)) continue;

    const tabs = el.querySelectorAll('[role="tab"][data-tab]');
    const panels = el.querySelectorAll('[role="tabpanel"], .tabPanel');
    if (tabs.length === 0 || panels.length === 0) continue;

    const panelData: TabPanel[] = [];
    const count = Math.max(tabs.length, panels.length);
    for (let i = 0; i < count; i++) {
      panelData.push({
        label: tabs[i] ? textOf(tabs[i] as HTMLElement) : null,
        html: panels[i] ? (panels[i] as HTMLElement).outerHTML : '',
      });
    }

    claimed.add(el);
    groups.push({
      framework: 'microsoft-learn',
      tabCount: count,
      htmlSlice: el.outerHTML,
      panels: panelData,
    });
  }
  return groups;
};

const genericAria: Detector = (root, claimed) => {
  const groups: DetectedTabGroup[] = [];
  const tablists = root.querySelectorAll('[role="tablist"]');
  for (const tablist of tablists) {
    const el = tablist as HTMLElement;
    if (isInsideClaimed(el, claimed)) continue;

    const found = findContainerWithPanels(el, claimed);
    const tabs = el.querySelectorAll('[role="tab"]');

    if (!found) {
      // No panels found — skip. Tabs without panels are typically site
      // navigation, not content tab groups. The serialization check only
      // cares about panel content, so there's nothing to measure here.
      continue;
    }

    const { container, panels } = found;
    if (tabs.length === 0 && panels.length === 0) continue;

    // Use tab count as the authority. Containers may hold panels from
    // multiple tab groups; capping to tabs.length avoids misattributing
    // panels from sibling groups in the same ancestor.
    const panelData: TabPanel[] = [];
    const count = tabs.length > 0 ? tabs.length : panels.length;
    for (let i = 0; i < count; i++) {
      panelData.push({
        label: tabs[i] ? textOf(tabs[i] as HTMLElement) : null,
        html: panels[i] ? (panels[i] as HTMLElement).outerHTML : '',
      });
    }

    claimed.add(container);
    groups.push({
      framework: 'generic-aria',
      tabCount: count,
      htmlSlice: container.outerHTML,
      panels: panelData,
    });
  }
  return groups;
};

/**
 * Find all `<Tabs>...</Tabs>` blocks in raw source text with proper nesting.
 * Returns the content (including the tags) and the start offset of each
 * top-level `<Tabs>` block.  We use regex rather than node-html-parser
 * because the DOM parser can't reliably handle `</Tabs>` followed by
 * markdown text followed by `<Tabs>` — it merges them into one element.
 */
function findTabsBlocks(source: string): string[] {
  const blocks: string[] = [];
  const openRe = /<Tabs\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(source)) !== null) {
    const startIdx = match.index;
    // Track nesting to find the matching </Tabs>
    let depth = 1;
    let pos = startIdx + match[0].length;
    while (pos < source.length && depth > 0) {
      const nextOpen = source.indexOf('<Tabs', pos);
      const nextClose = source.indexOf('</Tabs>', pos);
      if (nextClose === -1) break; // unclosed tag
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 5;
      } else {
        depth--;
        if (depth === 0) {
          blocks.push(source.substring(startIdx, nextClose + 7));
          // Advance the outer regex past this block to avoid re-entering
          openRe.lastIndex = nextClose + 7;
        }
        pos = nextClose + 7;
      }
    }
  }
  return blocks;
}

const TAB_OPEN_RE = /<(Tab|TabItem)\b([^>]*)>/gi;
const ATTR_RE = /(?:name|label|value)\s*=\s*"([^"]*)"/i;

/**
 * MDX-style tabs: `<Tabs>` container with `<Tab name="...">` or
 * `<TabItem label="...">` children. Used by MongoDB docs, Docusaurus MDX, and others.
 *
 * Uses regex-based block finding instead of DOM parsing because
 * node-html-parser can't reliably parse `</Tabs>` + markdown + `<Tabs>`
 * as separate elements in mixed markdown/HTML content.
 */
const mdxTabs: Detector = (_root, _claimed, source?: string) => {
  if (!source) return [];
  const groups: DetectedTabGroup[] = [];
  const blocks = findTabsBlocks(source);

  for (const block of blocks) {
    // Find direct <Tab>/<TabItem> children (depth 1 inside this block).
    // We track nesting to skip tabs inside nested <Tabs> groups.
    const inner = block.substring(block.indexOf('>') + 1, block.lastIndexOf('</'));
    const panels: TabPanel[] = [];

    TAB_OPEN_RE.lastIndex = 0;
    let tabMatch: RegExpExecArray | null;
    while ((tabMatch = TAB_OPEN_RE.exec(inner)) !== null) {
      // Check for nested <Tabs> between our position and this <Tab>
      const before = inner.substring(0, tabMatch.index);
      const opensInBefore = (before.match(/<Tabs\b/gi) || []).length;
      const closesInBefore = (before.match(/<\/Tabs>/gi) || []).length;
      const depth = opensInBefore - closesInBefore;

      if (depth > 0) continue; // This <Tab> belongs to a nested <Tabs>

      const attrs = tabMatch[2];
      const labelMatch = attrs.match(ATTR_RE);
      const label = labelMatch ? labelMatch[1] : null;

      // Find the matching closing tag for this <Tab>
      const closeTag = `</${tabMatch[1]}>`;
      const closeIdx = inner.indexOf(closeTag, tabMatch.index + tabMatch[0].length);
      const tabContent =
        closeIdx !== -1
          ? inner.substring(tabMatch.index, closeIdx + closeTag.length)
          : inner.substring(tabMatch.index);

      panels.push({ label, html: tabContent });
    }

    if (panels.length === 0) continue;

    groups.push({
      framework: 'mdx',
      tabCount: panels.length,
      htmlSlice: block,
      panels,
    });
  }
  return groups;
};

const frameworkDetectors: Detector[] = [docusaurus, mkdocs, sphinx, msLearn, mdxTabs];

export function detectTabGroups(html: string): DetectedTabGroup[] {
  const root = parse(html);
  const claimed = new Set<HTMLElement>();
  const groups: DetectedTabGroup[] = [];

  for (const detector of frameworkDetectors) {
    for (const group of detector(root, claimed, html)) {
      groups.push(group);
    }
  }

  for (const group of genericAria(root, claimed)) {
    groups.push(group);
  }

  return groups;
}
