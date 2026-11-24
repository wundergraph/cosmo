import {
  getNamedType,
  getNullableType,
  GraphQLList,
  KnownArgumentNamesRule,
  ProvidedRequiredArgumentsRule,
  TypeNameMetaFieldDef,
  UniqueArgumentNamesRule,
  UniqueInputFieldNamesRule,
  ValuesOfCorrectTypeRule,
  validate,
  valueFromAST,
  type FieldNode,
  visit,
  isTypeSubTypeOf,
  isLeafType,
  type GraphQLInputType,
  isAbstractType,
  isCompositeType,
  isListType,
  isObjectType,
  isUnionType,
  Kind,
  Lexer,
  Source,
  TokenKind,
  isInterfaceType,
  type FragmentDefinitionNode,
  parse,
  print,
  type ConstDirectiveNode,
  type GraphQLCompositeType,
  type GraphQLObjectType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type SelectionSetNode,
} from 'graphql';
import { isEqual } from 'lodash';

export type ContextProvider = { contextName: string; typeName: string } & (
  | { kind: 'concrete' }
  | { kind: 'abstract'; concreteTypeNames: string[] }
);

function providesRuntimeType(provider: ContextProvider, name: string): boolean {
  return provider.kind === 'concrete' ? provider.typeName === name : provider.concreteTypeNames.includes(name);
}

export type ContextArgument = {
  contextName: string;
  typeName: string;
  fieldName: string;
  argumentName: string;
  contextSelection: string;
};

function stringArgument(directive: ConstDirectiveNode, name: string): string {
  const value = directive.arguments?.find((arg) => arg.name.value === name)?.value;
  if (value?.kind !== Kind.STRING) throw new Error(`@${directive.name.value} requires a string "${name}" argument.`);
  return value.value;
}

function concreteTypes(schema: GraphQLSchema, type: GraphQLCompositeType): readonly GraphQLObjectType[] {
  return isAbstractType(type) ? schema.getPossibleTypes(type) : [type];
}

// Federation keeps each list dimension but permits null at every level of the projected value.
function projectType(parent: GraphQLOutputType, leaf: GraphQLOutputType): GraphQLOutputType {
  const type = getNullableType(parent);
  return isListType(type) ? new GraphQLList(projectType(type.ofType, leaf)) : leaf;
}

function selectedType(
  schema: GraphQLSchema,
  parent: GraphQLCompositeType,
  set: SelectionSetNode,
  referenced: Set<string>,
): GraphQLOutputType {
  const [node] = set.selections;
  if (set.selections.length !== 1 || node.kind !== Kind.FIELD || node.alias || node.directives?.length) {
    throw new Error('Expected one unaliased context field without directives.');
  }
  if (parent.astNode?.directives?.some((d) => d.name.value === 'interfaceObject'))
    throw new Error('Context selections cannot traverse @interfaceObject.');
  const name = node.name.value;
  const field = name === '__typename' ? TypeNameMetaFieldDef : !isUnionType(parent) && parent.getFields()[name];
  if (!field) throw new Error(`Unknown context field ${parent.name}.${name}.`);
  if (name !== '__typename') {
    referenced.add(`${parent.name}.${name}`);
    for (const concrete of concreteTypes(schema, parent)) referenced.add(`${concrete.name}.${name}`);
  }
  const base = getNamedType(field.type);
  if (node.selectionSet && isCompositeType(base))
    return projectType(field.type, selectedType(schema, base, node.selectionSet, referenced));
  if (node.selectionSet || !isLeafType(base)) throw new Error('Context selections must end at a leaf field.');
  return projectType(field.type, base);
}

function validateSelection(
  schema: GraphQLSchema,
  providers: ContextProvider[],
  set: SelectionSetNode,
  expected: GraphQLInputType,
  referenced: Set<string>,
) {
  visit(set, {
    Variable(node) {
      throw new Error(`Context field arguments must be literals. Found $${node.name.value}.`);
    },
  });
  const first = set.selections[0];
  const used = new Set<string>();
  for (const provider of providers) {
    const source = schema.getType(provider.typeName);
    if (!isCompositeType(source)) throw new Error(`Unknown context provider ${provider.typeName}.`);
    // A fragment supplies the provider type to GraphQL's argument and literal validation rules.
    const fragment: FragmentDefinitionNode = {
      kind: Kind.FRAGMENT_DEFINITION,
      name: { kind: Kind.NAME, value: 'ContextSelection' },
      typeCondition: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value: source.name } },
      selectionSet: set,
    };
    const errors = validate(schema, { kind: Kind.DOCUMENT, definitions: [fragment] }, [
      KnownArgumentNamesRule,
      ProvidedRequiredArgumentsRule,
      UniqueArgumentNamesRule,
      UniqueInputFieldNamesRule,
      ValuesOfCorrectTypeRule,
    ]);
    if (errors.length) throw errors[0];
    if (first.kind === Kind.FIELD) {
      if (!isTypeSubTypeOf(schema, selectedType(schema, source, set, referenced), expected))
        throw new Error(`Context selection cannot supply ${expected}.`);
      continue;
    }
    const seen = new Set<string>();
    for (const fragment of set.selections) {
      if (fragment.kind !== Kind.INLINE_FRAGMENT || fragment.directives?.length || !fragment.typeCondition)
        throw new Error('Expected an inline fragment on an object type.');
      const name = fragment.typeCondition.name.value;
      const type = schema.getType(name);
      if (!isObjectType(type)) throw new Error(`Context type condition ${name} must name an object type.`);
      if (!providesRuntimeType(provider, name)) continue;
      if (seen.has(name)) throw new Error(`Context selection must select one field for ${name}.`);
      seen.add(name);
      used.add(name);
      if (!isTypeSubTypeOf(schema, selectedType(schema, type, fragment.selectionSet, referenced), expected))
        throw new Error(`Context selection cannot supply ${expected}.`);
    }
    if (!seen.size) throw new Error(`No context branch matches ${provider.typeName}.`);
  }
  if (first.kind !== Kind.FIELD && used.size !== set.selections.length)
    throw new Error('A context type condition matches no provider.');
}

// A mutation or subscription can supply context from the current root field's
// payload. Omitting an argument equal to its coerced default denotes the same
// invocation, including defaults on input-object fields and singleton lists.
function canonicalRootSelection(
  schema: GraphQLSchema,
  providers: ContextProvider[],
  set: SelectionSetNode,
): SelectionSetNode {
  const roots = [schema.getMutationType(), schema.getSubscriptionType()].filter(
    (root): root is GraphQLObjectType => !!root && providers.some((p) => providesRuntimeType(p, root.name)),
  );
  if (!roots.length) return set;
  function omitDefaults(root: GraphQLObjectType, field: FieldNode): FieldNode {
    if (!field.arguments?.length) return field;
    const definitions = root.getFields()[field.name.value].args;
    const args = field.arguments.filter((arg) => {
      const def = definitions.find((d) => d.name === arg.name.value);
      return !def || def.defaultValue === undefined || !isEqual(def.defaultValue, valueFromAST(arg.value, def.type));
    });
    return args.length === field.arguments.length ? field : { ...field, arguments: args };
  }
  const first = set.selections[0];
  if (first.kind !== Kind.FIELD) {
    return {
      ...set,
      selections: set.selections.map((s) => {
        if (s.kind !== Kind.INLINE_FRAGMENT) return s;
        const root = roots.find((r) => r.name === s.typeCondition?.name.value);
        const [field] = s.selectionSet.selections;
        return root && field.kind === Kind.FIELD
          ? { ...s, selectionSet: { ...s.selectionSet, selections: [omitDefaults(root, field)] } }
          : s;
      }),
    };
  }
  if (!first.arguments?.length) return set;
  const fields = new Map<string, FieldNode>();
  for (const root of roots) {
    const field = omitDefaults(root, first);
    if (field !== first) fields.set(root.name, field);
  }
  if (!fields.size) return set;
  // Keep an abstract provider as a fallback: another subgraph can add concrete
  // implementations after this subgraph has been normalized.
  for (const p of providers) {
    if (!fields.has(p.typeName)) fields.set(p.typeName, first);
  }
  if (fields.size === 1) return { ...set, selections: [...fields.values()] };
  return {
    ...set,
    selections: [...fields].map(([value, field]) => ({
      kind: Kind.INLINE_FRAGMENT,
      typeCondition: { kind: Kind.NAMED_TYPE, name: { kind: Kind.NAME, value } },
      selectionSet: { kind: Kind.SELECTION_SET, selections: [field] },
    })),
  };
}

export function collectContexts(schema: GraphQLSchema, federatedTypeName = (name: string) => name) {
  const providers: ContextProvider[] = [];
  const argumentsFromContext: ContextArgument[] = [];
  const referenced = new Set<string>();
  const types = Object.values(schema.getTypeMap()).filter(isCompositeType);
  for (const type of types) {
    for (const directive of type.astNode?.directives ?? []) {
      if (directive.name.value !== 'context') continue;
      const contextName = stringArgument(directive, 'name');
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(contextName))
        throw new Error(`Invalid context name "${contextName}" on ${type.name}.`);
      // An interface object represents the federated interface; its implementations live in other subgraphs.
      const abstract = isAbstractType(type);
      const interfaceObject = type.astNode?.directives?.some((d) => d.name.value === 'interfaceObject');
      providers.push(
        abstract || interfaceObject
          ? {
              kind: 'abstract',
              contextName,
              typeName: type.name,
              concreteTypeNames: abstract ? schema.getPossibleTypes(type).map((t) => t.name) : [],
            }
          : { kind: 'concrete', contextName, typeName: type.name },
      );
    }
  }
  for (const directive of schema.getDirectives()) {
    if (directive.args.some((arg) => arg.astNode?.directives?.some((d) => d.name.value === 'fromContext'))) {
      throw new Error(`@fromContext cannot appear on arguments of directive @${directive.name}.`);
    }
  }
  for (const type of types.filter(isInterfaceType)) {
    for (const field of Object.values(type.getFields())) {
      if (field.args.some((arg) => arg.astNode?.directives?.some((d) => d.name.value === 'fromContext'))) {
        throw new Error(`@fromContext cannot appear on interface field ${type.name}.${field.name}.`);
      }
    }
  }
  for (const type of types.filter(isObjectType)) {
    for (const field of Object.values(type.getFields())) {
      for (const arg of field.args) {
        const directive = arg.astNode?.directives?.find((d) => d.name.value === 'fromContext');
        if (!directive) continue;
        try {
          if (arg.defaultValue !== undefined) throw new Error('A contextual argument cannot have a default value.');
          if (
            !type.astNode?.directives?.some(
              (d) =>
                d.name.value === 'key' &&
                !d.arguments?.some(
                  (a) => a.name.value === 'resolvable' && a.value.kind === Kind.BOOLEAN && !a.value.value,
                ),
            )
          ) {
            throw new Error('The receiving type must have a resolvable @key.');
          }
          const raw = stringArgument(directive, 'field');
          const lexer = new Lexer(new Source(raw));
          if (lexer.advance().kind !== TokenKind.DOLLAR) throw new Error('Expected a context reference.');
          const token = lexer.advance();
          if (token.kind !== TokenKind.NAME || !token.value) throw new Error('Expected a context name.');
          const contextName = token.value;
          const candidates = providers.filter((p) => p.contextName === contextName);
          if (!candidates.length) throw new Error(`Unknown context "${contextName}".`);
          const start = lexer.advance();
          const selection = raw.slice(start.start);
          const document = parse(
            start.kind === TokenKind.BRACE_L
              ? selection
              : `{ ${selection}
}`,
          );
          const def = document.definitions[0];
          if (document.definitions.length !== 1 || def.kind !== Kind.OPERATION_DEFINITION)
            throw new Error('Expected one context selection set.');
          // Federation checks required contextual arguments across all subgraphs.
          validateSelection(schema, candidates, def.selectionSet, getNullableType(arg.type), referenced);
          // Validation uses subgraph names. The planner evaluates the selection against the federated schema.
          const selectionSet = visit(canonicalRootSelection(schema, candidates, def.selectionSet), {
            NamedType(node) {
              const value = federatedTypeName(node.name.value);
              if (value !== node.name.value) return { ...node, name: { ...node.name, value } };
            },
          });
          argumentsFromContext.push({
            contextName,
            typeName: federatedTypeName(type.name),
            fieldName: field.name,
            argumentName: arg.name,
            contextSelection: print(selectionSet),
          });
        } catch (error) {
          throw new Error(
            `Invalid @fromContext on ${type.name}.${field.name}(${arg.name}:): ${(error as Error).message}`,
          );
        }
      }
    }
  }
  return {
    providers: providers.map((provider): ContextProvider => {
      const typeName = federatedTypeName(provider.typeName);
      return provider.kind === 'concrete'
        ? { ...provider, typeName }
        : { ...provider, typeName, concreteTypeNames: provider.concreteTypeNames.map(federatedTypeName).sort() };
    }),
    argumentsFromContext,
    referenced,
  };
}
