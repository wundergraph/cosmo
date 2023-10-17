import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLUnionType,
  buildASTSchema,
  isInterfaceType,
  isObjectType,
  parse,
} from "graphql";

export const graphqlTypeCategories = [
  "objects",
  "scalars",
  "interfaces",
  "enums",
  "inputs",
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
  description: string;
  deprecationReason: string;
  type: string;
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
  interfaces: string[];
  fields: GraphQLField[];
  members: {
    name: string;
  }[];
};

export type GraphQLObjectTypeDefinition = Omit<
  GraphQLTypeDefinition,
  "members"
>;

export type GraphQLInputTypeDefinition = Omit<
  GraphQLTypeDefinition,
  "interfaces" | "members"
>;

export const mapObjectOrInterfaceGraphQLType = (
  graphqlType: GraphQLObjectType | GraphQLInterfaceType
): GraphQLObjectTypeDefinition => {
  return {
    category:
      graphqlType instanceof GraphQLObjectType ? "objects" : "interfaces",
    name: graphqlType.name,
    description: graphqlType.description || "",
    interfaces: graphqlType.getInterfaces().map((iface) => iface.name),
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
};

export const mapInputGraphQLType = (
  graphqlType: GraphQLInputObjectType
): GraphQLInputTypeDefinition => {
  return {
    category: "inputs",
    name: graphqlType.name,
    description: graphqlType.description || "",
    fields: Object.values(graphqlType.getFields()).map((field) => ({
      name: field.name,
      description: field.description || "",
      deprecationReason: field.deprecationReason || "",
      defaultValue: field.defaultValue,
      type: field.type.toString(),
    })),
  };
};

const mapGraphQLType = (graphqlType: any) => {
  if (!graphqlType) {
    return null;
  }

  const base = {
    name: graphqlType.name,
    description: graphqlType.description,
  };

  if (graphqlType instanceof GraphQLEnumType) {
    return {
      ...base,
      kind: "enum",
      values: graphqlType.getValues().map((value) => ({
        name: value.name,
        description: value.description,
        deprecationReason: value.deprecationReason,
      })),
    };
  }

  if (graphqlType instanceof GraphQLUnionType) {
    return {
      ...base,
      kind: "union",
      members: graphqlType.getTypes().map((type) => ({
        name: type.name,
      })),
    };
  }

  if (graphqlType instanceof GraphQLScalarType) {
    return {
      ...base,
      kind: "scalar",
    };
  }

  return null;
};

export const getTypesByCategory = (
  astSchema: GraphQLSchema,
  category: GraphQLTypeCategory
) => {
  const allTypes = Object.values(astSchema.getTypeMap());

  switch (category) {
    case "objects":
      return allTypes.filter(
        (t) =>
          t instanceof GraphQLObjectType &&
          t !== astSchema.getQueryType() &&
          t !== astSchema.getMutationType() &&
          t !== astSchema.getSubscriptionType()
      );
    case "scalars":
      return allTypes.filter((t) => t instanceof GraphQLScalarType);
    case "interfaces":
      return allTypes.filter((t) => t instanceof GraphQLInterfaceType);
    case "enums":
      return allTypes.filter((t) => t instanceof GraphQLEnumType);
    case "inputs":
      return allTypes.filter((t) => t instanceof GraphQLInputObjectType);
    default:
      return [];
  }
};

export const getCategoryForType = (
  astSchema: GraphQLSchema,
  typename: string
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

  return null;
};

export const getTypeCounts = (astSchema: GraphQLSchema) => {
  const allTypes = Object.values(astSchema.getTypeMap());

  const counts = {
    object: allTypes.filter(
      (t) =>
        t instanceof GraphQLObjectType &&
        t !== astSchema.getQueryType() &&
        t !== astSchema.getMutationType() &&
        t !== astSchema.getSubscriptionType()
    ).length,
    scalar: allTypes.filter((t) => t instanceof GraphQLScalarType).length,
    interface: allTypes.filter((t) => t instanceof GraphQLInterfaceType).length,
    enum: allTypes.filter((t) => t instanceof GraphQLEnumType).length,
    input: allTypes.filter((t) => t instanceof GraphQLInputObjectType).length,
  };

  return counts;
};

export const parseSchema = (schema: string) => {
  const doc = parse(schema);

  const ast = buildASTSchema(doc, {
    assumeValid: true,
    assumeValidSDL: true,
  });

  return ast;
};

export const parseType = (astSchema: GraphQLSchema, typename: string) => {
  const astType = astSchema.getType(typename);

  if (isObjectType(astType) || isInterfaceType(astType)) {
    return mapObjectOrInterfaceGraphQLType(astType);
  }

  return mapGraphQLType(astType);
};
