import * as protobufjs from 'protobufjs';
import { expect } from 'vitest';

/**
 * Validates a Protocol Buffer text definition using protobufjs
 *
 * @param protoText Protocol Buffer text definition
 * @throws Error if the protocol buffer definition is invalid
 */
export function validateProtoDefinition(protoText: string): void {
  // Create a root instance
  const root = new protobufjs.Root();

  // Load the common wrappers into the root
  root.loadSync('google/protobuf/wrappers.proto');

  // Use protobufjs to parse the text without writing to a file
  const parsedRoot = protobufjs.parse(protoText, root).root;

  // Verify the root is loaded by forcing resolution
  parsedRoot.resolveAll();
}

/**
 * Vitest-friendly utility to expect valid protocol buffer definition
 *
 * @param protoText Protocol Buffer text definition
 */
export function expectValidProto(protoText: string): void {
  expect(() => validateProtoDefinition(protoText)).not.toThrow();
}

/**
 * Loads proto text into a protobufjs Root
 *
 * @param protoText - The proto text to load
 * @returns A protobufjs Root
 */
export function loadProtoFromText(protoText: string): protobufjs.Root {
  const root = new protobufjs.Root();
  protobufjs.parse(protoText, root, { keepCase: true });
  return root;
}

/**
 * Gets field numbers from a message
 *
 * @param root - The protobufjs Root
 * @param messageName - The name of the message
 * @returns A record of field names to field numbers
 */
export function getFieldNumbersFromMessage(root: protobufjs.Root, messageName: string): Record<string, number> {
  const message = root.lookupType(messageName);
  const fieldNumbers: Record<string, number> = {};

  for (const field of Object.values(message.fields)) {
    fieldNumbers[field.name] = field.id;
  }

  return fieldNumbers;
}

/**
 * Gets enum values and their assigned numbers
 *
 * @param root - The protobufjs Root
 * @param enumName - The name of the enum
 * @returns A record of enum value names to their assigned numbers
 */
export function getEnumValuesWithNumbers(root: protobufjs.Root, enumName: string): Record<string, number> {
  try {
    const enumType = root.lookupEnum(enumName);
    const valueNumbers: Record<string, number> = {};

    for (const [name, value] of Object.entries(enumType.values)) {
      valueNumbers[name] = value as number;
    }

    return valueNumbers;
  } catch (error) {
    console.error(`Error getting enum values for ${enumName}:`, error);
    return {};
  }
}

/**
 * Gets service methods with their order from a loaded proto
 * @param root The loaded proto root
 * @param serviceName The name of the service to extract methods from
 * @returns Array of method names in order
 */
export function getServiceMethods(root: any, serviceName: string): string[] {
  const service = root.lookup(serviceName);
  if (!service || !service.methods) {
    return [];
  }

  return Object.keys(service.methods);
}

/**
 * Gets reserved field numbers from a message
 * @param root The loaded proto root
 * @param messageName The name of the message to extract reserved numbers from
 * @returns Array of reserved field numbers or empty array if none
 */
export function getReservedNumbers(root: any, typeName: string, isEnum = false): number[] {
  const type = root.lookup(typeName);
  if (!type) {
    return [];
  }

  return (
    type.reserved?.map((range: any) => {
      if (typeof range === 'number') {
        return range;
      } else if (range.start === range.end) {
        return range.start;
      }
      // For ranges, just return the start for simplicity
      return range.start;
    }) || []
  );
}

/**
 * Gets message content as a structured object
 * @param root The loaded proto root
 * @param messageName The name of the message to extract
 * @returns Object with field definitions and reserved numbers
 */
export function getMessageContent(
  root: any,
  messageName: string,
): {
  fields: Record<string, number>;
  reserved: number[];
} {
  return {
    fields: getFieldNumbersFromMessage(root, messageName),
    reserved: getReservedNumbers(root, messageName),
  };
}

/**
 * Gets enum content as a structured object
 * @param root The loaded proto root
 * @param enumName The name of the enum to extract
 * @returns Object with enum values and reserved numbers
 */
export function getEnumContent(
  root: any,
  enumName: string,
): {
  values: Record<string, number>;
  reserved: number[];
} {
  return {
    values: getEnumValuesWithNumbers(root, enumName),
    reserved: getReservedNumbers(root, enumName, true),
  };
}
