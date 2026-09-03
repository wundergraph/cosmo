/**
 * Composition workloads shared by the memory load test and the allocation profiler.
 *
 * All scenarios run against the built library (`dist/`), so run `pnpm build` first.
 * The demo subgraphs from `demo/pkg/subgraphs` are used as a realistic, small federated graph;
 * the `big*` scenarios generate a large synthetic graph to amplify per-composition costs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'graphql';

const here = dirname(fileURLToPath(import.meta.url));
const distPath = process.env.COMPOSITION_DIST ?? resolve(here, '../../dist/index.js');
const composition = await import(distPath);

const DEMO_SUBGRAPH_DIR = resolve(here, '../../../demo/pkg/subgraphs');
// These demo subgraphs are alternatives of the others (feature subgraphs) and do not compose together with them.
const EXCLUDED_DEMO_SUBGRAPHS = new Set(['employeeupdated', 'products_fg', 'test1']);

function readDemoSdls() {
  const sdlByName = new Map();
  for (const name of readdirSync(DEMO_SUBGRAPH_DIR)) {
    if (EXCLUDED_DEMO_SUBGRAPHS.has(name)) {
      continue;
    }
    const path = join(DEMO_SUBGRAPH_DIR, name, 'subgraph/schema.graphqls');
    try {
      sdlByName.set(name, readFileSync(path, 'utf8'));
    } catch {
      // not a subgraph directory
    }
  }
  return sdlByName;
}

export const demoSdlByName = readDemoSdls();

/**
 * Any directory of `*.graphql` subgraph SDL files (one subgraph per file, named after the file) can be used through
 * the `custom*` scenarios by setting COMPOSITION_SUBGRAPHS=/path/to/dir. This keeps real customer graphs out of the
 * repository while still allowing them to be load tested.
 */
function readCustomSdls() {
  const dir = process.env.COMPOSITION_SUBGRAPHS;
  if (!dir) {
    return new Map();
  }
  return new Map(
    readdirSync(dir)
      .filter((file) => /\.graphqls?$/.test(file))
      .map((file) => [file.replace(/\.graphqls?$/, ''), readFileSync(join(dir, file), 'utf8')]),
  );
}

export const customSdlByName = readCustomSdls();

/**
 * Simulates a publish to a federated graph with feature flags: the base composition plus one composition per feature
 * flag, in which one subgraph is replaced by a feature subgraph (the same SDL with an additional type and root field).
 * Each composition is a `federateSubgraphsWithContracts` call, exactly like the controlplane composes.
 */
export function featureFlagCompositions({ sdlByName, featureFlagCount = 3, retainResults = false, noLocation = true }) {
  const names = [...sdlByName.keys()];
  const results = [];
  for (let flag = 0; flag <= featureFlagCount; flag++) {
    const replaced = flag === 0 ? undefined : names[(flag - 1) % names.length];
    const subgraphs = names.map((name) => {
      let sdl = sdlByName.get(name);
      if (name === replaced) {
        sdl += `\ntype FeatureFlag${flag}Type { id: ID! }\nextend type Query { featureFlag${flag}Field: FeatureFlag${flag}Type }\n`;
      }
      return { name, url: `http://${name}:4000/graphql`, definitions: parse(sdl, { noLocation }) };
    });
    const result = assertSuccess(composition.federateSubgraphsWithContracts({ subgraphs, tagOptionsByContractName }));
    if (retainResults) {
      results.push(result);
    }
  }
  return results;
}

export function customSubgraphs({ noLocation = true } = {}) {
  if (customSdlByName.size < 1) {
    throw new Error('set COMPOSITION_SUBGRAPHS to a directory of *.graphql subgraph files to use the custom scenarios');
  }
  return [...customSdlByName].map(([name, sdl]) => ({
    name,
    url: `http://${name}:4000/graphql`,
    definitions: parse(sdl, { noLocation }),
  }));
}
export const demoSubgraphNames = [...demoSdlByName.keys()];

export function demoSubgraphs({ names = demoSubgraphNames, noLocation = true } = {}) {
  return names.map((name) => ({
    name,
    url: `http://${name}:4000/graphql`,
    definitions: parse(demoSdlByName.get(name), { noLocation }),
  }));
}

/**
 * Generates a synthetic graph of `subgraphCount` subgraphs, each defining `typeCount` entities with `fieldCount`
 * fields, including shared entities, interfaces, unions, enums, input types, and the most common directives.
 */
export function syntheticSubgraphs({ subgraphCount = 12, typeCount = 40, fieldCount = 12, salt = '' } = {}) {
  const subgraphs = [];
  for (let s = 0; s < subgraphCount; s++) {
    const nameOf = (t) => (t % 3 === 0 ? `Shared${salt}${t}` : `Entity${salt}${s}_${t}`);
    const unionMembers = Array.from({ length: Math.min(typeCount, 5) }, (_, t) => nameOf(t)).join(' | ');
    let sdl = `
      extend schema @link(url: "https://specs.apollo.dev/federation/v2.5", import: ["@key", "@shareable", "@tag", "@inaccessible", "@requires", "@provides", "@external", "@authenticated", "@requiresScopes", "@interfaceObject", "@override"])
      type Query {
        sg${s}Root(id: ID!, filter: Filter${s}): [${nameOf(1)}!]! @tag(name: "public")
        sg${s}Node(id: ID!): Node${s}
      }
      input Filter${s} { a: String b: Int = 3 c: [String!] }
      enum Status${s} { ACTIVE INACTIVE PENDING }
      interface Node${s} @key(fields: "id") { id: ID! name: String! }
      union Any${s} = ${unionMembers}
      scalar JSON${s}
    `;
    for (let t = 0; t < typeCount; t++) {
      const isShared = t % 3 === 0;
      const typeName = nameOf(t);
      const implementsClause = !isShared && t < 5 ? ` implements Node${s}` : '';
      sdl += `\n"""Type ${typeName} described in subgraph ${s}"""\n`;
      sdl += `type ${typeName}${implementsClause} @key(fields: "id") @tag(name: "${isShared ? 'internal' : 'public'}") {\n  id: ID!\n`;
      if (!isShared || s === 0) {
        sdl += `  name: String! @shareable\n`;
      }
      for (let f = 0; f < fieldCount; f++) {
        const fieldName = isShared ? `sg${s}Field${f}` : `field${f}`;
        switch (f % 6) {
          case 0:
            sdl += `  ${fieldName}(arg: Int = ${f}): String ${f % 2 ? '@tag(name: "internal")' : ''}\n`;
            break;
          case 1:
            sdl += `  ${fieldName}: [Status${s}!]! @deprecated(reason: "old")\n`;
            break;
          case 2:
            sdl += `  ${fieldName}: ${nameOf((t + 1) % typeCount)} @inaccessible\n`;
            break;
          case 3:
            sdl += `  ${fieldName}: JSON${s} @authenticated\n`;
            break;
          case 4:
            sdl += `  ${fieldName}: Int @requiresScopes(scopes: [["read:${typeName}"]])\n`;
            break;
          default:
            sdl += `  ${fieldName}: Any${s}\n`;
        }
      }
      sdl += `}\n`;
    }
    subgraphs.push({
      name: `subgraph-${s}`,
      url: `http://subgraph-${s}:4000/graphql`,
      definitions: parse(sdl, { noLocation: true }),
    });
  }
  return subgraphs;
}

export const tagOptionsByContractName = new Map([
  ['contract-public-only', composition.newContractTagOptionsFromArrays([], ['public'])],
  ['contract-no-internal', composition.newContractTagOptionsFromArrays(['internal'], [])],
  ['contract-no-public', composition.newContractTagOptionsFromArrays(['public'], [])],
]);

function assertSuccess(result) {
  if (!result.success) {
    throw new Error(
      'composition failed:\n' +
        result.errors
          .slice(0, 3)
          .map((error) => error.message)
          .join('\n'),
    );
  }
  return result;
}

export const scenarios = {
  // federateSubgraphs with the demo subgraphs (documents are re-parsed every iteration)
  base: () => assertSuccess(composition.federateSubgraphs({ subgraphs: demoSubgraphs() })),
  // the same, but the documents keep their source locations, which is how the controlplane parses subgraph SDL
  'base-locations': () =>
    assertSuccess(composition.federateSubgraphs({ subgraphs: demoSubgraphs({ noLocation: false }) })),
  // federateSubgraphsWithContracts with three contracts (the controlplane flow when publishing a subgraph)
  contracts: () =>
    assertSuccess(composition.federateSubgraphsWithContracts({ subgraphs: demoSubgraphs(), tagOptionsByContractName })),
  // federateSubgraphsContract (the controlplane flow when creating a new contract)
  contract: () =>
    assertSuccess(
      composition.federateSubgraphsContract({
        contractTagOptions: tagOptionsByContractName.get('contract-no-internal'),
        subgraphs: demoSubgraphs(),
      }),
    ),
  // a composition that fails (an @override conflict), to exercise the error path
  errors: () => {
    const result = composition.federateSubgraphs({
      subgraphs: demoSubgraphs({ names: [...demoSubgraphNames, 'products_fg'] }),
    });
    if (result.success) {
      throw new Error('expected the composition to fail');
    }
    return result;
  },
  // normalizeSubgraphFromString for each demo subgraph (the controlplane flow when checking a subgraph)
  normalize: () => {
    for (const sdlString of demoSdlByName.values()) {
      const result = composition.normalizeSubgraphFromString({ sdlString, noLocation: true });
      if (!result.success) {
        throw new Error(result.errors[0].message);
      }
    }
  },
  // federateSubgraphsWithContracts without any contract (the controlplane flow when publishing a subgraph of a
  // federated graph that has no contracts)
  'no-contracts': () =>
    assertSuccess(
      composition.federateSubgraphsWithContracts({ subgraphs: demoSubgraphs(), tagOptionsByContractName: new Map() }),
    ),
  // a different (smaller) synthetic graph on every iteration, so that nothing can be cached by type or subgraph name
  unique: (() => {
    let iteration = 0;
    return () =>
      assertSuccess(
        composition.federateSubgraphs({
          subgraphs: syntheticSubgraphs({ subgraphCount: 4, typeCount: 15, fieldCount: 8, salt: `U${iteration++}_` }),
        }),
      );
  })(),
  // the subgraphs in COMPOSITION_SUBGRAPHS, without, with zero, and with three contracts
  custom: () => assertSuccess(composition.federateSubgraphs({ subgraphs: customSubgraphs() })),
  'custom-locations': () =>
    assertSuccess(composition.federateSubgraphs({ subgraphs: customSubgraphs({ noLocation: false }) })),
  'custom-no-contracts': () =>
    assertSuccess(
      composition.federateSubgraphsWithContracts({
        subgraphs: customSubgraphs(),
        tagOptionsByContractName: new Map(),
      }),
    ),
  'custom-contracts': () =>
    assertSuccess(
      composition.federateSubgraphsWithContracts({ subgraphs: customSubgraphs(), tagOptionsByContractName }),
    ),
  // a publish with three feature flags and three contracts: 4 x federateSubgraphsWithContracts per iteration
  'custom-featureflags': () => featureFlagCompositions({ sdlByName: customSdlByName }),
  // the same, but all four results stay alive until the end of the iteration
  'custom-featureflags-retained': () => featureFlagCompositions({ sdlByName: customSdlByName, retainResults: true }),
  featureflags: () => featureFlagCompositions({ sdlByName: demoSdlByName }),
  'featureflags-retained': () => featureFlagCompositions({ sdlByName: demoSdlByName, retainResults: true }),
  // a large synthetic graph (12 subgraphs, 480 object types, ~5800 fields)
  big: () => assertSuccess(composition.federateSubgraphs({ subgraphs: syntheticSubgraphs() })),
  // the large synthetic graph with three contracts
  'big-contracts': () =>
    assertSuccess(
      composition.federateSubgraphsWithContracts({ subgraphs: syntheticSubgraphs(), tagOptionsByContractName }),
    ),
};

export function getScenario(name) {
  const scenario = scenarios[name];
  if (!scenario) {
    throw new Error(`unknown scenario "${name}"; expected one of: ${Object.keys(scenarios).join(', ')}`);
  }
  return scenario;
}
