import { parse, print, DocumentNode, DefinitionNode, DirectiveNode } from 'graphql';
import { OPENAPI_DIRECTIVE_DEFINITION, OpenApiMetadata } from './openapi-types.js';

/**
 * Extracts @openapi directive metadata from a GraphQL operation document
 * 
 * @param operationDocument - The parsed GraphQL operation document
 * @returns OpenApiMetadata if @openapi directive is found, null otherwise
 */
export function extractOpenApiMetadataFromOperation(operationDocument: DocumentNode): OpenApiMetadata | null {
  // Find the operation definition
  const operationDef = operationDocument.definitions.find(
    def => def.kind === 'OperationDefinition'
  );
  
  if (!operationDef || operationDef.kind !== 'OperationDefinition') {
    return null;
  }
  
  // Look for @openapi directive on the operation
  const openApiDirective = operationDef.directives?.find(
    dir => dir.name.value === 'openapi'
  );
  
  if (!openApiDirective) {
    return null;
  }
  
  return parseOpenApiDirective(openApiDirective);
}

/**
 * Parses an @openapi directive node into OpenApiMetadata
 */
function parseOpenApiDirective(directive: DirectiveNode): OpenApiMetadata {
  const metadata: OpenApiMetadata = {};
  
  if (!directive.arguments) {
    return metadata;
  }
  
  for (const arg of directive.arguments) {
    const argName = arg.name.value;
    const argValue = arg.value;
    
    switch (argName) {
      case 'operationId':
        if (argValue.kind === 'StringValue') {
          metadata.operationId = argValue.value;
        }
        break;
      case 'summary':
        if (argValue.kind === 'StringValue') {
          metadata.summary = argValue.value;
        }
        break;
      case 'description':
        if (argValue.kind === 'StringValue') {
          metadata.description = argValue.value;
        }
        break;
      case 'tags':
        if (argValue.kind === 'ListValue') {
          metadata.tags = argValue.values
            .filter(v => v.kind === 'StringValue')
            .map(v => (v.kind === 'StringValue' ? v.value : ''));
        }
        break;
      case 'deprecated':
        if (argValue.kind === 'BooleanValue') {
          metadata.deprecated = argValue.value;
        }
        break;
      case 'externalDocs':
        if (argValue.kind === 'ObjectValue') {
          const descField = argValue.fields.find(f => f.name.value === 'description');
          const urlField = argValue.fields.find(f => f.name.value === 'url');
          
          if (urlField && urlField.value.kind === 'StringValue') {
            metadata.externalDocs = {
              url: urlField.value.value,
            };
            
            if (descField && descField.value.kind === 'StringValue') {
              metadata.externalDocs.description = descField.value.value;
            }
          }
        }
        break;
    }
  }
  
  return metadata;
}

/**
 * Enhances SDL with @openapi directive definition
 * This is used to temporarily add the directive definition so GraphQL parser can validate it
 * 
 * @param originalSDL - The original GraphQL SDL
 * @returns Enhanced SDL with @openapi directive definition
 */
export function enhanceSDLWithOpenApiDirective(originalSDL: string): string {
  // Check if directive is already defined
  if (originalSDL.includes('directive @openapi')) {
    return originalSDL;
  }
  
  // Append the directive definition
  return originalSDL + '\n' + OPENAPI_DIRECTIVE_DEFINITION;
}

/**
 * Extracts operation name from a GraphQL operation document
 */
export function getOperationName(operationDocument: DocumentNode): string | null {
  const operationDef = operationDocument.definitions.find(
    def => def.kind === 'OperationDefinition'
  );
  
  if (!operationDef || operationDef.kind !== 'OperationDefinition') {
    return null;
  }
  
  return operationDef.name?.value || null;
}