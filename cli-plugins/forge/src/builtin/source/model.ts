/** A REST API described as the graph it becomes: one query field per operation, one type per response object. */
export interface SourceModel {
  /** The first server the API description names, used when the router config sets no base URL. */
  baseUrl?: string;
  operations: SourceOperation[];
  types: SourceType[];
  /** Everything in the description that was left out of the graph, and why. */
  skipped: Skipped[];
}

export interface Skipped {
  /** An operation such as `POST /v1/items`, or a property such as `Item.attributes`. */
  subject: string;
  reason: string;
}

export type TypeReference =
  | { kind: 'scalar'; name: ScalarName }
  | { kind: 'object'; name: string }
  | { kind: 'list'; of: TypeReference };

export type ScalarName = 'ID' | 'String' | 'Int' | 'Float' | 'Boolean';

export interface SourceOperation {
  /** The field on `Query`. */
  field: string;
  method: 'GET';
  path: string;
  parameters: SourceParameter[];
  returns: TypeReference;
}

export interface SourceParameter {
  /** The GraphQL argument. */
  argument: string;
  /** The parameter as the REST API names it. */
  name: string;
  in: 'path' | 'query';
  type: ScalarName;
  required: boolean;
}

export interface SourceType {
  name: string;
  fields: SourceField[];
}

export interface SourceField {
  name: string;
  /** The property as the REST API names it. */
  property: string;
  type: TypeReference;
  required: boolean;
}

const words = (text: string): string[] => text.split(/[^\dA-Za-z]+/).filter((word) => word !== '');

const upperFirst = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const lowerFirst = (word: string): string => word.charAt(0).toLowerCase() + word.slice(1);

/** GraphQL names cannot start with a digit. */
const startWithLetter = (name: string): string => (/^\d/.test(name) ? `_${name}` : name);

export const pascalName = (text: string): string =>
  startWithLetter(
    words(text)
      .map((word) => upperFirst(word))
      .join(''),
  );

export const camelName = (text: string): string => startWithLetter(lowerFirst(pascalName(text).replace(/^_/, '')));

/** Lists are never null and never hold nulls, so a missing array reads as an empty list. */
const renderType = (type: TypeReference, required: boolean): string => {
  if (type.kind === 'list') {
    return `[${renderType(type.of, true)}]!`;
  }
  return required ? `${type.name}!` : type.name;
};

const renderOperation = (operation: SourceOperation): string => {
  const parameters = operation.parameters.map(
    (parameter) => `${parameter.argument}: ${renderType({ kind: 'scalar', name: parameter.type }, parameter.required)}`,
  );
  const list = parameters.length === 0 ? '' : `(${parameters.join(', ')})`;
  return `  ${operation.field}${list}: ${renderType(operation.returns, false)}`;
};

const renderSourceType = (type: SourceType): string =>
  [
    `type ${type.name} {`,
    ...type.fields.map((field) => `  ${field.name}: ${renderType(field.type, field.required)}`),
    '}',
  ].join('\n');

export const renderSdl = (model: SourceModel): string => {
  const query = ['type Query {', ...model.operations.map((operation) => renderOperation(operation)), '}'].join('\n');
  return `${[query, ...model.types.map((type) => renderSourceType(type))].join('\n\n')}\n`;
};
