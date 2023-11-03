import { noCase } from "change-case";
import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLUnionType,
  buildASTSchema,
  isObjectType,
  parse,
} from "graphql";

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
  | (typeof graphqlTypeCategories)[number];

export type GraphQLField = {
  name: string;
  description?: string;
  deprecationReason?: string;
  type?: string;
  args?: Array<{
    name: string;
    description: string;
    defaultValue: any;
    type: string;
    deprecationReason: string;
  }>;
};

export type GraphQLTypeDefinition = {
  category: GraphQLTypeCategory;
  name: string;
  description: string;
  interfaces?: string[];
  fields?: GraphQLField[];
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
        })),
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
      })),
    };
  }

  throw new Error("Unsupported GraphQL type");
};

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
  if (!schema) {
    return null;
  }

  try {
    const doc = parse(schema);

    const ast = buildASTSchema(doc, {
      assumeValid: true,
      assumeValidSDL: true,
    });

    return ast;
  } catch {
    return null;
  }
};
