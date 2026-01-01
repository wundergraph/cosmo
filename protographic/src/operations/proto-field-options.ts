/**
 * Protocol Buffer field option constants for ConnectRPC integration.
 *
 * These options are defined using `extend google.protobuf.FieldOptions` in generated proto files.
 */

export interface ProtoFieldOption {
  readonly fieldNumber: number;
  readonly optionName: string;
}

/**
 * Maps protobuf fields to GraphQL variable names when they don't match the expected format.
 * Field number 50001 is in the user-defined extension range.
 */
export const GRAPHQL_VARIABLE_NAME: ProtoFieldOption = {
  fieldNumber: 50001,
  optionName: '(graphql_variable_name)',
} as const;
