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
 * @param messagePath - The dot-notation path to the message (e.g., 'GetUserResponse.User' or 'UserInput')
 * @returns A record of field names to field numbers
 */
export function getFieldNumbersFromMessage(root: protobufjs.Root, messagePath: string): Record<string, number> {
  try {
    const message = root.lookupType(messagePath);
    const fieldNumbers: Record<string, number> = {};

    for (const field of Object.values(message.fields)) {
      fieldNumbers[field.name] = field.id;
    }

    return fieldNumbers;
  } catch (error) {
    // Provide helpful error message with available types
    const availableTypes = getAllNestedTypeNames(root);
    throw new Error(`Could not find message "${messagePath}". ` + `Available types: ${availableTypes.join(', ')}`);
  }
}

/**
 * Gets all nested type names from a root for debugging
 */
function getAllNestedTypeNames(root: protobufjs.Root): string[] {
  const names: string[] = [];

  function collectNames(obj: protobufjs.ReflectionObject, prefix: string = '') {
    if ('nested' in obj && obj.nested) {
      for (const [name, nested] of Object.entries(obj.nested)) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        names.push(fullName);
        collectNames(nested, fullName);
      }
    }
  }

  collectNames(root);
  return names;
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
export function getServiceMethods(root: protobufjs.Root, serviceName: string): string[] {
  const service = root.lookup(serviceName) as protobufjs.Service | null;
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
export function getReservedNumbers(root: protobufjs.Root, typeName: string, isEnum = false): number[] {
  const type = root.lookup(typeName) as protobufjs.Type | protobufjs.Enum | null;
  if (!type) {
    return [];
  }

  // Use the existing reserved property from protobufjs types
  if (!type.reserved) {
    return [];
  }

  const numbers: number[] = [];
  for (const range of type.reserved) {
    if (typeof range === 'string') {
      // Skip string reserved fields (field names)
      continue;
    }
    if (typeof range === 'number') {
      // Handle single numeric reserved tags (e.g., reserved 5;)
      numbers.push(range);
    } else if (Array.isArray(range)) {
      // Handle number arrays [start, end]
      if (range.length === 2) {
        const [start, end] = range;
        for (let i = start; i <= end; i++) {
          numbers.push(i);
        }
      } else {
        numbers.push(...range);
      }
    }
  }

  return numbers;
}

/**
 * Gets message content as a structured object
 * @param root The loaded proto root
 * @param messageName The name of the message to extract
 * @returns Object with field definitions and reserved numbers
 */
export function getMessageContent(
  root: protobufjs.Root,
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
  root: protobufjs.Root,
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
