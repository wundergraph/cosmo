import protobuf from 'protobufjs';

/**
 * Extended Method interface that includes custom properties
 */
interface MethodWithIdempotency extends protobuf.Method {
  idempotencyLevel?: 'NO_SIDE_EFFECTS' | 'DEFAULT';
}

/**
 * Prefixes `content` with two spaces for each indentation level.
 *
 * @param indent - The number of indentation levels to apply
 * @param content - The string to prefix with indentation
 * @returns The input `content` prefixed with two spaces per indentation level
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
 * Convert a protobufjs Root into a Protocol Buffer text representation.
 *
 * @param root - The protobufjs Root containing services, messages, and enums to emit
 * @param options - Optional generation settings (package name, language-specific options, imports, and comment inclusion)
 * @returns The Protocol Buffer text representation of `root`
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
 * Build the top-of-file proto header including syntax, package, imports, and file-level options.
 *
 * @param options - Configuration for package name, language-specific options, additional imports, and whether to include comments
 * @returns An array of lines that form the proto file header (each entry is a single line)
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
 * Emit the Protocol Buffer service definition as lines of .proto text.
 *
 * @param service - The protobufjs Service to convert
 * @param options - Generation options; when `includeComments` is true, service and method comments are included
 * @returns An array of lines that together form the service block (including braces and a trailing blank line)
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
 * Produce proto text lines for a protobuf message and its nested definitions.
 *
 * @param message - The protobuf message type to convert
 * @param options - Generation options (package/layout overrides and includeComments)
 * @param indent - Indentation level (each level adds two spaces)
 * @returns An array of proto text lines representing the message, its nested types/enums, and fields; a trailing blank line is included when `indent` is 0
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

  // Then, add fields
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
 * Generate proto text lines for a protobuf enum.
 *
 * Emits the enum declaration, its values, and optionally the enum comment when `options.includeComments` is true.
 * If `indent` is 0, a trailing blank line is appended to the returned lines.
 *
 * @param enumType - The protobuf Enum to convert
 * @param options - Generation options; when `options.includeComments` is true and the enum has a comment, the comment is emitted above the enum
 * @param indent - Indentation level (each level equals two spaces) to apply to emitted lines
 * @returns An array of lines representing the enum in proto text form
 */
export function enumToProtoText(enumType: protobuf.Enum, options?: ProtoTextOptions, indent: number = 0): string[] {
  const lines: string[] = [];

  // Enum comment
  if (options?.includeComments && enumType.comment) {
    lines.push(formatIndent(indent, `// ${enumType.comment}`));
  }

  lines.push(formatIndent(indent, `enum ${enumType.name} {`));

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
 * Produce the proto text lines for a single protobuf field.
 *
 * Emits an optional comment line when `options?.includeComments` is true and the field has a comment,
 * then emits the field declaration (with `repeated` when applicable).
 *
 * @param field - The protobuf field to format
 * @param options - Generator options; when `includeComments` is true, `field.comment` will be emitted above the field
 * @param indent - Indentation level (two spaces per level) to apply to emitted lines
 * @returns An array of lines representing the field and any preceding comment suitable for inclusion in a .proto file
 */
export function formatField(field: protobuf.Field, options?: ProtoTextOptions, indent: number = 1): string[] {
  const lines: string[] = [];

  // Field comment
  if (options?.includeComments && field.comment) {
    lines.push(formatIndent(indent, `// ${field.comment}`));
  }

  // Build field line
  const repeated = field.repeated ? 'repeated ' : '';
  lines.push(formatIndent(indent, `${repeated}${field.type} ${field.name} = ${field.id};`));

  return lines;
}

/**
 * Produce proto text lines for an RPC method, including an optional leading comment and streaming indicators.
 *
 * @param method - The RPC method definition to format
 * @param options - Formatting options; when `includeComments` is true and `method.comment` exists, a comment line is emitted
 * @param indent - Indentation level (each level adds two spaces)
 * @returns Lines of proto text representing the `rpc` method signature and body; includes a leading comment line when comments are enabled
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
