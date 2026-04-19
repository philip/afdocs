import { describe, it, expect } from 'vitest';
import { looksLikeMarkdown, looksLikeHtml } from '../../../src/helpers/detect-markdown.js';

describe('looksLikeHtml', () => {
  it('detects DOCTYPE', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html><body>Hi</body></html>')).toBe(true);
  });

  it('detects <html> tag', () => {
    expect(looksLikeHtml('<html><body>Hi</body></html>')).toBe(true);
  });

  it('detects <head> tag', () => {
    expect(looksLikeHtml('<head><title>Test</title></head>')).toBe(true);
  });

  it('detects <body> tag', () => {
    expect(looksLikeHtml('<body>content</body>')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(looksLikeHtml('<!DOCTYPE HTML>')).toBe(true);
    expect(looksLikeHtml('<HTML>')).toBe(true);
  });

  it('returns false for markdown', () => {
    expect(looksLikeHtml('# Hello\n\nThis is **markdown**.')).toBe(false);
  });

  it('ignores HTML tags inside fenced code blocks', () => {
    const md = '# Example\n\n```html\n<!DOCTYPE html>\n<html>\n<body>Hello</body>\n</html>\n```\n';
    expect(looksLikeHtml(md)).toBe(false);
  });

  it('ignores HTML tags inside inline code spans', () => {
    const md = '# Setup\n\nAdd the script before the closing `</body>` tag.\n';
    expect(looksLikeHtml(md)).toBe(false);
  });

  it('ignores HTML tags inside tilde fenced code blocks', () => {
    const md = '# Example\n\n~~~html\n<html>\n<head><title>Test</title></head>\n</html>\n~~~\n';
    expect(looksLikeHtml(md)).toBe(false);
  });

  it('still detects real HTML outside of code blocks', () => {
    const html = '<!DOCTYPE html>\n<html>\n```not a code block\n```\n</html>';
    expect(looksLikeHtml(html)).toBe(true);
  });
});

describe('looksLikeMarkdown', () => {
  it('detects heading', () => {
    expect(looksLikeMarkdown('# Title\n\nSome text')).toBe(true);
  });

  it('detects links', () => {
    expect(looksLikeMarkdown('Check out [this link](https://example.com)')).toBe(true);
  });

  it('detects code fences', () => {
    expect(looksLikeMarkdown('Some text\n```js\nconsole.log("hi")\n```')).toBe(true);
  });

  it('returns false for HTML', () => {
    expect(looksLikeMarkdown('<!DOCTYPE html><html><body>Hi</body></html>')).toBe(false);
  });

  it('returns false for plain text with no markdown signals', () => {
    expect(looksLikeMarkdown('Just some plain text without any formatting.')).toBe(false);
  });

  it('returns true for markdown containing HTML examples in code', () => {
    const md =
      '# Web API\n\nAdd the script before `</body>`.\n\n```html\n<html><body>Hello</body></html>\n```\n';
    expect(looksLikeMarkdown(md)).toBe(true);
  });
});
