import * as protobufjs from 'protobufjs';

/**
 * Validates a Protocol Buffer text definition using protobufjs
 *
 * @param protoText Protocol Buffer text definition
 * @returns True if valid, false otherwise
 */
export function validateProtoDefinition(protoText: string): boolean {
  try {
    // Use protobufjs to parse the text without writing to a file
    const root = protobufjs.parse(protoText).root;

    // Verify the root is loaded by forcing resolution
    root.resolveAll();

    return true;
  } catch (error) {
    console.error('Proto validation error:', error);
    return false;
  }
}
