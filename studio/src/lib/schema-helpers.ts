import { noCase } from "change-case";
import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLUnionType,
  Kind,
  Location,
  buildASTSchema,
  isObjectType,
  isScalarType,
  parse,
} from "graphql";
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

export type GraphQLField = {
  name: string;
  description?: string;
  deprecationReason?: string;
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
  fields?: GraphQLField[];
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
      fields: Object.values(graphqlType.getFields()).map((field) => ({
        name: field.name,
        description: field.description || "",
        deprecationReason: field.deprecationReason || "",
        type: field.type.toString(),
        args: field.args.map((arg) => ({
          name: arg.name,
          description: arg.description || "",
          defaultValue: arg.defaultValue,
          type: arg.type.toString(),
          deprecationReason: arg.deprecationReason || "",
          loc: arg.astNode?.loc,
        })),
        loc: field.astNode?.loc,
      })),
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

export const parseSchema = (schema?: string) => {
  if (!schema) return null;

  const doc = parse(schema);

  const ast = buildASTSchema(doc, {
    assumeValid: true,
    assumeValidSDL: true,
  });

  return ast;
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
  } catch {
    return null;
  }
};

export const useParseSchema = (schema?: string) => {
  const [isParsing, setIsParsing] = useState(true);
  const [ast, setAst] = useState<GraphQLSchema | null>(null);

  useEffect(() => {
    let t: NodeJS.Timeout;
    setIsParsing(true);

    formatAndParseSchema(schema).then((res) => {
      setAst(res);

      t = setTimeout(() => {
        setIsParsing(false);
      }, 200);
    });

    return () => {
      clearTimeout(t);
    };
  }, [schema]);

  return { ast, isParsing };
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

    const deprecatedFields: GraphQLField[] = [];

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
          deprecatedFields.push({
            name: field.name,
            description: field.description || "",
            deprecationReason: field.deprecationReason || "",
            type: field.type.toString(),
            args: field.args.map((arg) => ({
              name: arg.name,
              description: arg.description || "",
              defaultValue: arg.defaultValue,
              type: arg.type.toString(),
              deprecationReason: arg.deprecationReason || "",
              loc: arg.astNode?.loc,
            })),
            loc: field.astNode?.loc,
          });
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
