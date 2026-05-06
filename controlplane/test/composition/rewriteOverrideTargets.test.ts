import { describe, expect, test } from 'vitest';
import { rewriteOverrideTargets } from '../../src/core/composition/rewriteOverrideTargets.js';

describe('rewriteOverrideTargets', () => {
  test('rewrites a single override target', () => {
    const sdl = `
      type Employee @key(fields: "id") {
        id: ID!
        notes: String @override(from: "employees")
      }
    `;
    const result = rewriteOverrideTargets(
      sdl,
      new Map([['employees', 'p-16/a1__employees__rollout']]),
    );

    expect(result).not.toBe(sdl);
    expect(result).toContain('@override(from: "p-16/a1__employees__rollout")');
    expect(result).not.toContain('@override(from: "employees")');
  });

  test('rewrites multiple overrides on the same type, mixing matching and non-matching targets', () => {
    const sdl = `
      type Employee @key(fields: "id") {
        id: ID!
        notes: String @override(from: "employees")
        salary: Int @override(from: "payroll")
      }
    `;
    const result = rewriteOverrideTargets(
      sdl,
      new Map([['employees', 'employees__rollout']]),
    );

    expect(result).toContain('@override(from: "employees__rollout")');
    // payroll wasn't in the replacements map and must be left intact
    expect(result).toContain('@override(from: "payroll")');
  });

  test('returns the input unchanged when no override targets match the replacements', () => {
    const sdl = `
      type Employee @key(fields: "id") {
        id: ID!
        notes: String @override(from: "payroll")
      }
    `;
    const result = rewriteOverrideTargets(
      sdl,
      new Map([['employees', 'employees__rollout']]),
    );

    // Referential equality is part of the contract — callers depend on it
    // to skip cloning the surrounding DTO when nothing changed.
    expect(result).toBe(sdl);
  });

  test('returns the input unchanged when replacements is empty', () => {
    const sdl = `
      type Employee @key(fields: "id") {
        id: ID!
        notes: String @override(from: "employees")
      }
    `;
    const result = rewriteOverrideTargets(sdl, new Map());

    expect(result).toBe(sdl);
  });

  test('returns the input unchanged when SDL contains no @override at all', () => {
    const sdl = `
      type Query {
        hello: String!
      }
    `;
    const result = rewriteOverrideTargets(
      sdl,
      new Map([['employees', 'employees__rollout']]),
    );

    expect(result).toBe(sdl);
  });

  test('leaves @override with a non-string `from` argument alone', () => {
    // Federation requires `from` to be a string literal; this is purely a
    // defensive case to ensure we don't crash on weird SDL.
    const sdl = `
      type Employee @key(fields: "id") {
        id: ID!
        notes: String @override(from: 42)
      }
    `;
    // SDL with a non-string arg fails GraphQL parsing strictly, but if a
    // future variant of @override permitted other types we shouldn't crash —
    // assert the helper short-circuits to the input on parse failure.
    const result = rewriteOverrideTargets(
      sdl,
      new Map([['employees', 'employees__rollout']]),
    );
    expect(result).toBe(sdl);
  });

  test('rewrites multiple replacements in one pass', () => {
    const sdl = `
      type Employee @key(fields: "id") {
        id: ID!
        notes: String @override(from: "employees")
      }
      type Product @key(fields: "upc") {
        upc: ID!
        price: Int @override(from: "products")
      }
    `;
    const result = rewriteOverrideTargets(
      sdl,
      new Map([
        ['employees', 'employees__rollout'],
        ['products', 'products__rollout'],
      ]),
    );

    expect(result).toContain('@override(from: "employees__rollout")');
    expect(result).toContain('@override(from: "products__rollout")');
    expect(result).not.toContain('@override(from: "employees")');
    expect(result).not.toContain('@override(from: "products")');
  });

  test('ignores directives named `override` that are not the federation directive (no `from` argument)', () => {
    // Edge case: a custom directive that happens to be called `override`.
    // We only rewrite when there's a `from:` arg matching a replacement key,
    // so a no-arg call is left alone.
    const sdl = `
      directive @override on FIELD_DEFINITION
      type Query {
        hello: String! @override
      }
    `;
    const result = rewriteOverrideTargets(
      sdl,
      new Map([['employees', 'employees__rollout']]),
    );
    expect(result).toBe(sdl);
  });
});
