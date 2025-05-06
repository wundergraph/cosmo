import * as protobufjs from 'protobufjs';
import { expect } from 'vitest';

/**
 * Validates a Protocol Buffer text definition using protobufjs
 *
 * @param protoText Protocol Buffer text definition
 * @throws Error if the protocol buffer definition is invalid
 */
export function validateProtoDefinition(protoText: string): void {
  // Use protobufjs to parse the text without writing to a file
  const root = protobufjs.parse(protoText).root;

  // Verify the root is loaded by forcing resolution
  root.resolveAll();
}

/**
 * Vitest-friendly utility to expect valid protocol buffer definition
 *
 * @param protoText Protocol Buffer text definition
 */
export function expectValidProto(protoText: string): void {
  expect(() => validateProtoDefinition(protoText)).not.toThrow();
}
