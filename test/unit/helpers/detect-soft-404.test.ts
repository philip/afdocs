import { describe, it, expect } from 'vitest';
import { SOFT_404_PATTERNS, isSoft404Body } from '../../../src/helpers/detect-soft-404.js';

describe('SOFT_404_PATTERNS', () => {
  it.each([
    ['Not Found', true],
    ['Page Not Found', true],
    ['page not found', true],
    ['404', true],
    ['does not exist', true],
    ['Welcome to our docs', false],
  ])('matches %s → %s', (input, expected) => {
    expect(SOFT_404_PATTERNS.test(input)).toBe(expected);
  });
});

describe('isSoft404Body', () => {
  it('detects heading with "Page Not Found"', () => {
    const body = '# Page Not Found\n\nThe URL does not exist.\n';
    expect(isSoft404Body(body)).toBe(true);
  });

  it('detects heading with "404"', () => {
    const body = '# 404\n\nThis page could not be found.\n';
    expect(isSoft404Body(body)).toBe(true);
  });

  it('detects heading with "Not Found" at h2 level', () => {
    const body = '## Not Found\n\nSorry, we could not locate this page.\n';
    expect(isSoft404Body(body)).toBe(true);
  });

  it('detects short body with "Not found" (no heading)', () => {
    const body = 'Not found';
    expect(isSoft404Body(body)).toBe(true);
  });

  it('detects short body mentioning "404"', () => {
    const body = 'Error 404 - page not available';
    expect(isSoft404Body(body)).toBe(true);
  });

  it('does NOT flag long documentation that mentions "404" in body text', () => {
    // Simulates docs.github.com/en/pages which has links about "custom 404 page"
    const body =
      '# GitHub Pages documentation\n\n' +
      'GitHub Pages turns any GitHub repository into a live website.\n\n' +
      '## Links\n\n' +
      Array.from({ length: 20 }, (_, i) => `* [Topic ${i}](/en/pages/topic-${i})\n`).join('') +
      '* [Creating a custom 404 page for your GitHub Pages site](/en/pages/creating-a-custom-404-page)\n' +
      '* [Troubleshooting 404 errors for GitHub Pages sites](/en/pages/troubleshooting-404-errors)\n';
    expect(isSoft404Body(body)).toBe(false);
  });

  it('does NOT flag real markdown content', () => {
    const body =
      '# Getting Started\n\nWelcome to the documentation.\n\n## Installation\n\n```bash\nnpm install\n```\n';
    expect(isSoft404Body(body)).toBe(false);
  });

  it('does NOT flag content with "404" only in link text far from heading', () => {
    const body =
      '# Web Hosting Guide\n\n' +
      'Learn how to deploy websites.\n\n' +
      'A'.repeat(500) +
      '\n\n' +
      'See also: [How to handle 404 errors](/guide/404-errors)\n';
    expect(isSoft404Body(body)).toBe(false);
  });
});
