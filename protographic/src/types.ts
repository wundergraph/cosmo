import { ASTNode, GraphQLNamedType } from 'graphql';
import protobuf from 'protobufjs';

export type VisitContext<T extends ASTNode> = {
  node: T;
  key: string | number | undefined;
  parent: ASTNode | ReadonlyArray<ASTNode> | undefined;
  path: ReadonlyArray<string | number>;
  ancestors: ReadonlyArray<ASTNode | ReadonlyArray<ASTNode>>;
};

/**
 * Maps GraphQL scalar types to Protocol Buffer types
 *
 * GraphQL has a smaller set of primitive types compared to Protocol Buffers.
 * This mapping ensures consistent representation between the two type systems.
 */
export const SCALAR_TYPE_MAP: Record<string, string> = {
  ID: 'string', // GraphQL IDs map to Proto strings
  String: 'string', // Direct mapping
  Int: 'int32', // GraphQL Int is 32-bit signed
  Float: 'double', // Using double for GraphQL Float gives better precision
  Boolean: 'bool', // Direct mapping
};

/**
 * Maps GraphQL scalar types to Protocol Buffer wrapper types for nullable fields
 *
 * These wrapper types allow distinguishing between unset fields and zero values
 * in Protocol Buffers, which is important for GraphQL nullable semantics.
 */
export const SCALAR_WRAPPER_TYPE_MAP: Record<string, string> = {
  ID: 'google.protobuf.StringValue',
  String: 'google.protobuf.StringValue',
  Int: 'google.protobuf.Int32Value',
  Float: 'google.protobuf.DoubleValue',
  Boolean: 'google.protobuf.BoolValue',
};

/**
 * Protocol Buffer idempotency levels for RPC methods
 * @see https://protobuf.dev/reference/protobuf/google.protobuf/#idempotency-level
 */
export type IdempotencyLevel = 'NO_SIDE_EFFECTS' | 'DEFAULT';

/**
 * Extended Method interface that includes custom properties
 */
export interface MethodWithIdempotency extends protobuf.Method {
  idempotencyLevel?: IdempotencyLevel;
}

/**
 * Represents a gRPC method definition
 *
 * example: rpc GetUser(GetUserRequest) returns (GetUserResponse) {}
 */
export type RPCMethod = {
  name: string;
  request: string;
  response: string;
  description?: string | null;
};

/**
 * Represents a field in a proto message
 */
export interface ProtoMessageField {
  fieldName: string;
  typeName: string;
  fieldNumber: number;
  isRepeated?: boolean;
  description?: string;
  // The original name of the field in the GraphQL schema
  graphqlName?: string;

  /**
   * The composite type of the field. When building a proto message
   * this is used to create the composite type messages as nested messages.
   */
  compositeType?: CompositeMessageDefinition;
}

/**
 * Represents a proto message
 */
export interface ProtoMessage {
  messageName: string;
  reservedNumbers?: string;
  description?: string;
  fields: ProtoMessageField[];

  /**
   * Nested messages within this message (if any)
   * Example: message User {
   *  message Address {
   *    string street = 1;
   *    string city = 2;
   *    string state = 3;
   *    string zip = 4;
   *  }
   *  Address address = 1;
   */
  nestedMessages?: ProtoMessage[];
}

export interface ListWrapper {
  baseType: GraphQLNamedType;
  nestingLevel: number;
}

/**
 * Data structure for formatting message fields
 */
export type ProtoFieldType = {
  typeName: string;
  isWrapper: boolean;
  isRepeated: boolean;
  listWrapper?: ListWrapper;
};

export enum CompositeMessageKind {
  INTERFACE,
  UNION,
}

export type CompositeMessageDefinition = InterfaceMessageDefinition | UnionMessageDefinition;

export type InterfaceMessageDefinition = {
  kind: CompositeMessageKind.INTERFACE;
  description?: string;
  typeName: string;
  implementingTypes: string[];
};

export type UnionMessageDefinition = {
  kind: CompositeMessageKind.UNION;
  description?: string;
  typeName: string;
  memberTypes: string[];
};

export function isInterfaceMessageDefinition(
  message: CompositeMessageDefinition,
): message is InterfaceMessageDefinition {
  return message.kind === CompositeMessageKind.INTERFACE;
}

export function isUnionMessageDefinition(message: CompositeMessageDefinition): message is UnionMessageDefinition {
  return message.kind === CompositeMessageKind.UNION;
}
