import {
  getNamedType,
  isCompositeType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  Kind,
  print,
} from 'graphql';
import type { FieldDefinitionNode, GraphQLField, GraphQLOutputType, GraphQLSchema } from 'graphql';
import type { LoadedSubgraph } from './subgraphs.js';
import type { Finding } from './findings.js';

export const paginationRule = 'pagination.forward-connection';

type QueryField = GraphQLField<unknown, unknown>;

const unwrapNonNull = (type: GraphQLOutputType): GraphQLOutputType => (isNonNullType(type) ? type.ofType : type);

/** A collection is a field that returns a list of objects, or a type named as a connection. */
const collectionNode = (field: QueryField): string | undefined => {
  const type = unwrapNonNull(field.type);
  if (isListType(type)) {
    const item = getNamedType(type);
    return isCompositeType(item) ? item.name : undefined;
  }

  const named = getNamedType(type);
  return named.name.endsWith('Connection') ? named.name.slice(0, -'Connection'.length) : undefined;
};

const hasArgument = (field: QueryField, name: string, type: string): boolean =>
  field.args.some((argument) => argument.name === name && argument.type.toString() === type);

/** `first: Int!, after: String` returning a connection of `edges { cursor node }` and `pageInfo { endCursor hasNextPage }`. */
const isForwardConnection = (field: QueryField): boolean => {
  const connection = unwrapNonNull(field.type);
  if (!isObjectType(connection) || !hasArgument(field, 'first', 'Int!') || !hasArgument(field, 'after', 'String')) {
    return false;
  }

  const { edges, pageInfo } = connection.getFields();
  if (edges === undefined || pageInfo === undefined || !isListType(unwrapNonNull(edges.type))) {
    return false;
  }

  const edge = getNamedType(edges.type);
  const page = getNamedType(pageInfo.type);
  if (!isObjectType(edge) || !isObjectType(page)) {
    return false;
  }

  const cursor = edge.getFields().cursor;
  const pageFields = page.getFields();
  return (
    cursor !== undefined &&
    isScalarType(getNamedType(cursor.type)) &&
    edge.getFields().node !== undefined &&
    pageFields.endCursor !== undefined &&
    pageFields.hasNextPage !== undefined
  );
};

interface Definition {
  file: string;
  node: FieldDefinitionNode;
}

/** Where a subgraph defines `<type>.<field>`, so a finding points at a file an agent can open. */
const findDefinition = (subgraphs: LoadedSubgraph[], typeName: string, fieldName: string): Definition | undefined => {
  for (const subgraph of subgraphs) {
    for (const definition of subgraph.document.definitions) {
      const isType = definition.kind === Kind.OBJECT_TYPE_DEFINITION || definition.kind === Kind.OBJECT_TYPE_EXTENSION;
      if (!isType || definition.name.value !== typeName) {
        continue;
      }

      const node = definition.fields?.find((field) => field.name.value === fieldName);
      if (node !== undefined) {
        return { file: subgraph.file, node };
      }
    }
  }

  return undefined;
};

const signatureOf = (node: FieldDefinitionNode): string => {
  const fieldArguments = (node.arguments ?? []).map((argument) => `${argument.name.value}: ${print(argument.type)}`);
  const list = fieldArguments.length === 0 ? '' : `(${fieldArguments.join(', ')})`;
  return `${list}: ${print(node.type)}`;
};

/**
 * Checks every collection on the query type of the consumer-visible schema. A field is classified by what
 * it returns, so renaming its arguments does not take it out of the rule.
 */
export const checkPagination = (schema: GraphQLSchema, subgraphs: LoadedSubgraph[]): Omit<Finding, 'severity'>[] => {
  const query = schema.getQueryType();
  if (!query) {
    return [];
  }

  const collections = Object.values(query.getFields()).filter((field) => collectionNode(field) !== undefined);
  const conforming = collections.find((field) => isForwardConnection(field));
  const example = conforming === undefined ? undefined : findDefinition(subgraphs, query.name, conforming.name);

  const findings: Omit<Finding, 'severity'>[] = [];
  for (const field of collections) {
    if (isForwardConnection(field)) {
      continue;
    }

    const coordinate = `${query.name}.${field.name}`;
    const definition = findDefinition(subgraphs, query.name, field.name);
    const line = definition?.node.loc?.startToken.line;
    const column = definition?.node.loc?.startToken.column;

    findings.push({
      rule: paginationRule,
      coordinate,
      message: 'Expose edges and PageInfo. Keep upstream paging inside the adapter.',
      ...(definition === undefined || line === undefined || column === undefined
        ? {}
        : { location: { file: definition.file, line, column } }),
      ...(definition === undefined ? {} : { found: signatureOf(definition.node) }),
      expected: `(first: Int!, after: String): ${collectionNode(field)}Connection!`,
      ...(conforming === undefined || example === undefined
        ? {}
        : { reference: { coordinate: `${query.name}.${conforming.name}`, file: example.file } }),
    });
  }

  return findings;
};
