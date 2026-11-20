import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { answeringPrompts, runWgc, tempRepo } from './harness.js';

describe('wgc hub init', () => {
  test('writes one subgraph per detected schema file and a GitHub workflow when .github exists', async () => {
    const dir = await tempRepo({
      '.github/CODEOWNERS': '* @team\n',
      'services/products/schema.graphql': 'type Query { products: [String] }',
      'services/reviews.graphqls': 'type Query { reviews: [String] }',
      'node_modules/lib/ignored.graphql': 'type Query { a: Int }',
      'dist/ignored.graphql': 'type Query { a: Int }',
    });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--schema', 'shop', '--json']);

    expect(run.exitCode).toBe(0);
    expect(await readFile(path.join(dir, 'sandbox.yaml'), 'utf8')).toBe(
      [
        'schema: shop',
        'subgraphs:',
        '  - name: products',
        '    schema: services/products/schema.graphql',
        '  - name: reviews',
        '    schema: services/reviews.graphqls',
        '',
      ].join('\n'),
    );
    const workflow = await readFile(path.join(dir, '.github/workflows/hub-sandbox.yml'), 'utf8');
    expect(workflow).toContain('  pull_request:\n');
    expect(workflow).toContain('  id-token: write\n');
    expect(workflow).toContain('      - run: npm install --global wgc@latest\n      - run: wgc plugins install hub\n');
    expect(workflow).toContain(
      // eslint-disable-next-line no-template-curly-in-string
      '      - run: wgc hub schema push --json --sha ${{ github.event.pull_request.head.sha }}\n',
    );
    expect(run.json()).toMatchObject({
      ok: true,
      data: {
        ci: 'github',
        files: [
          { path: 'sandbox.yaml', action: 'created' },
          { path: '.github/workflows/hub-sandbox.yml', action: 'created' },
        ],
      },
    });
  });

  test('takes a generate command when there are no schema files', async () => {
    const dir = await tempRepo({ 'README.md': '# api\n' });

    const run = await runWgc([
      'hub',
      'init',
      '--dir',
      dir,
      '--schema',
      'shop',
      '--generate',
      'npm run --silent print-schema',
      '--ci',
      'none',
    ]);

    expect(run.exitCode).toBe(0);
    expect(await readFile(path.join(dir, 'sandbox.yaml'), 'utf8')).toBe(
      `schema: shop\nsubgraphs:\n  - name: ${path.basename(dir).toLowerCase()}\n    generate: npm run --silent print-schema\n`,
    );
    expect(existsSync(path.join(dir, '.github'))).toBe(false);
  });

  test('asks a human for the schema slug and generate command', async () => {
    const dir = await tempRepo({ 'README.md': '# api\n' });
    const prompts = answeringPrompts(['shop', 'go run ./cmd/schema']);

    const run = await runWgc(['hub', 'init', '--dir', dir, '--ci', 'none'], { caller: 'human', prompts });

    expect(run.exitCode).toBe(0);
    expect(prompts.asked).toEqual([
      'Hub schema slug (from the schema URL in Hub):',
      'No .graphql files found. Command that prints the subgraph SDL:',
    ]);
    expect(await readFile(path.join(dir, 'sandbox.yaml'), 'utf8')).toContain('    generate: go run ./cmd/schema\n');
  });

  test('fails for a non-human caller without schema files or --generate, naming the fix', async () => {
    const dir = await tempRepo({ 'README.md': '# api\n' });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--schema', 'shop', '--json']);

    expect(run.exitCode).toBe(2);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'USAGE_ERROR',
        message: `No .graphql or .graphqls files under ${dir}.`,
        input: dir,
        remediation:
          'Pass `--generate "<command that prints the SDL>"`, e.g. `--generate "npm run --silent print-schema"`.',
      },
    });
    expect(existsSync(path.join(dir, 'sandbox.yaml'))).toBe(false);
  });

  test('fails for a non-human caller without --schema', async () => {
    const dir = await tempRepo({ 'a.graphql': 'type Query { a: Int }' });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--json']);

    expect(run.exitCode).toBe(2);
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'USAGE_ERROR',
        message: 'No Hub schema slug given.',
        remediation: 'Pass `--schema <slug>`, the slug in the schema URL in Hub.',
      },
    });
  });

  test('leaves existing files on a rerun and overwrites them with --force', async () => {
    const dir = await tempRepo({ '.github/CODEOWNERS': '', 'a.graphql': 'type Query { a: Int }' });
    await runWgc(['hub', 'init', '--dir', dir, '--schema', 'shop']);
    await writeFile(path.join(dir, 'sandbox.yaml'), 'schema: edited\n');

    const rerun = await runWgc(['hub', 'init', '--dir', dir, '--schema', 'shop', '--json']);

    expect(rerun.json()).toMatchObject({
      data: {
        files: [
          { path: 'sandbox.yaml', action: 'kept' },
          { path: '.github/workflows/hub-sandbox.yml', action: 'kept' },
        ],
      },
    });
    expect(await readFile(path.join(dir, 'sandbox.yaml'), 'utf8')).toBe('schema: edited\n');

    const forced = await runWgc(['hub', 'init', '--dir', dir, '--schema', 'shop', '--force', '--json']);

    expect(forced.json()).toMatchObject({
      data: {
        files: [
          { path: 'sandbox.yaml', action: 'overwritten' },
          { path: '.github/workflows/hub-sandbox.yml', action: 'overwritten' },
        ],
      },
    });
    expect(await readFile(path.join(dir, 'sandbox.yaml'), 'utf8')).toBe(
      'schema: shop\nsubgraphs:\n  - name: a\n    schema: a.graphql\n',
    );
  });

  test('writes a GitLab snippet with an id_tokens entry for --ci gitlab, installing the wgcm this deployment serves', async () => {
    const dir = await tempRepo({ 'a.graphql': 'type Query { a: Int }' });

    const run = await runWgc(['hub', 'init', '--dir', dir, '--schema', 'shop', '--ci', 'gitlab', '--json'], {
      wgcInstallArgs: '--allow-remote=all https://hub.example.test/cli/wgc.tgz',
      command: 'wgcm',
    });

    expect(run.json()).toMatchObject({
      data: { ci: 'gitlab', files: [{ path: 'sandbox.yaml' }, { path: 'hub-sandbox.gitlab-ci.yml' }] },
    });
    const snippet = await readFile(path.join(dir, 'hub-sandbox.gitlab-ci.yml'), 'utf8');
    expect(snippet).toContain('  id_tokens:\n    HUB_ID_TOKEN:\n      aud: hub\n');
    expect(snippet).toContain(
      '    - npm install --global --allow-remote=all https://hub.example.test/cli/wgc.tgz\n    - wgcm plugins install hub\n    - wgcm hub schema push --json\n',
    );
    expect(existsSync(path.join(dir, '.github'))).toBe(false);
  });
});
