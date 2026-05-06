import { type ArgumentNode, type DirectiveNode, Kind, parse, print, visit } from 'graphql';

/**
 * Rewrites `@override(from: "<oldName>")` -> `@override(from: "<newName>")`
 * for every (oldName -> newName) entry in `replacements`. Returns the input
 * SDL unchanged when no overrides match - callers can use referential
 * equality (`result === input`) to skip cloning the surrounding DTO.
 *
 * Used by the feature-flag composition path: when a feature subgraph
 * replaces a base subgraph by name in `getFeatureFlagRelatedSubgraphsToCompose`,
 * any sibling subgraph with `@override(from: "<base>")` would otherwise
 * become orphaned and trip a `@shareable` collision in the composer -
 * silently producing a router config with no `featureFlagConfigs` entry,
 * so the router falls back to `baseMux` and the rollout no-ops.
 *
 * Following the swap into other subgraphs' override targets preserves the
 * original semantics for the FF composition without touching the base
 * composition.
 *
 * Scope is intentionally bounded: federation v2's `@override` is the only
 * directive whose argument is a subgraph-name string. Other `String!`-typed
 * directive arguments (`@is(fields:)`, `@requestScoped(key:)`,
 * `@composeDirective(name:)`, `@tag(name:)`, etc.) reference fields, cache
 * keys, directive names, or tags - never subgraphs.
 */
export function rewriteOverrideTargets(schemaSDL: string, replacements: Map<string, string>): string {
  if (replacements.size === 0) {
    return schemaSDL;
  }

  let document;
  try {
    document = parse(schemaSDL);
  } catch {
    // Malformed SDL is a separate problem; let the composer surface the parse
    // error with its own context rather than fail-fast here.
    return schemaSDL;
  }

  let mutated = false;

  const rewritten = visit(document, {
    Directive(node: DirectiveNode) {
      if (node.name.value !== 'override') {
        return;
      }
      if (!node.arguments || node.arguments.length === 0) {
        return;
      }

      let directiveMutated = false;
      const newArguments = node.arguments.map((arg: ArgumentNode) => {
        if (arg.name.value !== 'from') {
          return arg;
        }
        if (arg.value.kind !== Kind.STRING) {
          return arg;
        }
        const replacement = replacements.get(arg.value.value);
        if (replacement === undefined) {
          return arg;
        }
        directiveMutated = true;
        return {
          ...arg,
          value: { ...arg.value, value: replacement },
        };
      });

      if (!directiveMutated) {
        return;
      }
      mutated = true;
      return { ...node, arguments: newArguments };
    },
  });

  return mutated ? print(rewritten) : schemaSDL;
}
