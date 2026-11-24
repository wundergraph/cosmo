import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { answeringPrompts, runWgc, tempRepo } from './harness.js';

describe('wgc hub init', () => {
  test('writes wundergraph.yaml with one subgraph per detected schema file and no CI workflow', async () => {
    const dir = await tempRepo({
      '.github/CODEOWNERS': '* @team\n',
      'services/products/schema.graphql': 'type Query { products: [String] }',
      'services/reviews.graphqls': 'type Query { reviews: [String] }',
      'node_modules/lib/ignored.graphql': 'type Query { a: Int }',
      'dist/ignored.graphql': 'type Query { a: Int }',
    });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--graph', 'shop', '--json']);

    expect(run.exitCode).toBe(0);
    expect(await readFile(path.join(dir, 'wundergraph.yaml'), 'utf8')).toBe(
      [
        'graph: shop',
        'subgraphs:',
        '  - name: products',
        '    schema:',
        '      file: services/products/schema.graphql',
        '  - name: reviews',
        '    schema:',
        '      file: services/reviews.graphqls',
        '',
      ].join('\n'),
    );
    expect(await readdir(path.join(dir, '.github'))).toEqual(['CODEOWNERS']);
    expect((await readdir(dir)).sort()).toEqual(['.github', 'dist', 'node_modules', 'services', 'wundergraph.yaml']);
    expect(run.json()).toMatchObject({
      ok: true,
      data: { graph: 'shop', file: { path: 'wundergraph.yaml', action: 'created' } },
    });
  });

  test('says the CI workflow comes from connecting the repository in Hub', async () => {
    const dir = await tempRepo({ 'a.graphql': 'type Query { a: Int }' });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--graph', 'shop'], { output: 'text' });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(
      ['created wundergraph.yaml', '  a a.graphql', 'Connect this repository in Hub to get its CI workflow.', ''].join(
        '\n',
      ),
    );
  });

  test('takes a schema command when there are no schema files', async () => {
    const dir = await tempRepo({ 'README.md': '# api\n' });

    const run = await runWgc([
      'hub',
      'init',
      '--dir',
      dir,
      '--graph',
      'shop',
      '--command',
      'npm run --silent print-schema',
    ]);

    expect(run.exitCode).toBe(0);
    expect(await readFile(path.join(dir, 'wundergraph.yaml'), 'utf8')).toBe(
      `graph: shop\nsubgraphs:\n  - name: ${path.basename(dir).toLowerCase()}\n    schema:\n      command: npm run --silent print-schema\n`,
    );
  });

  test('asks a human for the graph and the schema command', async () => {
    const dir = await tempRepo({ 'README.md': '# api\n' });
    const prompts = answeringPrompts(['shop', 'go run ./cmd/schema']);

    const run = await runWgc(['hub', 'init', '--dir', dir], { caller: 'human', prompts });

    expect(run.exitCode).toBe(0);
    expect(prompts.asked).toEqual([
      'Federated graph name in Cosmo:',
      'No .graphql files found. Command that prints the subgraph SDL:',
    ]);
    expect(await readFile(path.join(dir, 'wundergraph.yaml'), 'utf8')).toContain(
      '    schema:\n      command: go run ./cmd/schema\n',
    );
  });

  test('fails for a non-human caller without schema files or --command, naming the fix', async () => {
    const dir = await tempRepo({ 'README.md': '# api\n' });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--graph', 'shop', '--json']);

    expect(run.exitCode).toBe(2);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'USAGE_ERROR',
        message: `No .graphql or .graphqls files under ${dir}.`,
        input: dir,
        remediation:
          'Pass `--command "<command that prints the SDL>"`, e.g. `--command "npm run --silent print-schema"`.',
      },
    });
    expect(existsSync(path.join(dir, 'wundergraph.yaml'))).toBe(false);
  });

  test('fails for a non-human caller without --graph', async () => {
    const dir = await tempRepo({ 'a.graphql': 'type Query { a: Int }' });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--json']);

    expect(run.exitCode).toBe(2);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'USAGE_ERROR',
        message: 'No federated graph given.',
        remediation: 'Pass `--graph <name>`, the name of the federated graph in Cosmo.',
      },
    });
  });

  test('keeps an existing wundergraph.yaml on a rerun and overwrites it with --force', async () => {
    const dir = await tempRepo({ 'a.graphql': 'type Query { a: Int }' });
    await runWgc(['hub', 'init', '--dir', dir, '--graph', 'shop']);
    await writeFile(path.join(dir, 'wundergraph.yaml'), 'graph: edited\n');

    const rerun = await runWgc(['hub', 'init', '--dir', dir, '--graph', 'shop', '--json']);

    expect(rerun.json()).toMatchObject({ data: { file: { path: 'wundergraph.yaml', action: 'kept' } } });
    expect(await readFile(path.join(dir, 'wundergraph.yaml'), 'utf8')).toBe('graph: edited\n');

    const forced = await runWgc(['hub', 'init', '--dir', dir, '--graph', 'shop', '--force', '--json']);

    expect(forced.json()).toMatchObject({ data: { file: { path: 'wundergraph.yaml', action: 'overwritten' } } });
    expect(await readFile(path.join(dir, 'wundergraph.yaml'), 'utf8')).toBe(
      'graph: shop\nsubgraphs:\n  - name: a\n    schema:\n      file: a.graphql\n',
    );
  });
});
