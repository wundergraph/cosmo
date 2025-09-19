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
 * Convert GraphQL variable type node to Protocol Buffer type using SCALAR_TYPE_MAP
 */
export function convertVariableTypeToProto(typeNode: any): string {
  if (typeNode.kind === 'NonNullType') {
    return convertVariableTypeToProto(typeNode.type);
  }

  if (typeNode.kind === 'ListType') {
    return `repeated ${convertVariableTypeToProto(typeNode.type)}`;
  }

  if (typeNode.kind === 'NamedType') {
    const typeName = typeNode.name.value;
    return SCALAR_TYPE_MAP[typeName] || 'string';
  }

  return 'string';
}