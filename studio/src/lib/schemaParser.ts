import {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLUnionType,
  buildASTSchema,
  parse,
} from "graphql";
import { Maybe } from "graphql/jsutils/Maybe";

export type GraphQLField = {
  name: string;
  description: string;
  deprecationReason: string;
  type: string;
  args: Array<{
    name: string;
    description: string;
    defaultValue: any;
    type: string;
    deprecationReason: string;
  }>;
};

export type GraphQLTypeDefinition = {
  kind: "object" | "interface";
  name: string;
  description: string;
  interfaces: string[];
  fields: GraphQLField[];
};

const mapObjectOrInterfaceGraphQLType = (
  graphqlType: Maybe<GraphQLObjectType | GraphQLInterfaceType>
): GraphQLTypeDefinition | null => {
  if (!graphqlType) {
    return null;
  }

  return {
    kind: graphqlType instanceof GraphQLObjectType ? "object" : "interface",
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

  if (graphqlType instanceof GraphQLInputObjectType) {
    return {
      ...base,
      kind: "input-object",
      fields: Object.values(graphqlType.getFields()).map((field) => ({
        name: field.name,
        description: field.description,
        deprecationReason: field.deprecationReason,
        defaultValue: field.defaultValue,
        type: field.type.toString(),
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

type GraphQLTypeCategory =
  | "objects"
  | "scalars"
  | "interfaces"
  | "enums"
  | "inputs";

const getTypesByCategory = (
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

const getTypeCounts = (astSchema: GraphQLSchema) => {
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

const parseSchema = (schema: string) => {
  const doc = parse(schema);

  const ast = buildASTSchema(doc, {
    assumeValid: true,
    assumeValidSDL: true,
  });

  return {
    ast,
    query: mapObjectOrInterfaceGraphQLType(ast.getQueryType()),
    mutation: mapObjectOrInterfaceGraphQLType(ast.getMutationType()),
    subscription: mapObjectOrInterfaceGraphQLType(ast.getSubscriptionType()),
  };
};

const parseType = (astSchema: GraphQLSchema, type: string) => {
  const astType = astSchema.getType(type);

  return mapGraphQLType(astType);
};

export {
  parseSchema,
  parseType,
  getTypeCounts,
  getTypesByCategory,
  mapObjectOrInterfaceGraphQLType,
};
