import type { Result } from '@wundergraph/wgc-plugin-sdk';
import yaml from 'js-yaml';
import { z } from 'zod';
import { fail } from '../failure.js';
import { camelName, pascalName } from './model.js';
import type {
  ScalarName,
  Skipped,
  SourceField,
  SourceModel,
  SourceOperation,
  SourceParameter,
  SourceType,
  TypeReference,
} from './model.js';

interface SchemaObject {
  $ref?: string;
  type?: string | string[];
  format?: string;
  nullable?: boolean;
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
  allOf?: SchemaObject[];
}

const schemaObject: z.ZodType<SchemaObject> = z.lazy(() =>
  z.looseObject({
    $ref: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    format: z.string().optional(),
    nullable: z.boolean().optional(),
    properties: z.record(z.string(), schemaObject).optional(),
    required: z.array(z.string()).optional(),
    items: schemaObject.optional(),
    allOf: z.array(schemaObject).optional(),
  }),
);

const parameterObject = z.looseObject({
  $ref: z.string().optional(),
  name: z.string().optional(),
  in: z.string().optional(),
  required: z.boolean().optional(),
  schema: schemaObject.optional(),
});

const operationObject = z.looseObject({
  operationId: z.string().optional(),
  parameters: z.array(parameterObject).optional(),
  responses: z
    .record(
      z.string(),
      z.looseObject({ content: z.record(z.string(), z.looseObject({ schema: schemaObject.optional() })).optional() }),
    )
    .optional(),
});

const pathItemObject = z.looseObject({
  parameters: z.array(parameterObject).optional(),
  get: operationObject.optional(),
  post: operationObject.optional(),
  put: operationObject.optional(),
  patch: operationObject.optional(),
  delete: operationObject.optional(),
});

const openApiDocument = z.looseObject({
  openapi: z.string(),
  info: z.looseObject({ title: z.string().optional() }).optional(),
  servers: z.array(z.looseObject({ url: z.string() })).optional(),
  paths: z.record(z.string(), pathItemObject).default({}),
  components: z
    .looseObject({
      schemas: z.record(z.string(), schemaObject).optional(),
      parameters: z.record(z.string(), parameterObject).optional(),
    })
    .optional(),
});

type OpenApiDocument = z.infer<typeof openApiDocument>;
type ParameterObject = z.infer<typeof parameterObject>;
type OperationObject = z.infer<typeof operationObject>;

const writeMethods = ['post', 'put', 'patch', 'delete'] as const;

const schemaReference = '#/components/schemas/';
const parameterReference = '#/components/parameters/';

/** What a schema becomes in the graph, or the reason it has no place in it. */
type Translated = { type: TypeReference } | { unsupported: string };

class Translator {
  readonly types = new Map<string, SourceType>();
  readonly skipped: Skipped[] = [];

  constructor(private readonly document: OpenApiDocument) {}

  /** Follows `$ref` and merges `allOf`, so the rest of the translation sees one plain schema. */
  private resolve(schema: SchemaObject): { schema: SchemaObject; name?: string } | { unsupported: string } {
    if (schema.$ref !== undefined) {
      if (!schema.$ref.startsWith(schemaReference)) {
        return { unsupported: `the reference ${schema.$ref} is not under ${schemaReference}` };
      }

      const name = schema.$ref.slice(schemaReference.length);
      const target = this.document.components?.schemas?.[name];
      if (target === undefined) {
        return { unsupported: `the reference ${schema.$ref} does not exist` };
      }

      const resolved = this.resolve(target);
      return 'unsupported' in resolved ? resolved : { schema: resolved.schema, name: resolved.name ?? name };
    }

    if (schema.allOf === undefined) {
      return { schema };
    }

    const merged: SchemaObject = { type: 'object', properties: {}, required: [] };
    for (const member of schema.allOf) {
      const resolved = this.resolve(member);
      if ('unsupported' in resolved) {
        return resolved;
      }
      merged.properties = { ...merged.properties, ...resolved.schema.properties };
      merged.required = [...(merged.required ?? []), ...(resolved.schema.required ?? [])];
    }
    return { schema: merged };
  }

  private scalar(type: string, format: string | undefined, property: string): ScalarName | undefined {
    if (type === 'string') {
      return property === 'id' ? 'ID' : 'String';
    }
    if (type === 'integer') {
      // GraphQL's Int is 32 bits wide.
      return format === 'int64' ? 'Float' : 'Int';
    }
    if (type === 'number') {
      return 'Float';
    }
    if (type === 'boolean') {
      return 'Boolean';
    }
    return undefined;
  }

  /** `nameHint` names an object that the description declares inline, such as `Item.warehouse`. */
  translate(schema: SchemaObject, nameHint: string, property = ''): Translated {
    const resolved = this.resolve(schema);
    if ('unsupported' in resolved) {
      return resolved;
    }

    const types = [resolved.schema.type ?? (resolved.schema.properties === undefined ? [] : ['object'])].flat();
    const type = types.find((candidate) => candidate !== 'null');

    if (type === 'array') {
      if (resolved.schema.items === undefined) {
        return { unsupported: 'the array does not say what it holds' };
      }

      const item = this.translate(resolved.schema.items, nameHint, property);
      if ('unsupported' in item) {
        return item;
      }
      if (item.type.kind === 'list') {
        return { unsupported: 'lists of lists are not generated' };
      }
      return { type: { kind: 'list', of: item.type } };
    }

    if (type === 'object') {
      return this.translateObject(resolved.schema, pascalName(resolved.name ?? nameHint));
    }

    const scalar = type === undefined ? undefined : this.scalar(type, resolved.schema.format, property);
    if (scalar === undefined) {
      return { unsupported: type === undefined ? 'the schema has no type' : `the type ${type} is not generated` };
    }
    return { type: { kind: 'scalar', name: scalar } };
  }

  private translateObject(schema: SchemaObject, name: string): Translated {
    if (this.types.has(name)) {
      return { type: { kind: 'object', name } };
    }

    // Registered before its fields are read so a schema that refers to itself ends here.
    const type: SourceType = { name, fields: [] };
    this.types.set(name, type);

    for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
      const field = this.translateField(schema, name, property, propertySchema);
      if (field !== undefined) {
        type.fields.push(field);
      }
    }

    if (type.fields.length === 0) {
      this.types.delete(name);
      return { unsupported: `${name} has no property that can become a field` };
    }
    return { type: { kind: 'object', name } };
  }

  private translateField(
    parent: SchemaObject,
    typeName: string,
    property: string,
    schema: SchemaObject,
  ): SourceField | undefined {
    const name = camelName(property);
    const subject = `${typeName}.${property}`;

    if (name === '' || this.types.get(typeName)?.fields.some((field) => field.name === name)) {
      this.skipped.push({ subject, reason: `the property has no field name of its own (${name})` });
      return undefined;
    }

    const translated = this.translate(schema, `${typeName} ${property}`, property);
    if ('unsupported' in translated) {
      this.skipped.push({ subject, reason: translated.unsupported });
      return undefined;
    }

    const nullable = schema.nullable === true || [schema.type ?? []].flat().includes('null');
    const required = (parent.required ?? []).includes(property) && !nullable;
    return { name, property, type: translated.type, required };
  }

  private resolveParameter(parameter: ParameterObject): ParameterObject | undefined {
    if (parameter.$ref === undefined) {
      return parameter;
    }
    if (!parameter.$ref.startsWith(parameterReference)) {
      return undefined;
    }
    return this.document.components?.parameters?.[parameter.$ref.slice(parameterReference.length)];
  }

  translateParameters(subject: string, parameters: ParameterObject[]): SourceParameter[] | { unsupported: string } {
    const translated: SourceParameter[] = [];

    for (const reference of parameters) {
      const parameter = this.resolveParameter(reference);
      if (parameter?.name === undefined || (parameter.in !== 'path' && parameter.in !== 'query')) {
        continue;
      }

      const resolved = this.resolve(parameter.schema ?? { type: 'string' });
      const [type] = 'unsupported' in resolved ? [] : [resolved.schema.type ?? 'string'].flat();
      const scalar =
        'unsupported' in resolved || type === undefined
          ? undefined
          : this.scalar(type, resolved.schema.format, parameter.name);
      const argument = camelName(parameter.name);

      if (scalar === undefined || argument === '' || translated.some((other) => other.argument === argument)) {
        if (parameter.in === 'path') {
          return { unsupported: `the path parameter ${parameter.name} is not a plain value` };
        }
        this.skipped.push({
          subject: `${subject} parameter ${parameter.name}`,
          reason: 'only plain string, number and boolean parameters are generated',
        });
        continue;
      }

      translated.push({
        argument,
        name: parameter.name,
        in: parameter.in,
        type: scalar,
        required: parameter.in === 'path' || parameter.required === true,
      });
    }

    return translated;
  }
}

const fieldNameOf = (path: string, operation: OperationObject): string => {
  if (operation.operationId !== undefined && camelName(operation.operationId) !== '') {
    return camelName(operation.operationId);
  }
  return camelName(`get ${path.replaceAll(/{([^}]+)}/g, 'by $1')}`);
};

const successSchema = (operation: OperationObject): SchemaObject | undefined => {
  const response = operation.responses?.['200'] ?? operation.responses?.default;
  return response?.content?.['application/json']?.schema;
};

const translateOperation = (
  translator: Translator,
  path: string,
  pathParameters: ParameterObject[],
  operation: OperationObject,
  taken: Set<string>,
): SourceOperation | { unsupported: string } => {
  const field = fieldNameOf(path, operation);
  if (taken.has(field)) {
    return { unsupported: `another operation already became the field ${field}` };
  }

  const schema = successSchema(operation);
  if (schema === undefined) {
    return { unsupported: 'it has no application/json response for status 200' };
  }

  const parameters = translator.translateParameters(`GET ${path}`, [
    ...pathParameters,
    ...(operation.parameters ?? []),
  ]);
  if ('unsupported' in parameters) {
    return parameters;
  }

  const missing = [...path.matchAll(/{([^}]+)}/g)]
    .map(([, name]) => name)
    .find((name) => !parameters.some((parameter) => parameter.in === 'path' && parameter.name === name));
  if (missing !== undefined) {
    return { unsupported: `the path parameter ${missing} is not declared` };
  }

  const returns = translator.translate(schema, `${field} response`);
  if ('unsupported' in returns) {
    return returns;
  }

  return { field, method: 'GET', path, parameters, returns: returns.type };
};

/** The API's title, for a default module name. */
export const openApiTitle = (text: string): string | undefined => {
  const parsed = openApiDocument.safeParse(yaml.load(text));
  return parsed.success ? parsed.data.info?.title : undefined;
};

/**
 * Reads an OpenAPI 3 description as a graph. Every GET operation that answers with JSON becomes a query
 * field. What cannot be translated is listed in `skipped` instead of being guessed at.
 */
export const readOpenApi = (text: string, location: string): Result<SourceModel> => {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch (error) {
    return fail({
      message: `${location} is not valid JSON or YAML: ${error instanceof Error ? error.message : String(error)}`,
      input: location,
      fix: 'Pass the URL or path of an OpenAPI 3 description.',
    });
  }

  const parsed = openApiDocument.safeParse(raw);
  if (!parsed.success || !parsed.data.openapi.startsWith('3.')) {
    return fail({
      message: `${location} is not an OpenAPI 3 description.`,
      input: location,
      fix: 'Pass an OpenAPI 3.0 or 3.1 document. Convert a Swagger 2.0 document first.',
    });
  }

  const document = parsed.data;
  const translator = new Translator(document);
  const operations: SourceOperation[] = [];
  const taken = new Set<string>();

  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of writeMethods) {
      if (item[method] !== undefined) {
        translator.skipped.push({
          subject: `${method.toUpperCase()} ${path}`,
          reason: 'only GET operations are generated',
        });
      }
    }

    if (item.get === undefined) {
      continue;
    }

    const operation = translateOperation(translator, path, item.parameters ?? [], item.get, taken);
    if ('unsupported' in operation) {
      translator.skipped.push({ subject: `GET ${path}`, reason: operation.unsupported });
      continue;
    }
    taken.add(operation.field);
    operations.push(operation);
  }

  if (operations.length === 0) {
    return fail({
      message: `${location} has no operation that can become a query field.\n${translator.skipped
        .map((skipped) => `  ${skipped.subject}: ${skipped.reason}`)
        .join('\n')}`,
      input: location,
      fix: 'The description needs at least one GET operation with an application/json response for status 200.',
    });
  }

  return {
    success: true,
    data: {
      ...(document.servers?.[0] === undefined ? {} : { baseUrl: document.servers[0].url }),
      operations,
      types: [...translator.types.values()],
      skipped: translator.skipped,
    },
  };
};
