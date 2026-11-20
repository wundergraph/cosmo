import { Kind, parse, type FieldNode, type GraphQLSchema, type SelectionSetNode } from 'graphql';
import { MUTATION, SUBSCRIPTION } from '../utils/string-constants';
import { type RootTypeName } from '../utils/types';
import { type InternalSubgraph } from '../subgraph/types';
import { getValueOrDefault } from '../utils/utils';
import { type Graph } from './graph';
import { type Edge, type GraphNode } from './graph-nodes';

type ProvidedField = {
  id: number;
  subgraph: string;
  typeName: string;
  fieldName: string;
  next?: ProvidedField;
};

type Binding = { context: string; selection: SelectionSetNode };

function parseSelection(source: string): SelectionSetNode {
  const definition = parse(source).definitions[0];
  if (definition.kind !== Kind.OPERATION_DEFINITION) throw new Error('Expected a normalized field selection.');
  return definition.selectionSet;
}

type Candidate = { subgraph: string; edge: Edge };
type State = {
  typeName: string;
  nodes: Set<GraphNode>;
  contexts: Set<Binding>;
  provided: Set<ProvidedField>;
  path: string;
  blockedRoute?: string;
};

// During an internal selection only the projections actually required by a nested field need evaluation.
type SelectionState = State & { parent?: SelectionState; rootField?: string };

// Index the normalized @provides paths. A subgraph can supply an external field on that path,
// even when the ordinary resolver for the field requires a context that is unavailable.
function indexProvisions(subgraphs: Map<string, InternalSubgraph>) {
  const provisions = new Map<string, ProvidedField[]>();
  let id = 0;
  for (const subgraph of subgraphs.values()) {
    for (const [field, conditions] of subgraph.conditionalFieldDataByCoords) {
      for (const { fieldCoordinatesPath } of conditions.providedBy) {
        let next: ProvidedField | undefined;
        for (let i = fieldCoordinatesPath.length - 1; i > 0; i--) {
          // Abstract selections may have a more specific terminal coordinate on the implementation.
          const coord = i === fieldCoordinatesPath.length - 1 ? field : fieldCoordinatesPath[i];
          const [typeName, fieldName] = coord.split('.');
          next = { id: id++, subgraph: subgraph.name, typeName, fieldName, next };
        }
        if (next) getValueOrDefault(provisions, `${subgraph.name}.${fieldCoordinatesPath[0]}`, () => []).push(next);
      }
    }
  }
  return provisions;
}

// Ordinary resolvability can reuse results across paths reaching the same entity. For contexts,
// each distinct set of strict ancestors and available subgraph resolvers must be checked.
export function validateContextPaths(
  graph: Graph,
  subgraphs: Map<string, InternalSubgraph>,
  concreteTypes: Map<string, Set<string>>,
  clientSchema?: GraphQLSchema,
): Error[] {
  const requirements = new Map<string, Binding[]>();
  const bindingsByName = new Map<string, Map<string, Binding>>();
  const providers = new Map<string, Set<string>>();
  const fieldSets = new Map<string, SelectionSetNode>();
  for (const subgraph of subgraphs.values()) {
    for (const config of subgraph.configurationDataByTypeName.values()) {
      for (const arg of config.contextArguments ?? []) {
        if (!config.fieldNames.has(arg.fieldName)) continue;
        const context = `${subgraph.name}.${arg.contextName}`;
        const selections = getValueOrDefault(bindingsByName, context, () => new Map<string, Binding>());
        const binding = getValueOrDefault(selections, arg.selectionSet, () => ({
          context,
          selection: parseSelection(arg.selectionSet),
        }));
        getValueOrDefault(requirements, `${subgraph.name}.${arg.typeName}.${arg.fieldName}`, () => []).push(binding);
      }
      for (const provider of config.contextProviders ?? []) {
        for (const type of concreteTypes.get(provider.typeName) ?? [provider.typeName]) {
          getValueOrDefault(providers, type, () => new Set()).add(`${subgraph.name}.${provider.contextName}`);
        }
      }
    }
  }
  if (!requirements.size) return [];
  for (const subgraph of subgraphs.values()) {
    for (const [typeName, config] of subgraph.configurationDataByTypeName) {
      for (const requirement of config.requires ?? []) {
        fieldSets.set(
          `${subgraph.name}.${typeName}.${requirement.fieldName}`,
          parseSelection(`{ ${requirement.selectionSet} }`),
        );
      }
    }
  }

  const provisions = indexProvisions(subgraphs);
  const pending: State[] = [];
  const visited = new Map<string, Set<Binding>[]>();
  const errors = new Map<string, Error>();
  // A state fixes the reachable nodes, provisions and ancestor bindings. Cache successful
  // selections only: an active cycle may have temporarily ruled out an alternative resolver.
  const verifiedSelections = new WeakMap<SelectionState, Set<SelectionSetNode>>();

  const nestedStates = new WeakMap<SelectionState, Map<string, SelectionState>>();

  function expandEntityNodes(nodes: Set<GraphNode>) {
    for (const node of nodes) {
      for (const edge of node.entityEdges) nodes.add(edge.node);
    }
  }

  function resolverStateKey(nodes: Set<GraphNode>, provided: Set<ProvidedField>, blocked: boolean) {
    return JSON.stringify([
      [...nodes].map((node) => node.nodeName).sort(),
      [...provided].map((p) => p.id).sort(),
      blocked,
    ]);
  }

  function nestedState(state: SelectionState, typeName: string, nodes: Set<GraphNode>, provided: Set<ProvidedField>) {
    // Only a context provider changes the ancestor consulted by a nested prerequisite.
    // Keep the public entry state as the outer scope, preserving its inherited bindings.
    const scope = providers.has(state.typeName) ? state : (state.parent ?? state);
    let children = nestedStates.get(scope);
    if (!children) {
      children = new Map();
      nestedStates.set(scope, children);
    }
    expandEntityNodes(nodes);
    return getValueOrDefault(children, resolverStateKey(nodes, provided, false), () => ({
      ...state,
      typeName,
      nodes,
      provided,
      parent: scope,
    }));
  }

  function candidatesFor(state: State, field: string): Candidate[] {
    if (!state.nodes.size) {
      const edges =
        graph.rootNodeByTypeName.get(state.typeName as RootTypeName)?.headToSharedTailEdges.get(field) ?? [];
      return edges.map((edge) => ({ edge, subgraph: edge.node.subgraphName }));
    }
    const candidates: Candidate[] = [];
    for (const node of state.nodes) {
      const edge = node.headToTailEdges.get(field);
      if (edge) candidates.push({ edge, subgraph: node.subgraphName });
    }
    return candidates;
  }

  function canProject(state: SelectionState, binding: Binding, active: Set<SelectionSetNode>): boolean {
    if (active.has(binding.selection)) return false;
    // A root-specific projection can override the common projection of an interface it implements.
    const exact = binding.selection.selections.find(
      (s) => s.kind === Kind.INLINE_FRAGMENT && s.typeCondition?.name.value === state.typeName,
    );
    const set = exact?.kind === Kind.INLINE_FRAGMENT ? exact.selectionSet : binding.selection;
    return canSelect(state, set, new Set(active).add(binding.selection));
  }

  function hasContext(state: SelectionState, binding: Binding, active: Set<SelectionSetNode>): boolean {
    // Internal prerequisites do not visit every public field. Evaluate just this binding on the
    // nearest internal ancestor that redeclares it, then fall back to the public path's bindings.
    for (let ancestor = state.parent; ancestor; ancestor = ancestor.parent) {
      if (providers.get(ancestor.typeName)?.has(binding.context)) return canProject(ancestor, binding, active);
    }
    return state.contexts.has(binding);
  }

  // Bind each projection independently. An ancestor can supply its public id even if a hidden
  // projection needs a resolver or an earlier context that is unavailable on this path.
  function bindContexts(state: SelectionState, active: Set<SelectionSetNode>): Set<Binding> {
    const names = providers.get(state.typeName);
    if (!names) return state.contexts;
    const inherited = new Set(state.contexts);
    for (const name of names) {
      for (const binding of bindingsByName.get(name)?.values() ?? []) {
        if (canProject(state, binding, active)) {
          inherited.add(binding);
        } else {
          inherited.delete(binding);
        }
      }
    }
    return inherited;
  }

  function matchesRootField(state: SelectionState, field: FieldNode): boolean {
    if (state.rootField !== field.name.value) return false;
    const root = state.typeName === MUTATION ? clientSchema?.getMutationType() : clientSchema?.getSubscriptionType();
    // Clients can vary a public argument. The projection must work for every
    // legal operation on this path, even if one particular literal would match.
    // Normalization removes literals equivalent to immutable subgraph defaults.
    return !field.arguments?.length && !root?.getFields()[state.rootField]?.args.length;
  }

  // A prerequisite may be inaccessible to clients. Fetch its fields using the same resolver
  // choices, entity transitions and @provides paths as an ordinary field.
  function canSelect(
    state: SelectionState,
    set: SelectionSetNode,
    active: Set<SelectionSetNode>,
    missing?: Set<string>,
  ): boolean {
    let verified = verifiedSelections.get(state);
    if (!verified) {
      verified = new Set<SelectionSetNode>();
      verifiedSelections.set(state, verified);
    }
    if (verified.has(set)) return true;
    for (const selection of set.selections) {
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        const condition = selection.typeCondition?.name.value;
        if (condition && condition !== state.typeName && !concreteTypes.get(condition)?.has(state.typeName)) continue;
        if (!canSelect(state, selection.selectionSet, active, missing)) return false;
        continue;
      }
      if (selection.kind !== Kind.FIELD) return false;
      const field = selection.name.value;
      if (field === '__typename') continue;
      // A hidden selection must never execute another mutation or subscribe to a second stream.
      if (!state.nodes.size && state.rootField && !matchesRootField(state, selection)) return false;
      const result = resolveField(state, field, true, active);
      if (!result.resolved) {
        for (const context of result.missing) missing?.add(context);
        return false;
      }
      if (!selection.selectionSet) continue;
      for (const [typeName, nodes] of result.nextNodes) {
        if (
          !canSelect(
            nestedState(state, typeName, nodes, result.nextProvisions),
            selection.selectionSet,
            active,
            missing,
          )
        )
          return false;
      }
    }
    verified.add(set);
    return true;
  }

  function resolveField(state: SelectionState, field: string, internal: boolean, active: Set<SelectionSetNode>) {
    const { typeName, provided } = state;
    const coord = `${typeName}.${field}`;
    const nextNodes = new Map<string, Set<GraphNode>>();
    const nextProvisions = new Set<ProvidedField>();
    const missing = new Set<string>();
    let resolved = false;
    let abstract = false;
    for (const { edge, subgraph } of candidatesFor(state, field)) {
      if (!internal && edge.isEdgeInaccessible()) continue;
      const owner = `${subgraph}.${coord}`;
      const matches = [...provided].filter(
        (p) =>
          subgraph === p.subgraph &&
          field === p.fieldName &&
          (typeName === p.typeName || concreteTypes.get(p.typeName)?.has(typeName)),
      );
      const supplied = matches.some((p) => !p.next);
      const config = subgraphs.get(subgraph)?.configurationDataByTypeName.get(typeName);
      if (!supplied && !config?.fieldNames.has(field)) continue;
      if (!supplied) {
        const unmet = (requirements.get(owner) ?? []).filter((binding) => !hasContext(state, binding, active));
        if (unmet.length) {
          for (const binding of unmet) missing.add(binding.context);
          continue;
        }
        const required = fieldSets.get(owner);
        if (required) {
          // Cyclic prerequisites cannot supply their own value. Other owners may still resolve the field.
          if (active.has(required)) continue;
          // A public alternative can satisfy the path only if its own prerequisites
          // are reachable, including those with no context dependencies.
          const unavailable = new Set<string>();
          if (!canSelect(state, required, new Set(active).add(required), unavailable)) {
            for (const context of unavailable) missing.add(context);
            continue;
          }
        }
      }
      resolved = true;
      if (edge.node.isLeaf) continue;
      for (const p of matches) {
        if (p.next) nextProvisions.add(p.next);
      }
      for (const p of provisions.get(owner) ?? []) nextProvisions.add(p);
      if (edge.node.isAbstract) {
        abstract = true;
        for (const impl of edge.node.headToTailEdges.values()) {
          if (internal || !impl.isEdgeInaccessible())
            getValueOrDefault(nextNodes, impl.node.typeName, () => new Set()).add(impl.node);
        }
      } else {
        getValueOrDefault(nextNodes, edge.node.typeName, () => new Set()).add(edge.node);
      }
    }
    return { resolved, missing, nextNodes, nextProvisions, abstract };
  }

  function advance(state: State, fields: Iterable<string>) {
    const active = new Set<SelectionSetNode>();
    let inherited: Set<Binding> | undefined;
    for (const field of fields) {
      const path = `${state.path}.${field}`;
      const coord = `${state.typeName}.${field}`;
      const { resolved, missing, nextNodes, nextProvisions, abstract } = resolveField(state, field, false, active);
      const blockedRoute = missing.size
        ? `A resolver for "${coord}" requires an ancestor providing context ${[...missing].join(', ')}.`
        : state.blockedRoute;
      if (!resolved && blockedRoute && !errors.has(coord)) {
        errors.set(coord, new Error(`The path "${path}" cannot be satisfied. ${blockedRoute}`));
      }
      if (!nextNodes.size) continue;
      const contexts =
        !state.nodes.size && (state.typeName === SUBSCRIPTION || state.typeName === MUTATION)
          ? bindContexts({ ...state, rootField: field }, active)
          : (inherited ??= bindContexts(state, active));
      for (const [typeName, nodes] of nextNodes) {
        pending.push({
          typeName,
          nodes,
          contexts,
          provided: nextProvisions,
          path: abstract ? `${path} ... on ${typeName}` : path,
          blockedRoute,
        });
      }
    }
  }

  for (const root of graph.rootNodeByTypeName.values()) {
    const state: State = {
      typeName: root.typeName,
      nodes: new Set(),
      contexts: new Set(),
      provided: new Set(),
      path: root.typeName,
    };
    advance(state, root.fieldDataByName.keys());
  }
  for (let i = 0; i < pending.length; i++) {
    const state = pending[i];
    expandEntityNodes(state.nodes);
    const key = resolverStateKey(state.nodes, state.provided, !!state.blockedRoute);
    // A path that works with fewer contexts can use the same resolvers with additional contexts.
    const checked = getValueOrDefault(visited, key, () => []);
    if (checked.some((contexts) => contexts.isSubsetOf(state.contexts))) continue;
    checked.push(state.contexts);
    const fields = new Set<string>();
    for (const node of state.nodes) {
      for (const field of node.fieldDataByName.keys()) fields.add(field);
    }
    advance(state, fields);
  }
  return [...errors.values()];
}
