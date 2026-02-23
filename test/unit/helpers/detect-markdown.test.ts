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
});
