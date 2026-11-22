import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import protobuf from 'protobufjs';
import { camelName, pascalName, renderType } from './model.js';
import type { ScalarName, Skipped, TypeReference } from './model.js';

/** A gRPC service described as the graph it becomes: one field per unary RPC, one type per message it reads or returns. */
export interface ProtoSourceModel {
  /** The first service in the file, which names the module by default. */
  serviceName: string;
  operations: ProtoOperation[];
  types: ProtoType[];
  inputs: ProtoType[];
  enums: ProtoEnum[];
  skipped: Skipped[];
}

export type RootType = 'Query' | 'Mutation';

export interface ProtoOperation {
  root: RootType;
  field: string;
  /** The full gRPC method, such as `/payroll.v1.PayrollService/GetSalary`. */
  method: string;
  arguments: ProtoField[];
  returns: TypeReference;
  /** Where the field's value is in the RPC's response. */
  result: { from: 'field'; field: string } | { from: 'message' } | { from: 'empty' };
}

export interface ProtoField {
  name: string;
  /** The field as the proto names it. */
  protoName: string;
  type: TypeReference;
  required: boolean;
}

export interface ProtoType {
  name: string;
  fields: ProtoField[];
}

export interface ProtoEnum {
  name: string;
  values: { name: string; protoName: string }[];
}

/** The verbs of an RPC name that read, so the RPC becomes a Query field. */
const readingVerbs = new Set([
  'Get',
  'List',
  'Search',
  'Find',
  'Lookup',
  'Query',
  'Count',
  'Fetch',
  'Read',
  'Describe',
]);

const scalars: Record<string, ScalarName> = {
  double: 'Float',
  float: 'Float',
  int32: 'Int',
  sint32: 'Int',
  sfixed32: 'Int',
  // Above the range of a GraphQL Int, exact as a Float.
  uint32: 'Float',
  fixed32: 'Float',
  // Above the range of a GraphQL Int and of a Float's exact integers; protojson writes them as strings.
  int64: 'String',
  uint64: 'String',
  sint64: 'String',
  fixed64: 'String',
  sfixed64: 'String',
  bool: 'Boolean',
  string: 'String',
  bytes: 'String',
};

/** Well-known types that protojson writes as one JSON value. */
const wellKnownScalars: Record<string, ScalarName> = {
  '.google.protobuf.Timestamp': 'String',
  '.google.protobuf.Duration': 'String',
  '.google.protobuf.DoubleValue': 'Float',
  '.google.protobuf.FloatValue': 'Float',
  '.google.protobuf.Int32Value': 'Int',
  '.google.protobuf.UInt32Value': 'Float',
  '.google.protobuf.Int64Value': 'String',
  '.google.protobuf.UInt64Value': 'String',
  '.google.protobuf.BoolValue': 'Boolean',
  '.google.protobuf.StringValue': 'String',
  '.google.protobuf.BytesValue': 'String',
};

const isIdentifier = (protoName: string): boolean => protoName === 'id' || protoName.endsWith('_id');

const constantCase = (name: string): string =>
  name
    .replaceAll(/([\da-z])([A-Z])/g, '$1_$2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase();

type Translated = { type: TypeReference } | { unsupported: string };

class Translator {
  readonly types = new Map<string, ProtoType>();
  readonly inputs = new Map<string, ProtoType>();
  readonly enums = new Map<string, ProtoEnum>();
  readonly skipped: Skipped[] = [];
  private readonly unusable = new Map<string, string>();

  constructor(private readonly packagePrefix: string) {}

  /** `.payroll.v1.Salary.Inner` becomes `SalaryInner`. */
  graphName(type: protobuf.ReflectionObject): string {
    const local = type.fullName.startsWith(this.packagePrefix)
      ? type.fullName.slice(this.packagePrefix.length)
      : type.fullName.slice(1);
    return local
      .split('.')
      .map((part) => pascalName(part))
      .join('');
  }

  private enumType(type: protobuf.Enum): Translated {
    const name = this.graphName(type);
    if (this.enums.has(name)) {
      return { type: { kind: 'enum', name } };
    }

    const prefix = `${constantCase(type.name)}_`;
    const named = Object.entries(type.values)
      .filter(([value, number]) => !(number === 0 && (value === 'UNSPECIFIED' || value.endsWith('_UNSPECIFIED'))))
      .map(([value]) => value);
    if (named.length === 0) {
      return { unsupported: `${name} has no value besides its unspecified zero` };
    }

    const stripPrefix = named.every(
      (value) => value.startsWith(prefix) && /^[A-Z_a-z]/.test(value.slice(prefix.length)),
    );
    this.enums.set(name, {
      name,
      values: named.map((value) => ({ name: stripPrefix ? value.slice(prefix.length) : value, protoName: value })),
    });
    return { type: { kind: 'enum', name } };
  }

  /** The type of a message, as an object type, or as an input type when `input` is set. */
  private messageType(type: protobuf.Type, input: boolean): Translated {
    const name = input ? `${this.graphName(type)}Input` : this.graphName(type);
    const registry = input ? this.inputs : this.types;
    const reason = this.unusable.get(name);
    if (reason !== undefined) {
      return { unsupported: reason };
    }
    if (registry.has(name)) {
      return { type: { kind: 'object', name } };
    }

    // Registered before its fields are read, so a message that contains itself refers to its own type.
    const translated: ProtoType = { name, fields: [] };
    registry.set(name, translated);
    translated.fields = this.fieldsOf(type, input);

    if (translated.fields.length === 0) {
      registry.delete(name);
      const unsupported = `${name} has no field that can become a GraphQL field`;
      this.unusable.set(name, unsupported);
      return { unsupported };
    }
    return { type: { kind: 'object', name } };
  }

  /** The fields of a message that have a GraphQL type; the others are listed as skipped. */
  fieldsOf(
    type: protobuf.Type,
    input: boolean,
    subjectOf = (field: string) => `${this.graphName(type)}${input ? 'Input' : ''}.${field}`,
  ): ProtoField[] {
    const fields: ProtoField[] = [];
    for (const field of type.fieldsArray) {
      const translated = this.fieldType(field, input);
      if ('unsupported' in translated) {
        this.skipped.push({ subject: subjectOf(field.name), reason: translated.unsupported });
        continue;
      }

      const list = translated.type.kind === 'list';
      // A request field is optional on the wire. A response scalar always has a value unless it can be absent.
      const required =
        !input && !list && translated.type.kind === 'scalar' && field.resolvedType === null && field.partOf === null;
      fields.push({ name: camelName(field.name), protoName: field.name, type: translated.type, required });
    }
    return fields;
  }

  private fieldType(field: protobuf.Field, input: boolean): Translated {
    if (field.map) {
      return { unsupported: 'maps are not generated' };
    }

    const single = this.singleType(field, input);
    if ('unsupported' in single || !field.repeated) {
      return single;
    }
    return { type: { kind: 'list', of: single.type } };
  }

  private singleType(field: protobuf.Field, input: boolean): Translated {
    const resolved = field.resolvedType;
    if (resolved === null) {
      const scalar = scalars[field.type];
      if (scalar === undefined) {
        return { unsupported: `${field.type} has no GraphQL type` };
      }
      return { type: { kind: 'scalar', name: scalar === 'String' && isIdentifier(field.name) ? 'ID' : scalar } };
    }

    if (resolved instanceof protobuf.Enum) {
      return this.enumType(resolved);
    }

    const wellKnown = wellKnownScalars[resolved.fullName];
    if (wellKnown !== undefined) {
      return { type: { kind: 'scalar', name: wellKnown === 'String' && isIdentifier(field.name) ? 'ID' : wellKnown } };
    }
    if (resolved.fullName.startsWith('.google.protobuf.')) {
      return { unsupported: `${resolved.fullName.slice(1)} has no GraphQL type` };
    }
    return this.messageType(resolved, input);
  }

  /** The value an RPC answers with: the one field of its response, or the response itself. */
  result(
    response: protobuf.Type,
  ): { returns: TypeReference; result: ProtoOperation['result'] } | { unsupported: string } {
    if (response.fullName === '.google.protobuf.Empty' || response.fieldsArray.length === 0) {
      return { returns: { kind: 'scalar', name: 'Boolean' }, result: { from: 'empty' } };
    }

    if (response.fieldsArray.length === 1) {
      const [field] = response.fieldsArray;
      const translated = this.fieldType(field, false);
      if ('unsupported' in translated) {
        return { unsupported: `its response field ${field.name}: ${translated.unsupported}` };
      }
      return { returns: translated.type, result: { from: 'field', field: field.name } };
    }

    const translated = this.messageType(response, false);
    if ('unsupported' in translated) {
      return translated;
    }
    return { returns: translated.type, result: { from: 'message' } };
  }
}

/** The root type an RPC's field goes on, and the field's name. */
const fieldOf = (method: protobuf.Method): { root: RootType; preferred: string; full: string } => {
  const name = pascalName(method.name);
  const verb = /^[A-Z][\da-z]*/.exec(name)?.[0] ?? '';
  const sideEffectFree = method.options?.idempotency_level === 'NO_SIDE_EFFECTS';
  const root: RootType = sideEffectFree || readingVerbs.has(verb) ? 'Query' : 'Mutation';
  const full = camelName(name);
  const preferred = root === 'Query' && verb === 'Get' && name.length > verb.length ? camelName(name.slice(3)) : full;
  return { root, preferred, full };
};

const parse = (text: string, location: string): Result<protobuf.Root> => {
  const root = new protobuf.Root();
  let parsed: protobuf.IParserResult;
  try {
    parsed = protobuf.parse(text, root, { keepCase: true });
  } catch (error) {
    return failWith({
      message: `${location} is not a proto file: ${error instanceof Error ? error.message : String(error)}`,
      input: location,
      remediation: 'Pass a proto2 or proto3 file with at least one service.',
    });
  }

  for (const imported of [...(parsed.imports ?? []), ...(parsed.weakImports ?? [])]) {
    const common = protobuf.common.get(imported);
    if (common === null) {
      return failWith({
        message: `${location} imports ${imported}. Only the google/protobuf well-known types can be imported.`,
        input: location,
        remediation: `Copy the definitions ${location} uses from ${imported} into it, or pass one file that holds the whole service.`,
      });
    }
    root.addJSON(common.nested ?? {});
  }

  try {
    root.resolveAll();
  } catch (error) {
    return failWith({
      message: `${location} refers to a type it does not define: ${error instanceof Error ? error.message : String(error)}`,
      input: location,
    });
  }
  return { success: true, data: root };
};

const servicesOf = (namespace: protobuf.NamespaceBase): protobuf.Service[] =>
  namespace.nestedArray.flatMap((nested) => {
    if (nested instanceof protobuf.Service) {
      return [nested];
    }
    if (nested instanceof protobuf.Namespace && !(nested instanceof protobuf.Type)) {
      return servicesOf(nested);
    }
    return [];
  });

/** Reads a proto file into the graph it becomes, listing everything it leaves out. */
export const readProto = (text: string, location: string): Result<ProtoSourceModel> => {
  const root = parse(text, location);
  if (!root.success) {
    return root;
  }

  const services = servicesOf(root.data).filter((service) => !service.fullName.startsWith('.google.protobuf.'));
  if (services.length === 0) {
    return failWith({
      message: `${location} defines no service.`,
      input: location,
      remediation: 'Pass the proto file that defines the gRPC service.',
    });
  }

  const packagePrefix = `${services[0].parent?.fullName ?? ''}.`;
  const translator = new Translator(packagePrefix);
  const operations: ProtoOperation[] = [];

  for (const service of services) {
    for (const method of service.methodsArray) {
      const methodPath = `${service.fullName.slice(1)}/${method.name}`;
      if (method.requestStream || method.responseStream) {
        translator.skipped.push({ subject: methodPath, reason: 'streaming RPCs are not generated' });
        continue;
      }

      const request = method.resolvedRequestType;
      const response = method.resolvedResponseType;
      if (request === null || response === null) {
        continue;
      }

      const result = translator.result(response);
      if ('unsupported' in result) {
        translator.skipped.push({ subject: methodPath, reason: result.unsupported });
        continue;
      }

      const { root, preferred, full } = fieldOf(method);
      const taken = new Set(
        operations.filter((operation) => operation.root === root).map((operation) => operation.field),
      );
      const field = taken.has(preferred) ? full : preferred;
      if (taken.has(field)) {
        translator.skipped.push({ subject: methodPath, reason: `another RPC already became ${root}.${field}` });
        continue;
      }

      operations.push({
        root,
        field,
        method: `/${methodPath}`,
        arguments: translator.fieldsOf(request, true, (field) => `${methodPath} argument ${field}`),
        returns: result.returns,
        result: result.result,
      });
    }
  }

  if (!operations.some((operation) => operation.root === 'Query')) {
    const reasons = translator.skipped.map((skipped) => `\n  ${skipped.subject}: ${skipped.reason}`).join('');
    return failWith({
      message: `${location} has no RPC that can become a query field.${reasons}`,
      input: location,
      remediation: `A subgraph needs at least one unary RPC that reads: one whose name starts with ${[...readingVerbs].join(', ')}, or that sets idempotency_level = NO_SIDE_EFFECTS.`,
    });
  }

  const model: ProtoSourceModel = {
    serviceName: services[0].name,
    operations,
    types: [...translator.types.values()],
    inputs: [...translator.inputs.values()],
    enums: [...translator.enums.values()],
    skipped: translator.skipped,
  };

  const names = ['Query', 'Mutation', ...[model.types, model.inputs, model.enums].flat().map((type) => type.name)];
  const clash = names.find((name, index) => names.indexOf(name) !== index);
  if (clash !== undefined) {
    return failWith({
      message: `${location} would define the GraphQL type ${clash} twice.`,
      input: location,
      remediation: `Rename the message or enum that becomes ${clash}. An input type is named after its message with Input appended.`,
    });
  }

  return { success: true, data: model };
};

/** Lists are never null and never hold nulls; a list argument defaults to empty, as an unset repeated field reads. */
const renderInput = (field: ProtoField): string =>
  `${field.name}: ${renderType(field.type, field.required)}${field.type.kind === 'list' ? ' = []' : ''}`;

const renderOperation = (operation: ProtoOperation): string => {
  const list =
    operation.arguments.length === 0 ? '' : `(${operation.arguments.map((field) => renderInput(field)).join(', ')})`;
  return `  ${operation.field}${list}: ${renderType(operation.returns, false)}`;
};

const renderRoot = (root: RootType, operations: ProtoOperation[]): string[] => {
  const fields = operations.filter((operation) => operation.root === root);
  if (fields.length === 0) {
    return [];
  }
  return [[`type ${root} {`, ...fields.map((operation) => renderOperation(operation)), '}'].join('\n')];
};

export const renderProtoSdl = (model: ProtoSourceModel): string => {
  const blocks = [
    ...renderRoot('Query', model.operations),
    ...renderRoot('Mutation', model.operations),
    ...model.types.map((type) =>
      [
        `type ${type.name} {`,
        ...type.fields.map((field) => `  ${field.name}: ${renderType(field.type, field.required)}`),
        '}',
      ].join('\n'),
    ),
    ...model.inputs.map((type) =>
      [`input ${type.name} {`, ...type.fields.map((field) => `  ${renderInput(field)}`), '}'].join('\n'),
    ),
    ...model.enums.map((type) =>
      [`enum ${type.name} {`, ...type.values.map((value) => `  ${value.name}`), '}'].join('\n'),
    ),
  ];
  return `${blocks.join('\n\n')}\n`;
};
