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
 * @param messageName - The name of the message (can be verbose like 'GetUserResponseUser' or nested path like 'GetUserResponse.User')
 * @returns A record of field names to field numbers
 */
export function getFieldNumbersFromMessage(root: protobufjs.Root, messageName: string): Record<string, number> {
  let message: protobufjs.Type;

  try {
    // Try direct lookup first (for flat names or already-correct paths)
    message = root.lookupType(messageName);
  } catch (error) {
    // Convert concatenated name to dot notation by trying different split strategies
    const convertedPath = convertConcatenatedNameToDotNotation(messageName, root);
    
    if (!convertedPath) {
      throw new Error(
        `Could not find message "${messageName}". ` +
        `Tried various path conversions but none matched. ` +
        `Available types: ${getAllNestedTypeNames(root).join(', ')}`
      );
    }
    
    try {
      message = root.lookupType(convertedPath);
    } catch {
      throw new Error(
        `Could not find message "${messageName}". ` +
        `Tried direct lookup and converted path "${convertedPath}". ` +
        `Available types: ${getAllNestedTypeNames(root).join(', ')}`
      );
    }
  }

  const fieldNumbers: Record<string, number> = {};

  for (const field of Object.values(message.fields)) {
    fieldNumbers[field.name] = field.id;
  }

  return fieldNumbers;
}

/**
 * Gets all nested type names from a root for debugging
 */
function getAllNestedTypeNames(root: protobufjs.Root): string[] {
  const names: string[] = [];
  
  function collectNames(obj: any, prefix: string = '') {
    if (obj.nested) {
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
 * Converts a concatenated message name to dot notation by trying to match against actual types
 *
 * @param name - Concatenated name like 'GetUserResponseUser'
 * @param root - The protobufjs root to check against
 * @returns Dot notation path like 'GetUserResponse.User' or null if not found
 */
function convertConcatenatedNameToDotNotation(name: string, root: protobufjs.Root): string | null {
  // Find Request or Response suffix
  const responseMatch = name.match(/^(.+?Response)(.+)$/);
  const requestMatch = name.match(/^(.+?Request)(.+)$/);
  
  const match = responseMatch || requestMatch;
  
  if (!match) {
    return null;
  }
  
  const [, base, nested] = match;
  
  if (!nested) {
    return null;
  }
  
  // Split at capital letters to get potential segments
  const segments = nested.split(/(?=[A-Z])/).filter(Boolean);
  
  // Generate all possible dot-notation paths and try each one
  const attempts = generatePathAttempts(base, segments);
  
  // Try each attempt and return the first one that exists
  for (const attempt of attempts) {
    try {
      root.lookupType(attempt);
      return attempt; // Found it!
    } catch {
      // Continue trying
    }
  }
  
  return null;
}

/**
 * Generates all reasonable path attempts for a given base and segments
 *
 * Examples:
 *   base='GetUserResponse', segments=['User', 'Profile', 'Settings']
 *   -> ['GetUserResponse.User.Profile.Settings', 'GetUserResponse.UserProfile.Settings', etc.]
 */
function generatePathAttempts(base: string, segments: string[]): string[] {
  const attempts: string[] = [];
  
  if (segments.length === 0) {
    return [];
  }
  
  if (segments.length === 1) {
    return [`${base}.${segments[0]}`];
  }
  
  if (segments.length === 2) {
    // Try both: 'Base.Seg1.Seg2' and 'Base.Seg1Seg2'
    attempts.push(`${base}.${segments[0]}.${segments[1]}`);
    attempts.push(`${base}.${segments.join('')}`);
    return attempts;
  }
  
  // For 3+ segments, try various groupings
  // Priority order: most specific (all separate) to least specific (all together)
  
  // 1. All segments separate: 'Base.A.B.C'
  attempts.push(`${base}.${segments.join('.')}`);
  
  // 2. Group first N-1, last separate: 'Base.AB.C'
  if (segments.length >= 2) {
    const firstPart = segments.slice(0, -1).join('');
    const lastPart = segments[segments.length - 1];
    attempts.push(`${base}.${firstPart}.${lastPart}`);
  }
  
  // 3. First separate, rest together: 'Base.A.BC'
  if (segments.length >= 2) {
    const firstPart = segments[0];
    const restPart = segments.slice(1).join('');
    attempts.push(`${base}.${firstPart}.${restPart}`);
  }
  
  // 4. All together: 'Base.ABC'
  attempts.push(`${base}.${segments.join('')}`);
  
  return attempts;
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
