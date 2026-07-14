import { extendSchema, parse, type GraphQLSchema } from 'graphql';

const deferDirective = parse(`
  directive @defer(label: String, if: Boolean! = true) on FRAGMENT_SPREAD | INLINE_FRAGMENT
`);

export const withDeferDirective = (schema: GraphQLSchema): GraphQLSchema => {
  if (schema.getDirective('defer')) {
    return schema;
  }
  return extendSchema(schema, deferDirective);
};
