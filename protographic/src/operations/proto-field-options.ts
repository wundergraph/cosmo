/**
 * Protocol Buffer field option constants for ConnectRPC integration.
 *
 * See proto/com/wundergraph/connectrpc/options/v1/annotations.proto for full documentation.
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
  optionName: '(wg.connectrpc.graphql_variable_name)',
} as const;
