import { describe, test, expect } from 'vitest';
import { wrapText } from '../src/wrap-text.js';

describe('wrapText', () => {
  test('returns short text unchanged', () => {
    expect(wrapText('hello world', 80)).toBe('hello world');
  });

  test('wraps text at word boundary when exceeding maxWidth', () => {
    const input = 'the quick brown fox jumps over the lazy dog';
    const result = wrapText(input, 20);
    const lines = result.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(20);
    }
    // All words should be present
    expect(result.replace(/\n/g, ' ')).toBe(input);
  });

  test('preserves existing newlines', () => {
    const input = 'line one\nline two\nline three';
    expect(wrapText(input, 80)).toBe(input);
  });

  test('wraps each paragraph independently', () => {
    const input = 'short\nthis is a longer line that should be wrapped at the boundary';
    const result = wrapText(input, 30);
    const lines = result.split('\n');
    expect(lines[0]).toBe('short');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(35); // some tolerance for word boundaries
    }
  });

  test('handles empty string', () => {
    expect(wrapText('', 80)).toBe('');
  });

  test('handles single word longer than maxWidth', () => {
    const longWord = 'abcdefghijklmnopqrstuvwxyz';
    const result = wrapText(longWord, 10);
    // A single word longer than maxWidth should still appear (not be lost)
    expect(result).toContain(longWord);
  });

  test('handles multiple spaces between words', () => {
    const input = 'word1  word2  word3';
    const result = wrapText(input, 80);
    expect(result).toContain('word1');
    expect(result).toContain('word2');
    expect(result).toContain('word3');
  });

  test('handles realistic composition error message', () => {
    const errorMsg =
      'The field "Foo.description" is defined in subgraph "subgraph-b" with @override(from: "subgraph-c"), ' +
      'but subgraph "subgraph-c" also defines "Foo.description" with @override(from: "subgraph-b"). ' +
      'This creates a circular override that cannot be resolved. Remove one of the @override directives to fix this error.';

    const result = wrapText(errorMsg, 116);
    const lines = result.split('\n');

    // No line should exceed the maxWidth
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(116);
    }
    // All content should be preserved (no truncation)
    expect(result.replace(/\n/g, ' ')).toBe(errorMsg);
  });

  test('handles very long text with many words (regression test for deadlock)', () => {
    // Simulate the kind of error content that caused the deadlock with 4+ subgraphs
    const words = [];
    for (let i = 0; i < 500; i++) {
      words.push(`word${i}`);
    }
    const input = words.join(' ');

    const startTime = Date.now();
    const result = wrapText(input, 116);
    const elapsed = Date.now() - startTime;

    // Must complete quickly — the original bug caused an indefinite hang
    expect(elapsed).toBeLessThan(1000);

    const lines = result.split('\n');
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(116);
    }
  });

  test('preserves empty lines between paragraphs', () => {
    const input = 'paragraph one\n\nparagraph two';
    const result = wrapText(input, 80);
    expect(result).toBe('paragraph one\n\nparagraph two');
  });
});
