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
 * Map field names to their numeric field IDs for the specified message.
 *
 * @param root - Protobuf root used to look up the message
 * @param messagePath - Dot-notation path to the message (e.g., "GetUserResponse.User" or "UserInput")
 * @returns A record mapping each field name to its field number
 * @throws Error if the message cannot be found; the error lists available nested type names
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
 * Collects fully-qualified nested type names from a protobuf root.
 *
 * @param root - The protobufjs Root to traverse
 * @returns A flat array of nested type names (e.g. `package.Message.NestedType`)
 */
function getAllNestedTypeNames(root: protobufjs.Root): string[] {
  const names: string[] = [];

  /**
   * Recursively traverses a protobuf ReflectionObject and appends each nested item's fully-qualified name to the outer-scope `names` array.
   *
   * @param obj - The ReflectionObject to traverse
   * @param prefix - Optional namespace prefix to prepend to discovered names; when provided, nested names are joined with `.` to form fully-qualified names
   */
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
 * Retrieve the method names of a service in their declaration order.
 *
 * @param root - The protobufjs Root that contains the service
 * @param serviceName - The fully-qualified name or lookup path of the service on the root
 * @returns Method names in the order they are declared on the service
 */
export function getServiceMethods(root: protobufjs.Root, serviceName: string): string[] {
  const service = root.lookup(serviceName) as protobufjs.Service | null;
  if (!service || !service.methods) {
    return [];
  }

  return Object.keys(service.methods);
}

/**
 * Collects reserved numeric field numbers defined on the specified message or enum in the given root.
 *
 * @param root - The protobufjs Root containing the type.
 * @param typeName - Fully-qualified name of the message or enum to inspect.
 * @param isEnum - If true, treat the named type as an enum; otherwise treat it as a message.
 * @returns All reserved numeric values for the type; an empty array if none or the type is not found.
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
    if (Array.isArray(range)) {
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
 * Retrieve field name-to-number mappings and reserved field numbers for a message type.
 *
 * @param root - The parsed protobuf root containing the message
 * @param messageName - The fully-qualified path or name of the message within the root
 * @returns An object with:
 *   - `fields`: a map from each field name to its numeric field id
 *   - `reserved`: an array of reserved field numbers for the message
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
 * Retrieve an enum's defined members and its reserved numeric identifiers.
 *
 * @param root - The protobuf Root containing the enum
 * @param enumName - The name or fully-qualified path of the enum to inspect
 * @returns An object with `values` mapping enum member names to their numeric values and `reserved` listing reserved numeric identifiers
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
