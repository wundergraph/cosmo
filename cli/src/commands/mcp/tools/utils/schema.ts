import { GraphQLSchema, parse, visit } from 'graphql';
import { buildASTSchema, safeParse } from '@wundergraph/composition';

/**
 * Removes all directive definitions and directive usages from a GraphQL schema string
 * and returns a built GraphQLSchema.
 *
 * @param schemaString - The GraphQL schema string to process
 * @returns A built GraphQLSchema with all directives removed
 */
export function buildSchemaWithoutDirectives(schemaString: string): GraphQLSchema {
  // Parse the schema into an AST
  try {
    const ast = parse(schemaString, { noLocation: true });
    // Visit the AST and remove all directives
    const cleanedAst = visit(ast, {
      // Remove directive definitions
      DirectiveDefinition: () => null,
      // Remove directive usages from any node that can have directives
      Directive: () => null,
    });

    // Build and return the schema
    return buildASTSchema(cleanedAst, { assumeValid: true, assumeValidSDL: true });
  } catch (error: any) {
    throw new Error(`Failed to parse schema: ${error.message}`);
  }
}
