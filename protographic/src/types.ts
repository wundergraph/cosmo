import protobuf from 'protobufjs';

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
