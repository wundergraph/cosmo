import {
  ASTVisitor,
  ConstDirectiveNode,
  ASTNode,
  Kind,
  ListTypeNode,
  Location,
  parse,
  TypeNode,
  visit,
  FieldDefinitionNode,
  ObjectTypeDefinitionNode,
  NamedTypeNode,
  GraphQLID,
  ConstArgumentNode,
} from 'graphql';
import { CONNECT_CONFIGURE_RESOLVER, CONTEXT } from './string-constants.js';

/**
 * Type mapping from Kind enum values to their corresponding AST node types
 */
type KindToNodeTypeMap = {
  [Kind.LIST_TYPE]: ListTypeNode;
  [Kind.OBJECT_TYPE_DEFINITION]: ObjectTypeDefinitionNode;
  [Kind.FIELD_DEFINITION]: FieldDefinitionNode;
};

/**
 * Helper type to get the AST node type for a given Kind
 */
type NodeTypeForKind<K extends keyof KindToNodeTypeMap> = KindToNodeTypeMap[K];

/**
 * Result of SDL validation containing categorized issues
 */
export interface ValidationResult {
  /** Critical errors that prevent schema processing */
  errors: string[];
  /** Non-critical warnings about potential issues */
  warnings: string[];
}

/**
 * Configuration for a specific validation rule with feature gate support
 */
interface LintingRule<K extends keyof KindToNodeTypeMap = keyof KindToNodeTypeMap> {
  /** Unique identifier for the validation rule */
  name: string;
  /** Human-readable description of what this rule validates */
  description?: string;
  /** Whether this validation rule is currently active */
  enabled: boolean;
  /** The AST node kind this rule applies to */
  nodeKind: K;
  /** The validation function to execute for matching nodes */
  validationFunction: ValidationFunction<K>;
}

type VisitContext<T extends ASTNode> = {
  node: T;
  key: string | number | undefined;
  parent: ASTNode | ReadonlyArray<ASTNode> | undefined;
  path: ReadonlyArray<string | number>;
  ancestors: ReadonlyArray<ASTNode | ReadonlyArray<ASTNode>>;
};

/**
 * Function signature for validation rules that process AST nodes
 */
type ValidationFunction<K extends keyof KindToNodeTypeMap = keyof KindToNodeTypeMap> = (
  ctx: VisitContext<NodeTypeForKind<K>>,
) => void;

/**
 * Additional context information for validation messages
 */
interface MessageContext {
  sourceText?: string;
  suggestion?: string;
}

/**
 * SDL (Schema Definition Language) validation visitor that validates GraphQL schemas
 * against specific rules and constraints. Uses the visitor pattern to traverse
 * the AST and apply configurable validation rules through feature gates.
 */
export class SDLValidationVisitor {
  private readonly schema: string;
  private readonly validationResult: ValidationResult;
  private lintingRules: LintingRule<any>[] = [];
  private visitor: ASTVisitor;

  /**
   * Creates a new SDL validation visitor for the given GraphQL schema
   * @param schema - The GraphQL schema string to validate
   */
  constructor(schema: string) {
    this.schema = schema;
    this.validationResult = {
      errors: [],
      warnings: [],
    };

    this.initializeLintingRules();
    this.visitor = this.createASTVisitor();
  }

  /**
   * Initialize the default set of validation rules (feature gates)
   * Each rule validates a specific aspect of the GraphQL schema
   * @private
   */
  private initializeLintingRules(): void {
    const objectTypeRule: LintingRule<Kind.OBJECT_TYPE_DEFINITION> = {
      name: 'nested-key-directives',
      description: 'Validates that @key directives do not contain nested field selections',
      enabled: true,
      nodeKind: Kind.OBJECT_TYPE_DEFINITION,
      validationFunction: (ctx) => this.validateObjectTypeKeyDirectives(ctx),
    };

    const listTypeRule: LintingRule<Kind.LIST_TYPE> = {
      name: 'nullable-items-in-list-types',
      description: 'Validates that list types do not contain nullable items',
      enabled: true,
      nodeKind: Kind.LIST_TYPE,
      validationFunction: (ctx) => this.validateListTypeNullability(ctx),
    };

    const requiresRule: LintingRule<Kind.FIELD_DEFINITION> = {
      name: 'use-of-requires',
      description: 'Validates usage of @requires directive which is not yet supported',
      enabled: true,
      nodeKind: Kind.FIELD_DEFINITION,
      validationFunction: (ctx) => this.validateRequiresDirective(ctx),
    };

    const providesRule: LintingRule<Kind.FIELD_DEFINITION> = {
      name: 'use-of-provides',
      description: 'Validates usage of @provides directive which is not yet supported',
      enabled: true,
      nodeKind: Kind.FIELD_DEFINITION,
      validationFunction: (ctx) => this.validateProvidesDirective(ctx),
    };

    const resolverContextRule: LintingRule<Kind.FIELD_DEFINITION> = {
      name: 'use-of-invalid-resolver-context',
      description: 'Validates whether a resolver context can be extracted from a type',
      enabled: true,
      nodeKind: Kind.FIELD_DEFINITION,
      validationFunction: (ctx) => this.validateInvalidResolverContext(ctx),
    };

    this.lintingRules = [objectTypeRule, listTypeRule, requiresRule, providesRule, resolverContextRule];
  }

  /**
   * Perform validation by traversing the schema AST and applying all enabled validation rules
   * @returns ValidationResult containing any errors and warnings found during validation
   * @throws Error if the schema cannot be parsed as valid GraphQL
   */
  public visit(): ValidationResult {
    try {
      const astNode = parse(this.schema);
      if (!astNode) {
        throw new Error('Schema parsing resulted in null AST');
      }

      visit(astNode, this.visitor);

      return this.validationResult;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to parse GraphQL schema: ${error.message}`);
      }
      throw new Error('Failed to parse GraphQL schema: Unknown error');
    }
  }

  /**
   * Create the AST visitor with handlers for different node types
   * @returns ASTVisitor configured with validation logic
   * @private
   */
  private createASTVisitor(): ASTVisitor {
    return {
      /**
       * Handle named type nodes (no validation currently needed)
       */
      NamedType: (node) => node,

      /**
       * Handle list type nodes - validate nullability rules
       */
      ListType: (node, key, parent, path, ancestors) => {
        this.executeValidationRules({ node, key, parent, path, ancestors });
        return node;
      },

      /**
       * Handle object type definition nodes - validate directives
       */
      ObjectTypeDefinition: (node, key, parent, path, ancestors) => {
        this.executeValidationRules({ node: node, key, parent, path, ancestors });
        return node;
      },

      /**
       * Handle field definition nodes - validate field-level directives
       */
      FieldDefinition: (node, key, parent, path, ancestors) => {
        this.executeValidationRules({ node, key, parent, path, ancestors });
        return node;
      },
    };
  }

  /**
   * Execute all enabled validation rules that apply to the given AST node
   * @param ctx - The AST node context to validate
   * @private
   */
  private executeValidationRules(ctx: VisitContext<ASTNode>): void {
    const applicableRules = this.lintingRules.filter((rule) => rule.nodeKind === ctx.node.kind && rule.enabled);

    for (const rule of applicableRules) {
      // Type assertion is safe here because we've filtered by nodeKind
      (rule.validationFunction as any)(ctx);
    }
  }

  /**
   * Validate list type nodes to ensure they don't contain nullable items
   * @param ctx - The VisitContext containing the ListTypeNode to validate
   * @private
   */
  private validateListTypeNullability(ctx: VisitContext<ListTypeNode>): void {
    let currentNode: TypeNode = ctx.node;

    // Traverse nested list types to find the innermost type.
    while (currentNode.kind === Kind.LIST_TYPE) {
      currentNode = currentNode.type;

      switch (currentNode.kind) {
        case Kind.NON_NULL_TYPE:
          // If we have a non-null type wrapping another list, return
          if (currentNode.type.kind === Kind.LIST_TYPE) {
            return;
          }
          break;
        case Kind.LIST_TYPE:
          // Nested list found, return
          return;
      }
    }

    // If the innermost type is a named type (not wrapped in NonNull), it's nullable
    if (currentNode.kind === Kind.NAMED_TYPE) {
      const sourceText = this.extractSourceText(ctx.node);
      this.addWarning(`Nullable items are not supported in list types: ${sourceText}`, ctx.node.loc);
    }
  }

  /**
   * Validate @key directives on object type definitions
   * @param ctx - The VisitContext containing the object type definition node to validate
   * @private
   */
  private validateObjectTypeKeyDirectives(ctx: VisitContext<ObjectTypeDefinitionNode>): void {
    if (!ctx.node.directives) {
      return;
    }

    for (const directive of ctx.node.directives) {
      this.validateKeyDirectives(directive);
    }
  }

  /**
   * Validate @key directives to ensure they don't contain nested field selections
   * @param node - The directive node to validate
   * @private
   */
  private validateKeyDirectives(node: ConstDirectiveNode): void {
    if (node.name.value !== 'key') {
      return;
    }

    const keyFields = node.arguments?.find((arg) => arg.name.value === 'fields');
    if (keyFields?.value.kind !== Kind.STRING) {
      this.addWarning('Invalid @key directive: fields argument must be a string', node.loc);
      return;
    }

    const keyFieldsValue = keyFields.value.value;
    if (keyFieldsValue.includes('{')) {
      this.addError('Nested key directives are not supported yet', keyFields.loc);
    }
  }

  /**
   * Validate `@requires` directive usage (currently not supported)
   * @param ctx - The VisitContext containing the field definition node to check for `@requires` directive
   * @private
   */
  private validateRequiresDirective(ctx: VisitContext<FieldDefinitionNode>): void {
    const hasRequiresDirective = ctx.node.directives?.some((directive) => directive.name.value === 'requires');

    if (hasRequiresDirective) {
      this.addWarning('Use of requires is not supported yet', ctx.node.loc);
    }
  }

  /**
   * Validate `@provides` directive usage. This is not supported in connect subgraphs.
   * However `@requires` will be supported in the future.
   * @param ctx - The VisitContext containing the field definition node to check for @provides directive
   * @private
   */
  private validateProvidesDirective(ctx: VisitContext<FieldDefinitionNode>): void {
    const hasProvidesDirective = ctx.node.directives?.some((directive) => directive.name.value === 'provides');
    if (hasProvidesDirective) {
      this.addError('Use of provides is not supported in connect subgraphs', ctx.node.loc);
    }
  }

  /**
   * Validate invalid resolver context usage
   * @param ctx - The VisitContext containing the field definition node to check for invalid resolver context
   * @private
   */
  private validateInvalidResolverContext(ctx: VisitContext<FieldDefinitionNode>): void {
    if (ctx.node.name.value.startsWith('_') || (ctx.node.arguments?.length ?? 0) === 0) {
      return;
    }

    const parent = ctx.ancestors[ctx.ancestors.length - 1];
    // If the parent is not an object type definition node, we don't need to continue with the validation
    if (!this.isASTObjectTypeNode(parent)) {
      return;
    }

    if (parent.name.value === 'Query' || parent.name.value === 'Mutation' || parent.name.value === 'Subscription') {
      return;
    }

    const resolverContext = this.getResolverContext(ctx.node);
    // If the context is invalid, we don't need to continue with the validation
    if (!this.validateResolvedDirectiveContext(ctx, parent, resolverContext)) {
      return;
    }

    this.addWarning(
      `No @${CONNECT_CONFIGURE_RESOLVER} directive found on the field ${ctx.node.name.value} - falling back to ID field`,
      ctx.node.loc,
    );
    const idFields =
      parent.fields?.filter((field) => this.getUnderlyingType(field.type).name.value === GraphQLID.name) ?? [];
    switch (idFields.length) {
      case 1:
        return;
      case 0:
        this.addError('Invalid context provided for resolver. No fields with type ID found', ctx.node.loc);
        return;
      default:
        this.addError(
          `Invalid context provided for resolver. Multiple fields with type ID found - provide a context with the fields you want to use in the @${CONNECT_CONFIGURE_RESOLVER} directive`,
          ctx.node.loc,
        );
    }
  }

  private getResolverContext(node: FieldDefinitionNode): ConstArgumentNode | undefined {
    return node.directives
      ?.find((directive) => directive.name.value === CONNECT_CONFIGURE_RESOLVER)
      ?.arguments?.find((arg) => arg.name.value === CONTEXT);
  }

  /**
   * Validate the context provided for the @resolved directive
   * @param ctx - The VisitContext containing the field definition node to check for @resolved directive
   * @param parent - The parent object type definition node
   * @param node - The argument node for the @resolved directive
   * @returns true if we need to continue with the validation, false otherwise
   * @private
   */
  private validateResolvedDirectiveContext(
    ctx: VisitContext<FieldDefinitionNode>,
    parent: ObjectTypeDefinitionNode,
    node: ConstArgumentNode | undefined,
  ): boolean {
    if (!parent) {
      this.addError('Invalid context provided for resolver. Could not determine parent type', ctx.node.loc);
      return false;
    }

    const fieldNames = this.getContextFields(node);
    if (fieldNames.length === 0) return true;
    const parentFields = this.getParentFields(parent);

    if (parentFields.error) {
      this.addError(parentFields.error, ctx.node.loc);
      return false;
    }

    let invalidFields: string[] = [];
    invalidFields = fieldNames.filter((field) => !parentFields.fields.some((f) => f.name.value === field));
    if (invalidFields.length > 0) {
      this.addError(
        `Invalid context provided for resolver. Context contains invalid fields: ${invalidFields.join(', ')}`,
        ctx.node.loc,
      );
    }

    if (fieldNames.includes(ctx.node.name.value)) {
      this.addError(
        'Invalid context provided for resolver. Cannot contain resolver field in the context',
        ctx.node.loc,
      );
    }

    const { contains, fieldName } = this.isFieldInOtherFieldContext(ctx.node, fieldNames, parentFields.fields);
    if (contains) {
      this.addError(
        `Cycle detected in context: field ${ctx.node.name.value} is referenced in the context of field ${fieldName}`,
        ctx.node.loc,
      );
    }

    return false;
  }

  /**
   * Get the fields from the context value
   * @param node - The argument node for the @resolved directive
   * @returns The fields from the context value
   * @private
   */
  private getContextFields(node: ConstArgumentNode | undefined): string[] {
    if (!node) return [];

    let value = node?.value.kind === Kind.STRING ? node.value.value.trim() : '';
    if (value.length === 0) {
      return [];
    }

    return value
      .split(/[,\s]+/)
      .filter((field) => field.length > 0)
      .map((field) => field.trim());
  }

  /**
   * Check if a field is in the context of another field. This is used to detect cycles in the context.
   * @param field - The field to check
   * @param contextFields - The fields in the context
   * @param parentFields - The fields in the parent
   * @returns true if the field is in the context of another field, false otherwise
   * @private
   */
  private isFieldInOtherFieldContext(
    field: FieldDefinitionNode,
    contextFields: string[],
    parentFields: FieldDefinitionNode[],
  ): { contains: boolean; fieldName: string } {
    if (parentFields.length === 0) return { contains: false, fieldName: '' };

    const fieldName = field.name.value;

    for (const contextField of contextFields) {
      if (contextField === fieldName) continue;

      let parentField = parentFields.find((p) => p.name.value === contextField);
      if (!parentField) continue;

      const parentContext = this.getResolverContext(parentField);
      if (!parentContext) continue;

      const parentContextFields = this.getContextFields(parentContext);
      if (parentContextFields.includes(fieldName)) {
        return { contains: true, fieldName: parentField.name.value };
      }
    }

    return { contains: false, fieldName: '' };
  }

  /**
   * Get the underlying NamedTypeNode of a TypeNode
   * @param type - The type node to get the underlying NamedTypeNode of
   * @returns The underlying NamedTypeNode of the TypeNode
   * @private
   */
  private getUnderlyingType(type: TypeNode): NamedTypeNode {
    while (type.kind !== Kind.NAMED_TYPE) {
      type = type.type;
    }

    return type;
  }

  /**
   * Get the fields of the parent object type definition
   * @param parent - The parent object type definition node
   * @returns The fields of the parent object type definition
   * @private
   */
  private getParentFields(parent: ASTNode | ReadonlyArray<ASTNode>): { fields: FieldDefinitionNode[]; error: string } {
    const result: { fields: FieldDefinitionNode[]; error: string } = { fields: [], error: '' };

    if (!this.isASTObjectTypeNode(parent)) {
      result.error = 'Invalid context provided for resolver. Could not determine parent type';
      return result;
    }

    if (!parent.fields || parent.fields.length === 0) {
      result.error = 'Invalid context provided for resolver. Parent type has no fields';
      return result;
    }

    result.fields = Array.from(parent.fields ?? []);
    return result;
  }

  /**
   * Check if the node is an AST object type definition node
   * @param node - The node to check
   * @returns true if the node is an AST object type definition node, false otherwise
   * @private
   */
  private isASTObjectTypeNode(node: ASTNode | ReadonlyArray<ASTNode>): node is ObjectTypeDefinitionNode {
    return !Array.isArray(node) && 'kind' in node && node.kind === Kind.OBJECT_TYPE_DEFINITION;
  }

  /**
   * Enable or disable a specific validation rule by name
   * @param ruleName - The name of the rule to configure
   * @param enabled - Whether the rule should be enabled
   * @returns true if the rule was found and configured, false otherwise
   */
  public configureRule(ruleName: string, enabled: boolean): boolean {
    const rule = this.lintingRules.find((gate) => gate.name === ruleName);
    if (rule) {
      rule.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Get information about all available validation rules
   * @returns Array of rule configurations
   */
  public getAvailableRules(): Readonly<LintingRule<any>[]> {
    return Object.freeze([...this.lintingRules]);
  }

  /**
   * Check if the validation found any critical errors
   * @returns true if errors were found, false otherwise
   */
  public hasErrors(): boolean {
    return this.validationResult.errors.length > 0;
  }

  /**
   * Check if the validation found any warnings
   * @returns true if warnings were found, false otherwise
   */
  public hasWarnings(): boolean {
    return this.validationResult.warnings.length > 0;
  }

  /**
   * Add a warning to the validation results
   * @param message - The warning message
   * @param location - Optional source location where the issue was found
   * @param context - Additional context information
   * @private
   */
  private addWarning(message: string, location?: Location, context?: MessageContext): void {
    this.validationResult.warnings.push(this.formatMessage('Warning', message, location, context));
  }

  /**
   * Add an error to the validation results
   * @param message - The error message
   * @param location - Optional source location where the issue was found
   * @param context - Additional context information
   * @private
   */
  private addError(message: string, location?: Location, context?: MessageContext): void {
    this.validationResult.errors.push(this.formatMessage('Error', message, location, context));
  }

  /**
   * Format a validation message with consistent structure
   * @param level - The severity level (Error/Warning)
   * @param message - The main message
   * @param location - Optional source location
   * @param context - Additional context information
   * @returns Formatted message string
   * @private
   */
  private formatMessage(
    level: 'Error' | 'Warning',
    message: string,
    location?: Location,
    context?: MessageContext,
  ): string {
    const parts: string[] = [`[${level}]`, message];

    if (location) {
      parts.push(`at line ${location.startToken.line}, column ${location.startToken.column}`);
    }

    if (context?.sourceText) {
      parts.push(`(found: "${context.sourceText}")`);
    }

    if (context?.suggestion) {
      parts.push(`Suggestion: ${context.suggestion}`);
    }

    return parts.join(' ');
  }

  /**
   * Extract source text from an AST node for debugging purposes
   * @param node - The AST node to extract text from
   * @returns The source text or a placeholder if unavailable
   * @private
   */
  private extractSourceText(node: ASTNode): string {
    if (node.loc?.source.body && node.loc.start !== undefined && node.loc.end !== undefined) {
      return node.loc.source.body.slice(node.loc.start, node.loc.end);
    }
    return '<source unavailable>';
  }
}
