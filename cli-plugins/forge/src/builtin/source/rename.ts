import { failWith } from '@wundergraph/wgc-plugin-sdk';
import type { Result } from '@wundergraph/wgc-plugin-sdk';
import type { SourceModel, TypeReference } from './model.js';
import type { ProtoSourceModel } from './proto.js';

/** A new name for a type, such as `Salary`, or for a root field, such as `Query.salary`. */
export interface Rename {
  coordinate: string;
  name: string;
}

const graphQLName = /^(?!__)[A-Z_a-z]\w*$/;

/** Names a renamed type cannot take. */
const reservedTypes = ['Query', 'Mutation', 'ID', 'String', 'Int', 'Float', 'Boolean'];

/** Reads each `--rename <coordinate>=<name>` value. */
export const parseRenames = (values: string[]): Result<Rename[]> => {
  const renames: Rename[] = [];
  for (const value of values) {
    const separator = value.indexOf('=');
    const coordinate = value.slice(0, separator).trim();
    const name = value.slice(separator + 1).trim();
    if (separator === -1 || coordinate === '' || name === '') {
      return failWith({
        message: `--rename ${value} is not <coordinate>=<name>.`,
        input: `--rename ${value}`,
        remediation:
          'Pass a type or a root field and its new name, for example --rename Salary=PayrollSalary or --rename Query.salary=payrollSalary.',
      });
    }
    if (!graphQLName.test(name)) {
      return failWith({
        message: `${name} is not a valid GraphQL name.`,
        input: `--rename ${value}`,
        remediation:
          'Pass a name of letters, digits and underscores that starts with a letter or an underscore, but not with two underscores.',
      });
    }
    if (renames.some((rename) => rename.coordinate === coordinate)) {
      return failWith({
        message: `${coordinate} is renamed twice.`,
        input: `--rename ${value}`,
        remediation: `Pass one --rename for ${coordinate}.`,
      });
    }
    renames.push({ coordinate, name });
  }
  return { success: true, data: renames };
};

/** The new name of every renamed coordinate, once each rename names something and leaves every name unique. */
const resolve = (graph: { types: string[]; fields: string[] }, renames: Rename[]): Result<Map<string, string>> => {
  const renamed = new Map(renames.map((rename) => [rename.coordinate, rename.name]));
  const newName = (coordinate: string, current: string): string => renamed.get(coordinate) ?? current;

  for (const { coordinate, name } of renames) {
    const input = `--rename ${coordinate}=${name}`;
    if (graph.types.includes(coordinate)) {
      const typeNames = [...reservedTypes, ...graph.types.map((type) => newName(type, type))];
      if (typeNames.filter((typeName) => typeName === name).length > 1) {
        return failWith({
          message: `The generated graph already has a type named ${name}.`,
          input,
          remediation: `Pass another name for ${coordinate}.`,
        });
      }
      continue;
    }

    if (!graph.fields.includes(coordinate)) {
      const examples = [graph.types[0], graph.fields[0]].filter((example) => example !== undefined);
      return failWith({
        message: `${coordinate} names no type or root field that the generated graph can rename.`,
        input,
        remediation: `Pass a type or a root field of the generated SDL, such as ${examples.join(' or ')}.`,
      });
    }
    const root = coordinate.slice(0, coordinate.indexOf('.') + 1);
    const fieldNames = graph.fields
      .filter((field) => field.startsWith(root))
      .map((field) => newName(field, field.slice(root.length)));
    if (fieldNames.filter((fieldName) => fieldName === name).length > 1) {
      return failWith({
        message: `${root.slice(0, -1)} already has a field named ${name}.`,
        input,
        remediation: `Pass another name for ${coordinate}.`,
      });
    }
  }
  return { success: true, data: renamed };
};

const renameReference = (type: TypeReference, renamed: Map<string, string>): TypeReference => {
  if (type.kind === 'list') {
    return { kind: 'list', of: renameReference(type.of, renamed) };
  }
  if (type.kind === 'scalar') {
    return type;
  }
  return { ...type, name: renamed.get(type.name) ?? type.name };
};

/** Renames the graph of a REST API. The REST calls behind it stay as they are. */
export const renameSource = (model: SourceModel, renames: Rename[]): Result<SourceModel> => {
  const renamed = resolve(
    {
      types: model.types.map((type) => type.name),
      fields: model.operations.map((operation) => `Query.${operation.field}`),
    },
    renames,
  );
  if (!renamed.success) {
    return renamed;
  }
  const names = renamed.data;

  return {
    success: true,
    data: {
      ...model,
      operations: model.operations.map((operation) => ({
        ...operation,
        field: names.get(`Query.${operation.field}`) ?? operation.field,
        returns: renameReference(operation.returns, names),
      })),
      types: model.types.map((type) => ({
        name: names.get(type.name) ?? type.name,
        fields: type.fields.map((field) => ({ ...field, type: renameReference(field.type, names) })),
      })),
    },
  };
};

/** Renames the graph of a gRPC service. The RPCs, messages and fields it calls stay as they are. */
export const renameProtoSource = (model: ProtoSourceModel, renames: Rename[]): Result<ProtoSourceModel> => {
  const renamed = resolve(
    {
      types: [model.types, model.inputs, model.enums].flat().map((type) => type.name),
      fields: model.operations.map((operation) => `${operation.root}.${operation.field}`),
    },
    renames,
  );
  if (!renamed.success) {
    return renamed;
  }
  const names = renamed.data;

  const renameFields = <Field extends { type: TypeReference }>(fields: Field[]): Field[] =>
    fields.map((field) => ({ ...field, type: renameReference(field.type, names) }));

  return {
    success: true,
    data: {
      ...model,
      operations: model.operations.map((operation) => ({
        ...operation,
        field: names.get(`${operation.root}.${operation.field}`) ?? operation.field,
        arguments: renameFields(operation.arguments),
        returns: renameReference(operation.returns, names),
      })),
      types: model.types.map((type) => ({
        name: names.get(type.name) ?? type.name,
        fields: renameFields(type.fields),
      })),
      inputs: model.inputs.map((type) => ({
        name: names.get(type.name) ?? type.name,
        fields: renameFields(type.fields),
      })),
      enums: model.enums.map((type) => ({ ...type, name: names.get(type.name) ?? type.name })),
    },
  };
};
