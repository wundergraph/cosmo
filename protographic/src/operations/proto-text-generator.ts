import protobuf from 'protobufjs';

/**
 * Extended Method interface that includes custom properties
 */
interface MethodWithIdempotency extends protobuf.Method {
  idempotencyLevel?: 'NO_SIDE_EFFECTS' | 'DEFAULT';
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
  const lines: string[] = [];

  // Generate header
  lines.push(...generateHeader(options));

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
function generateHeader(options?: ProtoTextOptions): string[] {
  const lines: string[] = [];

  // Syntax declaration
  lines.push('syntax = "proto3";');

  // Package declaration
  const packageName = options?.packageName || 'service.v1';
  lines.push(`package ${packageName};`);
  lines.push('');

  // Imports
  const imports = new Set<string>();

  // Add default imports if using wrapper types
  imports.add('google/protobuf/wrappers.proto');

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

  // Options
  const protoOptions: string[] = [];

  if (options?.goPackage) {
    protoOptions.push(`option go_package = "${options.goPackage}";`);
  }

  if (options?.javaPackage) {
    protoOptions.push(`option java_package = "${options.javaPackage}";`);
  }

  if (options?.javaOuterClassname) {
    protoOptions.push(`option java_outer_classname = "${options.javaOuterClassname}";`);
  }

  if (options?.javaMultipleFiles) {
    protoOptions.push(`option java_multiple_files = true;`);
  }

  if (options?.csharpNamespace) {
    protoOptions.push(`option csharp_namespace = "${options.csharpNamespace}";`);
  }

  if (options?.rubyPackage) {
    protoOptions.push(`option ruby_package = "${options.rubyPackage}";`);
  }

  if (options?.phpNamespace) {
    protoOptions.push(`option php_namespace = "${options.phpNamespace}";`);
  }

  if (options?.phpMetadataNamespace) {
    protoOptions.push(`option php_metadata_namespace = "${options.phpMetadataNamespace}";`);
  }

  if (options?.objcClassPrefix) {
    protoOptions.push(`option objc_class_prefix = "${options.objcClassPrefix}";`);
  }

  if (options?.swiftPrefix) {
    protoOptions.push(`option swift_prefix = "${options.swiftPrefix}";`);
  }

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
      lines.push(`  // ${method.comment}`);
    }

    // Build method signature with streaming support
    let methodLine = `  rpc ${method.name}(`;

    if (method.requestStream) {
      methodLine += 'stream ';
    }

    methodLine += method.requestType;
    methodLine += ') returns (';

    if (method.responseStream) {
      methodLine += 'stream ';
    }

    methodLine += method.responseType;
    methodLine += ')';

    // Check if method has idempotency level option
    const methodWithIdempotency = method as MethodWithIdempotency;
    const idempotencyLevel = methodWithIdempotency.idempotencyLevel;
    if (idempotencyLevel) {
      methodLine += ' {';
      lines.push(methodLine);
      lines.push(`    option idempotency_level = ${idempotencyLevel};`);
      lines.push(`  }`);
    } else {
      methodLine += ' {}';
      lines.push(methodLine);
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
  const indentStr = '  '.repeat(indent);

  // Message comment
  if (options?.includeComments && message.comment) {
    lines.push(`${indentStr}// ${message.comment}`);
  }

  lines.push(`${indentStr}message ${message.name} {`);

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

  // Then, add fields
  for (const field of message.fieldsArray) {
    lines.push(...formatField(field, options, indent + 1));
  }

  lines.push(`${indentStr}}`);

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
  const indentStr = '  '.repeat(indent);

  // Enum comment
  if (options?.includeComments && enumType.comment) {
    lines.push(`${indentStr}// ${enumType.comment}`);
  }

  lines.push(`${indentStr}enum ${enumType.name} {`);

  // Add enum values
  for (const [valueName, valueNumber] of Object.entries(enumType.values)) {
    lines.push(`${indentStr}  ${valueName} = ${valueNumber};`);
  }

  lines.push(`${indentStr}}`);

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
  const indentStr = '  '.repeat(indent);

  // Field comment
  if (options?.includeComments && field.comment) {
    lines.push(`${indentStr}// ${field.comment}`);
  }

  // Build field line
  let fieldLine = indentStr;

  // Add repeated keyword if needed
  if (field.repeated) {
    fieldLine += 'repeated ';
  }

  // Add type and name
  fieldLine += `${field.type} ${field.name} = ${field.id};`;

  lines.push(fieldLine);

  return lines;
}

/**
 * Helper to format method definitions for services
 */
export function formatMethod(method: protobuf.Method, options?: ProtoTextOptions, indent: number = 1): string[] {
  const lines: string[] = [];
  const indentStr = '  '.repeat(indent);

  // Method comment
  if (options?.includeComments && method.comment) {
    lines.push(`${indentStr}// ${method.comment}`);
  }

  // Build method line
  let methodLine = `${indentStr}rpc ${method.name}(`;

  if (method.requestStream) {
    methodLine += 'stream ';
  }

  methodLine += method.requestType;
  methodLine += ') returns (';

  if (method.responseStream) {
    methodLine += 'stream ';
  }

  methodLine += method.responseType;
  methodLine += ') {}';

  lines.push(methodLine);

  return lines;
}
