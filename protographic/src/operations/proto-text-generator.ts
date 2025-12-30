import protobuf from 'protobufjs';
import { buildProtoOptions } from '../proto-options.js';
import { MethodWithIdempotency } from '../types.js';

/**
 * Helper to format indentation
 */
function formatIndent(indent: number, content: string): string {
  return '  '.repeat(indent) + content;
}

/**
 * Options for generating proto text
 */
export interface ProtoTextOptions {
  /** Package name for the proto file */
  packageName?: string;
  /** Go package option */
  goPackage?: string;
  /** Java package option */
  javaPackage?: string;
  /** Java outer classname option */
  javaOuterClassname?: string;
  /** Java multiple files option */
  javaMultipleFiles?: boolean;
  /** C# namespace option */
  csharpNamespace?: string;
  /** Ruby package option */
  rubyPackage?: string;
  /** PHP namespace option */
  phpNamespace?: string;
  /** PHP metadata namespace option */
  phpMetadataNamespace?: string;
  /** Objective-C class prefix option */
  objcClassPrefix?: string;
  /** Swift prefix option */
  swiftPrefix?: string;
  /** Additional imports to include */
  imports?: string[];
  /** Additional options to include */
  options?: string[];
  /** Whether to include comments */
  includeComments?: boolean;
}

/**
 * Converts a protobufjs Root to Protocol Buffer text definition
 *
 * @param root - The protobufjs Root object containing all definitions
 * @param options - Optional configuration for text generation
 * @returns The proto text as a string
 */
export function rootToProtoText(root: protobuf.Root, options?: ProtoTextOptions): string {
  const lines: string[] = generateHeader(root, options);

  // Generate service definitions
  for (const nested of Object.values(root.nestedArray)) {
    if (nested instanceof protobuf.Service) {
      lines.push(...serviceToProtoText(nested, options));
    }
  }

  // Generate message definitions
  for (const nested of Object.values(root.nestedArray)) {
    if (nested instanceof protobuf.Type) {
      lines.push(...messageToProtoText(nested, options));
    }
  }

  // Generate enum definitions
  for (const nested of Object.values(root.nestedArray)) {
    if (nested instanceof protobuf.Enum) {
      lines.push(...enumToProtoText(nested, options));
    }
  }

  return lines.join('\n');
}

/**
 * Generates the proto file header (syntax, package, imports, options)
 */
function generateHeader(root: protobuf.Root, options?: ProtoTextOptions): string[] {
  const lines: string[] = [];

  // Syntax declaration
  lines.push('syntax = "proto3";');

  // Package declaration
  const packageName = options?.packageName || 'service.v1';
  lines.push(`package ${packageName};`);
  lines.push('');

  // Imports
  const imports = new Set<string>();

  // Check if any field uses graphql_variable_name option
  if (detectGraphQLVariableNameUsage(root)) {
  	imports.add('com/wundergraph/connectrpc/options/v1/annotations.proto');
  }

  // Only add wrapper types import if actually used
  if (detectWrapperTypeUsage(root)) {
    imports.add('google/protobuf/wrappers.proto');
  }

  // Add custom imports
  if (options?.imports) {
    options.imports.forEach((imp) => imports.add(imp));
  }

  for (const imp of Array.from(imports).sort()) {
    lines.push(`import "${imp}";`);
  }

  if (imports.size > 0) {
    lines.push('');
  }

  // Extension is now imported from com/wundergraph/connectrpc/options/v1/annotations.proto
  // No need to define it inline

  // Options - use shared utility for standard options
  const protoOptions: string[] = buildProtoOptions(
    {
      goPackage: options?.goPackage,
      javaPackage: options?.javaPackage,
      javaOuterClassname: options?.javaOuterClassname,
      javaMultipleFiles: options?.javaMultipleFiles,
      csharpNamespace: options?.csharpNamespace,
      rubyPackage: options?.rubyPackage,
      phpNamespace: options?.phpNamespace,
      phpMetadataNamespace: options?.phpMetadataNamespace,
      objcClassPrefix: options?.objcClassPrefix,
      swiftPrefix: options?.swiftPrefix,
    },
    packageName,
  );

  // Add any custom options
  if (options?.options) {
    protoOptions.push(...options.options);
  }

  if (protoOptions.length > 0) {
    lines.push(...protoOptions);
    lines.push('');
  }

  return lines;
}

/**
 * Converts a protobuf Service to proto text
 */
export function serviceToProtoText(service: protobuf.Service, options?: ProtoTextOptions): string[] {
  const lines: string[] = [];

  // Only include service comment if there's an actual custom comment
  if (options?.includeComments && service.comment) {
    lines.push(`// ${service.comment}`);
  }

  lines.push(`service ${service.name} {`);

  // Sort methods for consistent output
  const methods = Object.values(service.methods).sort((a, b) => a.name.localeCompare(b.name));

  for (let i = 0; i < methods.length; i++) {
    const method = methods[i];

    // Add blank line between methods for readability
    if (i > 0) {
      lines.push('');
    }

    if (options?.includeComments && method.comment) {
      lines.push(formatIndent(1, `// ${method.comment}`));
    }

    // Build method signature with streaming support
    const requestPart = method.requestStream ? `stream ${method.requestType}` : method.requestType;
    const responsePart = method.responseStream ? `stream ${method.responseType}` : method.responseType;

    // Check if method has idempotency level option
    const methodWithIdempotency = method as MethodWithIdempotency;
    const idempotencyLevel = methodWithIdempotency.idempotencyLevel;

    if (idempotencyLevel) {
      lines.push(formatIndent(1, `rpc ${method.name}(${requestPart}) returns (${responsePart}) {`));
      lines.push(formatIndent(2, `option idempotency_level = ${idempotencyLevel};`));
      lines.push(formatIndent(1, `}`));
    } else {
      lines.push(formatIndent(1, `rpc ${method.name}(${requestPart}) returns (${responsePart}) {}`));
    }
  }

  lines.push('}');
  lines.push('');

  return lines;
}

/**
 * Converts a protobuf Type (message) to proto text
 */
export function messageToProtoText(message: protobuf.Type, options?: ProtoTextOptions, indent: number = 0): string[] {
  const lines: string[] = [];

  // Message comment
  if (options?.includeComments && message.comment) {
    lines.push(formatIndent(indent, `// ${message.comment}`));
  }

  lines.push(formatIndent(indent, `message ${message.name} {`));

  // First, add nested types (messages and enums)
  for (const nested of Object.values(message.nestedArray)) {
    if (nested instanceof protobuf.Type) {
      const nestedLines = messageToProtoText(nested, options, indent + 1);
      lines.push(...nestedLines);
    } else if (nested instanceof protobuf.Enum) {
      const nestedLines = enumToProtoText(nested, options, indent + 1);
      lines.push(...nestedLines);
    }
  }

  // Then, add reserved declarations if any exist
  if (message.reserved && Array.isArray(message.reserved) && message.reserved.length > 0) {
    const reservedLines = formatReserved(message.reserved, indent + 1);
    lines.push(...reservedLines);
  }

  // Finally, add fields
  for (const field of message.fieldsArray) {
    lines.push(...formatField(field, options, indent + 1));
  }

  lines.push(formatIndent(indent, `}`));

  // Add blank line after top-level messages
  if (indent === 0) {
    lines.push('');
  }

  return lines;
}

/**
 * Converts a protobuf Enum to proto text
 */
export function enumToProtoText(enumType: protobuf.Enum, options?: ProtoTextOptions, indent: number = 0): string[] {
  const lines: string[] = [];

  // Enum comment
  if (options?.includeComments && enumType.comment) {
    lines.push(formatIndent(indent, `// ${enumType.comment}`));
  }

  lines.push(formatIndent(indent, `enum ${enumType.name} {`));

  // Add reserved declarations if any exist
  if (enumType.reserved && Array.isArray(enumType.reserved) && enumType.reserved.length > 0) {
    const reservedLines = formatReserved(enumType.reserved, indent + 1);
    lines.push(...reservedLines);
  }

  // Add enum values
  for (const [valueName, valueNumber] of Object.entries(enumType.values)) {
    lines.push(formatIndent(indent + 1, `${valueName} = ${valueNumber};`));
  }

  lines.push(formatIndent(indent, `}`));

  // Add blank line after top-level enums
  if (indent === 0) {
    lines.push('');
  }

  return lines;
}

/**
 * Formats a protobuf field as proto text
 */
export function formatField(field: protobuf.Field, options?: ProtoTextOptions, indent: number = 1): string[] {
  const lines: string[] = [];

  // Field comment
  if (options?.includeComments && field.comment) {
    lines.push(formatIndent(indent, `// ${field.comment}`));
  }

  // Build field line
  const repeated = field.repeated ? 'repeated ' : '';
  
  // Check if field has options
  if (field.options && Object.keys(field.options).length > 0) {
  	// Field with options - format with brackets
  	const optionsStr = Object.entries(field.options)
  		.map(([key, value]) => {
  			// The key already includes parentheses if it's an extension option
  			// e.g., "(cosmo.connectrpc.graphql_variable_name)"
  			// Handle string values with quotes
  			const formattedValue = typeof value === 'string' ? `"${value}"` : value;
  			return `${key} = ${formattedValue}`;
  		})
  		.join(', ');
  	lines.push(formatIndent(indent, `${repeated}${field.type} ${field.name} = ${field.id} [${optionsStr}];`));
  } else {
    // Field without options
    lines.push(formatIndent(indent, `${repeated}${field.type} ${field.name} = ${field.id};`));
  }

  return lines;
}

/**
 * Formats reserved field declarations from protobufjs reserved array
 *
 * The protobufjs reserved array can contain:
 * - Arrays [start, end] representing ranges (e.g., [2, 2] for single number, [5, 10] for range)
 * - Strings representing reserved field names
 *
 * This function separates them into proper proto3 reserved statements:
 * - reserved 2, 5 to 10;
 * - reserved "old_field", "deprecated_field";
 */
export function formatReserved(reserved: Array<number[] | string>, indent: number = 1): string[] {
  const lines: string[] = [];

  // Separate numbers and names
  const numbers: number[] = [];
  const names: string[] = [];

  for (const item of reserved) {
    if (typeof item === 'string') {
      names.push(item);
    } else if (Array.isArray(item) && item.length >= 2) {
      // Extract all numbers from the range [start, end]
      const [start, end] = item;
      for (let i = start; i <= end; i++) {
        numbers.push(i);
      }
    }
  }

  // Format reserved numbers if any
  if (numbers.length > 0) {
    const formattedNumbers = formatReservedNumbers(numbers);
    lines.push(formatIndent(indent, `reserved ${formattedNumbers};`));
  }

  // Format reserved names if any
  if (names.length > 0) {
    const formattedNames = names.map((name) => `"${name}"`).join(', ');
    lines.push(formatIndent(indent, `reserved ${formattedNames};`));
  }

  return lines;
}

/**
 * Formats a list of reserved field numbers into proto3 syntax
 * Handles both individual numbers and ranges (e.g., "2, 5 to 10, 15")
 */
function formatReservedNumbers(numbers: number[]): string {
  if (numbers.length === 0) return '';

  // Sort and deduplicate numbers
  const sortedNumbers = [...new Set(numbers)].sort((a, b) => a - b);

  // Simple case: only one number
  if (sortedNumbers.length === 1) {
    return sortedNumbers[0].toString();
  }

  // Find continuous ranges to compact the representation
  const ranges: Array<[number, number]> = [];
  let rangeStart = sortedNumbers[0];
  let rangeEnd = sortedNumbers[0];

  for (let i = 1; i < sortedNumbers.length; i++) {
    if (sortedNumbers[i] === rangeEnd + 1) {
      // Extend the current range
      rangeEnd = sortedNumbers[i];
    } else {
      // End the current range and start a new one
      ranges.push([rangeStart, rangeEnd]);
      rangeStart = sortedNumbers[i];
      rangeEnd = sortedNumbers[i];
    }
  }

  // Add the last range
  ranges.push([rangeStart, rangeEnd]);

  // Format the ranges
  return ranges
    .map(([start, end]) => {
      if (start === end) {
        return start.toString();
      } else {
        return `${start} to ${end}`;
      }
    })
    .join(', ');
}

/**
 * Detects if any message in the root uses Google Protocol Buffer wrapper types
 */
function detectWrapperTypeUsage(root: protobuf.Root): boolean {
  for (const nested of root.nestedArray) {
    if (nested instanceof protobuf.Type) {
      if (messageUsesWrapperTypes(nested)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recursively checks if a message or its nested messages use wrapper types
 */
function messageUsesWrapperTypes(message: protobuf.Type): boolean {
  // Check fields in this message
  for (const field of message.fieldsArray) {
    if (field.type.startsWith('google.protobuf.')) {
      return true;
    }
  }

  // Check nested messages recursively
  for (const nested of message.nestedArray) {
    if (nested instanceof protobuf.Type) {
      if (messageUsesWrapperTypes(nested)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detects if any field in the root uses the graphql_variable_name option
 */
function detectGraphQLVariableNameUsage(root: protobuf.Root): boolean {
  for (const nested of root.nestedArray) {
    if (nested instanceof protobuf.Type) {
      if (messageUsesGraphQLVariableName(nested)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recursively checks if a message or its nested messages use graphql_variable_name option
 */
function messageUsesGraphQLVariableName(message: protobuf.Type): boolean {
  // Check fields in this message
  for (const field of message.fieldsArray) {
    if (field.options && field.options['(graphql_variable_name)']) {
      return true;
    }
  }

  // Check nested messages recursively
  for (const nested of message.nestedArray) {
    if (nested instanceof protobuf.Type) {
      if (messageUsesGraphQLVariableName(nested)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Helper to format method definitions for services
 */
export function formatMethod(method: protobuf.Method, options?: ProtoTextOptions, indent: number = 1): string[] {
  const lines: string[] = [];

  // Method comment
  if (options?.includeComments && method.comment) {
    lines.push(formatIndent(indent, `// ${method.comment}`));
  }

  // Build method signature with streaming support
  const requestPart = method.requestStream ? `stream ${method.requestType}` : method.requestType;
  const responsePart = method.responseStream ? `stream ${method.responseType}` : method.responseType;

  lines.push(formatIndent(indent, `rpc ${method.name}(${requestPart}) returns (${responsePart}) {}`));

  return lines;
}
