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
 * Gets method names in order from a service
 * 
 * @param root - The protobufjs Root
 * @param serviceName - The name of the service
 * @returns An array of method names
 */
export function getMethodsInOrder(root: protobufjs.Root, serviceName: string): string[] {
  const service = root.lookupService(serviceName);
  // Protobufjs doesn't preserve method order,
  // so we just return the keys which are in the order they were added
  const methods: string[] = Object.keys(service.methods);
  return methods;
}

/**
 * Extracts message names from proto text
 * 
 * @param protoText - The proto text to parse
 * @returns An array of message names
 */
export function debugProtoMessages(protoText: string): string[] {
  const lines = protoText.split('\n');
  return lines
    .filter((line) => line.startsWith('message '))
    .map((line) => line.replace('message ', '').replace(' {', ''));
}
