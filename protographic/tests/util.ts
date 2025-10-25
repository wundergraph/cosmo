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
    // If that fails, try to convert verbose name to nested path
    // Strategy: Try different ways to split the name until one works

    // Find the FIRST occurrence of Response/Request suffix
    const responseIndex = messageName.indexOf('Response');
    const requestIndex = messageName.indexOf('Request');

    let splitIndex = -1;
    let suffix = '';
    if (responseIndex !== -1 && requestIndex !== -1) {
      splitIndex = Math.min(responseIndex, requestIndex);
      suffix = splitIndex === responseIndex ? 'Response' : 'Request';
    } else if (responseIndex !== -1) {
      splitIndex = responseIndex;
      suffix = 'Response';
    } else if (requestIndex !== -1) {
      splitIndex = requestIndex;
      suffix = 'Request';
    }

    if (splitIndex !== -1) {
      const baseName = messageName.substring(0, splitIndex + suffix.length);
      const nestedPart = messageName.substring(splitIndex + suffix.length);

      if (nestedPart) {
        // Try progressively longer first segments
        // For 'SearchUsersUsers', try:
        // 1. 'SearchUsersResponse.SearchUsersUsers' (no split)
        // 2. 'SearchUsersResponse.SearchUsers.Users' (split after SearchUsers)
        // 3. 'SearchUsersResponse.Search.Users.Users' (split after Search)

        // Try different ways to split the nested part
        // Strategy: Split at each capital letter and try all combinations

        // Find all capital letter positions
        const capitals: number[] = [];
        for (let i = 0; i < nestedPart.length; i++) {
          if (
            i === 0 ||
            (nestedPart[i] === nestedPart[i].toUpperCase() && nestedPart[i] !== nestedPart[i].toLowerCase())
          ) {
            capitals.push(i);
          }
        }

        // Try different groupings of these segments
        // For "SearchUsersUsers" with capitals at [0, 6, 11]:
        // - Try: "SearchUsersUsers" (no split)
        // - Try: "SearchUsers.Users" (split at position 6)
        // - Try: "Search.UsersUsers" (split at position 6 differently)
        // - Try: "Search.Users.Users" (split at both 6 and 11)

        const attempts: string[] = [];

        // No split - whole thing as one segment
        attempts.push(`${baseName}.${nestedPart}`);

        // Try splitting at each capital position
        for (let i = 1; i < capitals.length; i++) {
          const firstPart = nestedPart.substring(0, capitals[i]);
          const secondPart = nestedPart.substring(capitals[i]);
          attempts.push(`${baseName}.${firstPart}.${secondPart}`);

          // Also try further splits in the second part
          for (let j = i + 1; j < capitals.length; j++) {
            const thirdPart = secondPart.substring(capitals[j] - capitals[i]);
            const secondPartTrimmed = secondPart.substring(0, capitals[j] - capitals[i]);
            attempts.push(`${baseName}.${firstPart}.${secondPartTrimmed}.${thirdPart}`);
          }
        }

        // Try each attempt
        let found = false;
        for (const attempt of attempts) {
          try {
            message = root.lookupType(attempt);
            found = true;
            break;
          } catch {
            // Continue trying
          }
        }

        if (!found) {
          throw error;
        }
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

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
