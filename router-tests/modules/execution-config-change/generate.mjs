import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const schema = readFileSync('/fixtures/schema.graphql', 'utf8');
const composition = readFileSync('/fixtures/composition.yaml', 'utf8');
const directory = mkdtempSync(join(tmpdir(), 'execution-config-'));
const schemaForLanguage = (language) =>
  schema.replaceAll('@translate(language: "es")', `@translate(language: "${language}")`);
const changed = schemaForLanguage('it');
const languages = { german: 'de', french: 'fr' };
let flagged = composition + '\nfeature_flags:\n';
for (const [name, language] of Object.entries(languages)) {
  writeFileSync(join(directory, name + '.graphql'), schemaForLanguage(language));
  flagged += `  - name: ${name}
    feature_graphs:
      - name: greetings-${name}
        subgraph_name: greetings
        routing_url: http://subgraph:4001/${name}
        schema:
          file: ${name}.graphql
`;
}
const variants = [
  ['initial', schema, composition],
  ['changed', changed, composition],
  ['routing', changed, composition.replace('/graphql', '/alternate')],
  ['languages', schema, flagged],
  [
    'renamed',
    schema.replace('greeting: String! @translate(language: "es")', 'greeting: String!').replace('caption:', 'welcome:'),
    composition,
  ],
  [
    'overridden',
    schema,
    composition
      .replace('name: greetings', 'name: local-greetings')
      .replace('http://subgraph:4001/graphql', 'http://unreachable.invalid/graphql'),
  ],
  ['uncomposed', schema.replace('@composeDirective(name: "@translate")', ''), composition],
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
const changedConfig = load('changed');
assert.equal(initial.version, changedConfig.version, 'exercise the constant local composition version');
assert.ok(initial.engineConfig.graphqlClientSchema, '@tag must produce a separate client schema');
assert.ok(!initial.engineConfig.graphqlClientSchema.includes('translate'));
assert.ok(!load('uncomposed').engineConfig.graphqlSchema.includes('translate'));
assert.equal(load('routing').engineConfig.graphqlSchema, changedConfig.engineConfig.graphqlSchema);
assert.notEqual(load('routing').subgraphs[0].routingUrl, changedConfig.subgraphs[0].routingUrl);
assert.equal(load('overridden').subgraphs[0].routingUrl, 'http://unreachable.invalid/graphql');
assert.ok(!load('fallback').engineConfig.graphqlClientSchema, 'exercise the runtime client-schema fallback');
writeFileSync(
  '/data/invalid.json',
  JSON.stringify({
    ...changedConfig,
    version: 'rejected',
    engineConfig: { ...changedConfig.engineConfig, graphqlSchema: 'type Query {' },
  }),
);
writeFileSync('/data/active.json', JSON.stringify(initial));
console.log('wgc fixtures generated: composed directives survive; uncomposed/client-schema annotations are filtered.');
