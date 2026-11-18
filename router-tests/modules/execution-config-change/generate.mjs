import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const schema = readFileSync('/fixtures/schema.graphql', 'utf8');
const composition = readFileSync('/fixtures/composition.yaml', 'utf8');
const directory = mkdtempSync(join(tmpdir(), 'schema-hook-'));
const variants = [
  ['initial', schema, composition],
  ['changed', schema.replace('role: "reader"', 'role: "writer"'), composition],
  ['routing', schema.replace('role: "reader"', 'role: "writer"'), composition.replace('/graphql', '/alternate')],
  [
    'overridden',
    schema,
    composition
      .replace('name: policy', 'name: local-policy')
      .replace('http://subgraph:4001/graphql', 'http://unreachable.invalid/graphql'),
  ],
  ['uncomposed', schema.replace('@composeDirective(name: "@modulePolicy")', ''), composition],
  ['fallback', schema.replace(' @tag(name: "internal")', ''), composition],
];

for (const [name, sdl, input] of variants) {
  writeFileSync(join(directory, 'schema.graphql'), sdl);
  writeFileSync(join(directory, 'composition.yaml'), input);
  execFileSync(
    process.execPath,
    [
      '/workspace/cli/dist/src/index.js',
      'router',
      'compose',
      '--input',
      join(directory, 'composition.yaml'),
      '--out',
      `/data/${name}.json`,
      '--suppress-warnings',
    ],
    { stdio: 'inherit', env: { ...process.env, DO_NOT_TRACK: '1' } },
  );
}

const load = (name) => JSON.parse(readFileSync(`/data/${name}.json`, 'utf8'));
const initial = load('initial');
const changed = load('changed');
assert.equal(initial.version, changed.version, 'exercise the constant local composition version');
assert.match(initial.engineConfig.graphqlSchema, /@modulePolicy\(role: "reader"\)/);
assert.match(changed.engineConfig.graphqlSchema, /@modulePolicy\(role: "writer"\)/);
assert.ok(initial.engineConfig.graphqlClientSchema, '@tag must produce a separate client schema');
assert.ok(!initial.engineConfig.graphqlClientSchema.includes('modulePolicy'));
assert.ok(!load('uncomposed').engineConfig.graphqlSchema.includes('modulePolicy'));
assert.equal(load('routing').engineConfig.graphqlSchema, changed.engineConfig.graphqlSchema);
assert.notEqual(load('routing').subgraphs[0].routingUrl, changed.subgraphs[0].routingUrl);
assert.equal(load('overridden').subgraphs[0].routingUrl, 'http://unreachable.invalid/graphql');
assert.ok(!load('fallback').engineConfig.graphqlClientSchema, 'exercise the runtime client-schema fallback');
writeFileSync(
  '/data/invalid.json',
  JSON.stringify({
    ...changed,
    version: 'rejected',
    engineConfig: { ...changed.engineConfig, graphqlSchema: 'type Query {' },
  }),
);
writeFileSync('/data/active.json', JSON.stringify(initial));
console.log('wgc fixtures generated: composed directives survive; uncomposed/client-schema annotations are filtered.');
