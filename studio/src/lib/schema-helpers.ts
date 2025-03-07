import {
  buildASTSchema,
  normalizeSubgraphFromString,
} from "@wundergraph/composition";
import { noCase } from "change-case";
import {
  GraphQLArgument,
  GraphQLEnumType,
  GraphQLField,
  GraphQLInputField,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLUnionType,
  Kind,
  Location,
  ConstArgumentNode,
  ListValueNode,
  StringValueNode,
  FieldDefinitionNode,
  TypeNode,
  TypeDefinitionNode,
  DocumentNode,
  ASTNode,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  parse,
  visit,
} from 'graphql';
import babelPlugin from "prettier/plugins/babel";
import estreePlugin from "prettier/plugins/estree";
import graphQLPlugin from "prettier/plugins/graphql";
import * as prettier from "prettier/standalone";
import { useEffect, useState } from "react";

export const graphqlTypeCategories = [
  "objects",
  "scalars",
  "interfaces",
  "enums",
  "inputs",
  "unions",
] as const;

export const graphqlRootCategories = [
  "query",
  "mutation",
  "subscription",
] as const;

export type GraphQLTypeCategory =
  | (typeof graphqlRootCategories)[number]
  | (typeof graphqlTypeCategories)[number]
  | "deprecated";

export type ParsedGraphQLField = {
  name: string;
  description?: string;
  deprecationReason?: string;
  authenticated?: boolean;
  requiresScopes?: string[][] | null;
  defaultValue?: any;
  type?: string;
  args?: Array<{
    name: string;
    description: string;
    defaultValue: any;
    type: string;
    deprecationReason: string;
    loc?: Location;
  }>;
  loc?: Location;
};

export type GraphQLTypeDefinition = {
  category: GraphQLTypeCategory;
  name: string;
  description: string;
  interfaces?: string[];
  fields?: ParsedGraphQLField[];
  loc?: Location;
};

export const mapGraphQLType = (
  graphqlType:
    | GraphQLObjectType
    | GraphQLInterfaceType
    | GraphQLInputObjectType
    | GraphQLEnumType
    | GraphQLScalarType
    | GraphQLUnionType,
): GraphQLTypeDefinition => {
  const common = {
    name: graphqlType.name,
    description: graphqlType.description || "",
    loc: graphqlType.astNode?.loc,
  };

  if (
    graphqlType instanceof GraphQLObjectType ||
    graphqlType instanceof GraphQLInterfaceType
  ) {
    return {
      ...common,
      category:
        graphqlType instanceof GraphQLObjectType ? "objects" : "interfaces",
      interfaces:
        graphqlType.getInterfaces?.().map((iface) => iface.name) || [],
      fields: Object.values(graphqlType.getFields()).map(field => maybeParseField(field.astNode)!).filter(Boolean),
    };
  }

  if (graphqlType instanceof GraphQLInputObjectType) {
    return {
      ...common,
      category: "inputs",
      fields: Object.values(graphqlType.getFields()).map((field) => ({
        name: field.name,
        description: field.description || "",
        deprecationReason: field.deprecationReason || "",
        defaultValue: field.defaultValue,
        type: field.type.toString(),
        loc: field.astNode?.loc,
      })),
    };
  }

  if (graphqlType instanceof GraphQLEnumType) {
    return {
      ...common,
      category: "enums",
      fields: graphqlType.getValues().map((value) => ({
        name: value.name,
        description: value.description || "",
        deprecationReason: value.deprecationReason || "",
        loc: value.astNode?.loc,
      })),
    };
  }

  if (graphqlType instanceof GraphQLScalarType) {
    return {
      ...common,
      category: "scalars",
    };
  }

  if (graphqlType instanceof GraphQLUnionType) {
    return {
      ...common,
      category: "unions",
      fields: graphqlType.getTypes().map((type) => ({
        name: type.name,
        loc: type.astNode?.loc,
      })),
    };
  }

  throw new Error("Unsupported GraphQL type");
};

export const extractVariablesFromGraphQL = (
  body: string,
  ast: GraphQLSchema | null,
) => {
  let variables: Record<string, any> = {};

  try {
    const allTypes = ast
      ? Object.values(ast.getTypeMap())
          .filter((type) => !type.name.startsWith("__"))
          .sort()
      : [];

    const parsedOp = parse(body);

    if (parsedOp.definitions[0].kind === Kind.OPERATION_DEFINITION) {
      parsedOp.definitions[0].variableDefinitions?.forEach((vd) => {
        const variableName = vd.variable.name.value;
        let type = "";

        if (vd.type.kind === Kind.NON_NULL_TYPE) {
          if (vd.type.type.kind === Kind.NAMED_TYPE) {
            type = vd.type.type.name.value;
          }
        } else if (vd.type.kind === Kind.NAMED_TYPE) {
          type = vd.type.name.value;
        }

        let defaultValueParsed;

        if (vd.defaultValue) {
          defaultValueParsed = parseDefaultValue(vd.defaultValue, allTypes);
        } else {
          defaultValueParsed = getDefaultValue(type, allTypes);
        }
        variables[variableName] = defaultValueParsed;
      });
    }
  } catch {
    return variables;
  }

  return variables;
};

function parseDefaultValue(defaultValue: any, allTypes: any[]): any {
  switch (defaultValue.kind) {
    case Kind.INT:
      return parseInt(defaultValue.value);
    case Kind.FLOAT:
      return parseFloat(defaultValue.value);
    case Kind.STRING:
    case Kind.BOOLEAN:
    case Kind.ENUM:
      return defaultValue.value;
    case Kind.LIST:
      return defaultValue.values.map((val: any) =>
        parseDefaultValue(val, allTypes),
      );
    case Kind.OBJECT:
      const objValue: Record<string, any> = {};
      defaultValue.fields.forEach((field: any) => {
        const fieldName = field.name.value;
        const fieldType = allTypes.find((type) => type.name === fieldName);
        const fieldValue = parseDefaultValue(field.value, allTypes);
        objValue[fieldName] = fieldType
          ? castToType(fieldType, fieldValue)
          : fieldValue;
      });
      return objValue;
    case Kind.NULL:
      return null;
    default:
      return undefined;
  }
}

// Helper function to cast field value to its respective type
function castToType(fieldType: any, fieldValue: any): any {
  if (isScalarType(fieldType)) {
    if (fieldType.name === "Int") {
      return parseInt(fieldValue);
    } else if (fieldType.name === "Float") {
      return parseFloat(fieldValue);
    } else if (fieldType.name === "Boolean") {
      return fieldValue === "true";
    } else {
      return fieldValue;
    }
  } else {
    return fieldValue;
  }
}

function getDefaultValue(
  typeName: string,
  schemaTypes: GraphQLNamedType[],
): any {
  const isNonNull = typeName.endsWith("!");
  if (isNonNull) {
    typeName = typeName.slice(0, -1);
  }

  const foundType = schemaTypes.find((type) => type.name === typeName);
  if (!foundType) return null;

  if (foundType instanceof GraphQLScalarType) {
    switch (foundType.name) {
      case "Int":
      case "Float":
        return 0;
      case "Boolean":
        return false;
      case "ID":
      case "String":
        return "";
      default:
        return null;
    }
  } else if (foundType instanceof GraphQLInputObjectType) {
    const fields = foundType.getFields();
    const fieldDefaults: Record<string, any> = {};
    Object.entries(fields).forEach(([fieldName, field]) => {
      fieldDefaults[fieldName] = getDefaultValue(
        field.type.toString(),
        schemaTypes,
      );
    });
    return fieldDefaults;
  } else if (foundType instanceof GraphQLEnumType) {
    return foundType.getValues()[0]?.value || null;
  } else {
    return null;
  }
}

export const getTypesByCategory = (
  astSchema: GraphQLSchema,
  category: GraphQLTypeCategory,
) => {
  const allTypes = Object.values(astSchema.getTypeMap())
    .filter((type) => !type.name.startsWith("__"))
    .sort();

  switch (category) {
    case "objects":
      return allTypes.filter(
        (t) =>
          t instanceof GraphQLObjectType &&
          t !== astSchema.getQueryType() &&
          t !== astSchema.getMutationType() &&
          t !== astSchema.getSubscriptionType(),
      );
    case "scalars":
      return allTypes.filter((t) => t instanceof GraphQLScalarType);
    case "interfaces":
      return allTypes.filter((t) => t instanceof GraphQLInterfaceType);
    case "enums":
      return allTypes.filter((t) => t instanceof GraphQLEnumType);
    case "inputs":
      return allTypes.filter((t) => t instanceof GraphQLInputObjectType);
    case "unions":
      return allTypes.filter((t) => t instanceof GraphQLUnionType);
    default:
      return [];
  }
};

export const getCategoryForType = (
  astSchema: GraphQLSchema,
  typename: string,
): GraphQLTypeCategory | null => {
  const astType = astSchema.getType(typename);

  if (!astType) {
    return null;
  }

  if (isObjectType(astType)) {
    if (astType === astSchema.getQueryType()) {
      return "query";
    }
    if (astType === astSchema.getMutationType()) {
      return "mutation";
    }
    if (astType === astSchema.getSubscriptionType()) {
      return "subscription";
    }
    return "objects";
  }

  if (astType instanceof GraphQLScalarType) {
    return "scalars";
  }

  if (astType instanceof GraphQLInterfaceType) {
    return "interfaces";
  }

  if (astType instanceof GraphQLEnumType) {
    return "enums";
  }

  if (astType instanceof GraphQLInputObjectType) {
    return "inputs";
  }

  if (astType instanceof GraphQLUnionType) {
    return "unions";
  }

  return null;
};

export const getTypeCounts = (astSchema: GraphQLSchema) => {
  const allTypes = Object.values(astSchema.getTypeMap()).filter(
    (type) => !type.name.startsWith("__"),
  );

  const counts = {
    query: Object.keys(astSchema.getQueryType()?.getFields() ?? {}).length,
    mutation: Object.keys(astSchema.getMutationType()?.getFields() ?? {})
      .length,
    subscription: Object.keys(
      astSchema.getSubscriptionType()?.getFields() ?? {},
    ).length,
    objects: allTypes.filter(
      (t) =>
        t instanceof GraphQLObjectType &&
        t !== astSchema.getQueryType() &&
        t !== astSchema.getMutationType() &&
        t !== astSchema.getSubscriptionType(),
    ).length,
    scalars: allTypes.filter((t) => t instanceof GraphQLScalarType).length,
    interfaces: allTypes.filter((t) => t instanceof GraphQLInterfaceType)
      .length,
    enums: allTypes.filter((t) => t instanceof GraphQLEnumType).length,
    inputs: allTypes.filter((t) => t instanceof GraphQLInputObjectType).length,
    unions: allTypes.filter((t) => t instanceof GraphQLUnionType).length,
  };

  return counts;
};

export const getCategoryDescription = (category: GraphQLTypeCategory) => {
  switch (category) {
    case "objects":
      return "Object types define a set of fields and are the building blocks of the schema.";
    case "scalars":
      return "Scalar types represent primitive leaf values in the schema.";
    case "interfaces":
      return "Interface types define a set of fields but do not implement them.";
    case "enums":
      return "Enum types are a special kind of scalar restricted to a set of allowed values.";
    case "inputs":
      return "Input types define the input of operations and are used in arguments.";
    case "query":
      return "The query root type which fetches data based on its fields.";
    case "mutation":
      return "The mutation root type which modifies data based on its fields.";
    case "subscription":
      return "The subscription root type which subscribes to data changes based on its fields.";
    case "unions":
      return "Union types represent one of multiple possible object types, but don't specify any common fields between those types.";
    default:
      return "Unknown type category.";
  }
};

export const getRootDescription = (name: string) => {
  if (!["Query", "Mutation", "Subscription"].includes(name)) {
    return;
  }

  return getCategoryDescription(noCase(name) as GraphQLTypeCategory);
};

export const parseSchema = (schema?: string): { ast: GraphQLSchema, doc: DocumentNode } | null => {
  if (!schema) return null;

  try {
    const doc = parse(schema);

    const ast = buildASTSchema(doc, {
      assumeValid: true,
      assumeValidSDL: true,
      addInvalidExtensionOrphans: true,
    });

    return { ast, doc };
  } catch (e) {
    console.error(e);
    return null;
  }
};

export const formatAndParseSchema = async (schema?: string) => {
  if (!schema) {
    return null;
  }

  try {
    const res = await prettier.format(schema, {
      parser: "graphql",
      plugins: [graphQLPlugin, estreePlugin, babelPlugin],
    });

    return parseSchema(res);
  } catch (e) {
    console.error(e);
    return null;
  }
};

export const useParseSchema = (schema?: string) => {
  const [isParsing, setIsParsing] = useState(true);
  const [astAndDoc, setAstAndDoc] = useState<{ ast: GraphQLSchema | null, doc: DocumentNode | null }>({ ast: null, doc: null });

  useEffect(() => {
    let t: NodeJS.Timeout;
    setIsParsing(true);

    formatAndParseSchema(schema).then((res) => {
      setAstAndDoc(res || { ast: null, doc: null });

      t = setTimeout(() => {
        setIsParsing(false);
      }, 200);
    });

    return () => {
      clearTimeout(t);
    };
  }, [schema]);

  return { ...astAndDoc, isParsing };
};

export const getGraphQLTypeAtLineNumber = (
  astSchema: GraphQLSchema,
  lineNumber: number,
): GraphQLTypeDefinition | null => {
  const allTypes = Object.values(astSchema.getTypeMap()).filter(
    (type) => !type.name.startsWith("__"),
  );

  for (const type of allTypes) {
    if (type.astNode && type.astNode.loc) {
      const { startToken, endToken } = type.astNode.loc;

      if (startToken.line <= lineNumber && endToken.line >= lineNumber) {
        return mapGraphQLType(type);
      }
    }

    if (isObjectType(type)) {
      const fields = type.getFields();

      for (const field of Object.values(fields)) {
        if (field.astNode && field.astNode.loc) {
          const { startToken, endToken } = field.astNode.loc;

          if (startToken.line <= lineNumber && endToken.line >= lineNumber) {
            return mapGraphQLType(type);
          }
        }

        const args = field.args;

        for (const arg of args) {
          if (arg.astNode && arg.astNode.loc) {
            const { startToken, endToken } = arg.astNode.loc;

            if (startToken.line <= lineNumber && endToken.line >= lineNumber) {
              return mapGraphQLType(type);
            }
          }
        }
      }
    }
  }

  return null;
};

const maybeParseField = (field: ASTNode | undefined | null): ParsedGraphQLField | null => {
  if (field?.kind !== Kind.FIELD_DEFINITION) {
    return null;
  }

  return parseField(field);
}

const getTypeName = (ast: TypeNode): string => {
  switch (ast.kind) {
    case Kind.NAMED_TYPE:
      return ast.name.value;
    case Kind.LIST_TYPE:
      return `[${getTypeName(ast.type)}]`;
    case Kind.NON_NULL_TYPE:
      return `${getTypeName(ast.type)}!`;
  }
}

const parseField = (
  field: FieldDefinitionNode,
  directives?: ExtractedDirectives
): ParsedGraphQLField => {
  directives ??= extractDirectives(field);

  return {
    name: field.name.value,
    description: field.description?.value || "",
    deprecationReason: directives.deprecationReason,
    authenticated: directives.authenticated,
    requiresScopes: directives.requiresScopes,
    type: getTypeName(field.type),
    args: field.arguments?.map((arg) => ({
      name: arg.name.value,
      description: arg.description?.value || "",
      defaultValue: '',
      type: getTypeName(arg.type),
      deprecationReason: extractDirectives(arg).deprecationReason,
      loc: arg.loc,
    })) ?? [],
    loc: field.loc,
  };
}

export const getDeprecatedTypes = (
  astSchema: GraphQLSchema,
): GraphQLTypeDefinition[] => {
  const deprecatedTypes: GraphQLTypeDefinition[] = [];

  const checkType = (type: any) => {
    const common = {
      name: type.name,
      description: type.description || "",
      loc: type.astNode?.loc,
    };

    const deprecatedFields: ParsedGraphQLField[] = [];

    let category: GraphQLTypeCategory | null = null;

    if (
      type instanceof GraphQLObjectType ||
      type instanceof GraphQLInterfaceType
    ) {
      const fields = Object.values(type.getFields());

      for (const field of fields) {
        if (
          field.deprecationReason ||
          field.args.some((arg) => arg.deprecationReason)
        ) {
          deprecatedFields.push(parseField(field.astNode!));
        }
      }

      category = type instanceof GraphQLObjectType ? "objects" : "interfaces";
    }

    if (type instanceof GraphQLInputObjectType) {
      const fields = Object.values(type.getFields());

      for (const field of fields) {
        if (field.deprecationReason) {
          deprecatedFields.push({
            name: field.name,
            description: field.description || "",
            deprecationReason: field.deprecationReason || "",
            defaultValue: field.defaultValue,
            type: field.type.toString(),
            loc: field.astNode?.loc,
          });
        }
      }

      category = "inputs";
    }

    if (type instanceof GraphQLEnumType) {
      const values = type.getValues();

      for (const value of values) {
        if (value.deprecationReason) {
          deprecatedFields.push({
            name: value.name,
            description: value.description || "",
            deprecationReason: value.deprecationReason || "",
            loc: value.astNode?.loc,
          });
        }
      }

      category = "enums";
    }

    if (deprecatedFields.length > 0 && category) {
      deprecatedTypes.push({
        ...common,
        category,
        fields: deprecatedFields,
      });
    }
  };

  const allTypes = Object.values(astSchema.getTypeMap()).filter(
    (type) => !type.name.startsWith("__"),
  );

  for (const type of allTypes) {
    checkType(type);
  }

  return deprecatedTypes;
};

type ExtractedDirectives = {
  authenticated: boolean;
  requiresScopes: string[][] | null;
  deprecationReason: string;
}

const extractDirectives = (
    astNode: ASTNode | undefined | null
) => {
  const result: ExtractedDirectives = {
    authenticated: false,
    requiresScopes: null,
    deprecationReason: '',
  };
  
  if (!astNode) {
    return result;
  }

  visit(astNode, {
    Directive(node, key, parent, path, ancestors) {
      switch (node.name.value) {
        case "deprecated":
          const reasonArg = node.arguments?.[0];
          if (reasonArg && reasonArg?.name.value === "reason" && reasonArg?.value.kind === Kind.STRING) {
            result.deprecationReason = reasonArg.value.value;
          }
          break;
        case "authenticated":
          result.authenticated = true;
          break;
        case "requiresScopes":
          const scopesArg = node.arguments?.[0];
          if (scopesArg?.name.value === "scopes" && scopesArg?.value.kind === Kind.LIST) {
            result.requiresScopes = scopesArg.value.values
                .filter((value) => value.kind === Kind.LIST)
                .map((value) => value.values)
                .map((value) => value.filter((sv) => sv.kind === Kind.STRING).map((sv) => sv.value));
          }
          
          break;
      }
      
      return false;
    },
  });

  return result;
}

export const getAuthenticatedTypes = (
    document: DocumentNode,
): GraphQLTypeDefinition[] => {
  const authenticatedTypes: Record<string, GraphQLTypeDefinition> = {};
  visit(document, {
    FieldDefinition(node, key, parent, path, ancestors) {
      if (node.name.value.startsWith("__")) {
        return false;
      }
      
      const directives = extractDirectives(node);
      if (!directives.authenticated && !Array.isArray(directives.requiresScopes)) {
        return undefined;
      }
      
      const type = ancestors[ancestors.length - 1] as TypeDefinitionNode;
      const typeName = type.name.value;
      if (!(typeName in authenticatedTypes)) {
        authenticatedTypes[typeName] = {
          name: type.name.value,
          description: type.description?.value || "",
          category: type.kind === Kind.OBJECT_TYPE_DEFINITION ? "objects" : "interfaces",
          fields: [],
          loc: type.loc,
        };
      }
      
      authenticatedTypes[typeName].fields!.push(parseField(node, directives));
    }
  });
  
  return Object.values(authenticatedTypes);
};

export type FieldMatch = {
  type: GraphQLNamedType;
  field: GraphQLField<unknown, unknown> | GraphQLInputField;
  parsed: ParsedGraphQLField | null;
  argument?: GraphQLArgument;
};

export type TypeMatch = { type: GraphQLNamedType };

export const getAllFields = (schema: GraphQLSchema): FieldMatch[] => {
  const fields: FieldMatch[] = [];

  const types = schema.getTypeMap();

  for (const typeName in types) {
    const type = types[typeName];

    if (
      !isObjectType(type) &&
      !isInterfaceType(type) &&
      !isInputObjectType(type)
    ) {
      continue;
    }

    const fieldMap = type.getFields();

    for (const fieldName in fieldMap) {
      const field = fieldMap[fieldName];

      fields.push({
        type,
        field,
        parsed: maybeParseField(field.astNode),
      });
    }
  }

  return fields;
};

function isMatch(sourceText: string, searchValue: string): boolean {
  try {
    const escaped = searchValue.replaceAll(/[^_0-9A-Za-z]/g, (ch) => "\\" + ch);
    return sourceText.search(new RegExp(escaped, "i")) !== -1;
  } catch {
    return sourceText.toLowerCase().includes(searchValue.toLowerCase());
  }
}

export const searchSchema = (searchValue: string, schema: GraphQLSchema) => {
  const matches: {
    types: TypeMatch[];
    fields: FieldMatch[];
  } = {
    types: [],
    fields: [],
  };

  if (!schema) {
    return matches;
  }

  const typeMap = schema.getTypeMap();
  let typeNames = Object.keys(typeMap);

  for (const typeName of typeNames) {
    if (matches.types.length + matches.fields.length >= 100) {
      break;
    }

    const type = typeMap[typeName];
    if (isMatch(typeName, searchValue)) {
      matches.types.push({ type });
    }

    if (
      !isObjectType(type) &&
      !isInterfaceType(type) &&
      !isInputObjectType(type)
    ) {
      continue;
    }

    const fields = type.getFields();
    for (const fieldName in fields) {
      const field = fields[fieldName];
      let matchingArgs: GraphQLArgument[] | undefined;

      if (!isMatch(fieldName, searchValue)) {
        if ("args" in field) {
          matchingArgs = field.args.filter((arg) =>
            isMatch(arg.name, searchValue),
          );
          if (matchingArgs.length === 0) {
            continue;
          }
        } else {
          continue;
        }
      }

      matches["fields"].push(
        ...(matchingArgs
          ? matchingArgs.map((argument) => ({ type, field, parsed: maybeParseField(field.astNode), argument }))
          : [{ type, field, parsed: maybeParseField(field.astNode) }]),
      );
    }
  }

  return matches;
};
