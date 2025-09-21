
import {
    buildSchema,
    DocumentNode,
    FieldNode,
    FragmentDefinitionNode,
    FragmentSpreadNode,
    getNamedType,
    GraphQLField,
    GraphQLInputObjectType,
    GraphQLInterfaceType,
    GraphQLList,
    GraphQLNamedType,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLSchema,
    GraphQLType,
    GraphQLUnionType,
    InlineFragmentNode,
    isEnumType,
    isInterfaceType,
    isObjectType,
    isUnionType,
    OperationDefinitionNode,
    parse,
    SelectionSetNode,
    VariableDefinitionNode,
} from 'graphql';
import {createRequestMessageName, createResponseMessageName, graphqlFieldToProtoField,} from './naming-conventions.js';
import type {ProtoLock} from './proto-lock.js';
import {ProtoLockManager} from './proto-lock.js';
import {
    collectEnumsFromTypeNode,
    convertVariableTypeToProto,
    extractInputTypesFromGraphQLType,
    generateEnumDefinition,
    generateInputMessageFromSchema,
    getProtoTypeFromGraphQL,
    getRootTypeForOperation,
    isGraphQLListType,
    processInputTypeQueue,
    SCALAR_TYPE_MAP,
} from './proto-utils.js';
import {camelCase, upperFirst} from "lodash-es";

export interface OperationToProtoOptions {
    serviceName?: string;
    packageName?: string;
    goPackage?: string;
    lockData?: ProtoLock;
}

export interface OperationInfo {
    name: string;
    content: string;
    filePath?: string;
}

export class OperationToProtoVisitor {
    private schema: GraphQLSchema;
    private operations: OperationInfo[];
    private serviceName: string;
    private packageName: string;
    private goPackage?: string;
    private lockManager: ProtoLockManager;
    private usesWrapperTypes = false;
    private enumsUsed = new Set<string>();
    private fragments = new Map<string, FragmentDefinitionNode>();

    constructor(
        schemaOrSDL: GraphQLSchema | string,
        operations: OperationInfo[],
        options: OperationToProtoOptions = {}
    ) {
        this.schema = typeof schemaOrSDL === 'string'
            ? buildSchema(schemaOrSDL, { assumeValid: true, assumeValidSDL: true })
            : schemaOrSDL;

        this.operations = operations;
        this.serviceName = options.serviceName || 'DefaultService';
        this.packageName = options.packageName || 'service.v1';
        this.goPackage = options.goPackage;
        this.lockManager = new ProtoLockManager(options.lockData);
    }

    visit(): string {
        const parsedOperations = this.operations.map(op => ({
            ...op,
            document: parse(op.content)
        }));

        // Collect all fragment definitions from all operations
        this.collectFragmentDefinitions(parsedOperations);

        // Validate operations against schema
        for (const { document, name } of parsedOperations) {
            // Find the first OperationDefinition in the document
            const operation = document.definitions.find(def => def.kind === 'OperationDefinition') as OperationDefinitionNode;
            
            if (!operation) {
                throw new Error(`No OperationDefinition found in document for operation "${name}". The GraphQL file must contain at least one operation (query, mutation, or subscription).`);
            }
            
            // Count how many operations are in this document
            const operationCount = document.definitions.filter(def => def.kind === 'OperationDefinition').length;
            if (operationCount > 1) {
                throw new Error(`Multiple OperationDefinitions found in document for operation "${name}". Each GraphQL file should contain exactly one operation definition. Found ${operationCount} operations.`);
            }
            
            this.validateOperationAgainstSchema(operation);
        }

        // Generate service definition
        const serviceMethods = this.generateServiceMethods(parsedOperations);

        // Generate all message types for each operation
        const messages = this.generateMessages(parsedOperations);

        // Generate enum definitions for all enums used in operations
        const enums = this.generateEnumDefinitions();

        return this.assembleProto(serviceMethods, messages, enums);
    }

    /**
     * Get the generated lock data
     */
    public getGeneratedLockData(): ProtoLock | null {
        return this.lockManager.getLockData();
    }

    /**
     * Collect all fragment definitions from parsed operations
     */
    private collectFragmentDefinitions(parsedOperations: { name: string; document: DocumentNode }[]): void {
        for (const { document, name } of parsedOperations) {
            for (const definition of document.definitions) {
                if (definition.kind === 'FragmentDefinition') {
                    const fragmentName = definition.name.value;
                    if (this.fragments.has(fragmentName)) {
                        throw new Error(`Duplicate fragment definition "${fragmentName}"`);
                    }
                    this.fragments.set(fragmentName, definition);
                }
            }
        }
    }

    /**
     * Validate a fragment spread against the parent type
     */
    private validateFragmentSpread(fragmentSpread: FragmentSpreadNode, parentType: GraphQLNamedType): void {
        const fragmentName = fragmentSpread.name.value;
        const fragment = this.fragments.get(fragmentName);
        
        if (!fragment) {
            throw new Error(`Unknown fragment "${fragmentName}"`);
        }

        // Check for circular dependencies
        this.checkCircularFragmentDependency(fragmentName, new Set());

        // Validate fragment type compatibility
        const fragmentTypeName = fragment.typeCondition.name.value;
        const fragmentType = this.schema.getTypeMap()[fragmentTypeName];
        
        if (!fragmentType) {
            throw new Error(`Unknown type "${fragmentTypeName}" in fragment "${fragmentName}"`);
        }

        // Check if fragment can be spread on parent type
        if (!this.canFragmentBeSpreadOnType(fragmentType, parentType)) {
            throw new Error(`Fragment "${fragmentName}" cannot be spread on type "${parentType.name}"`);
        }
    }

    /**
     * Check for circular fragment dependencies
     */
    private checkCircularFragmentDependency(fragmentName: string, visited: Set<string>): void {
        if (visited.has(fragmentName)) {
            const cycle = Array.from(visited).concat(fragmentName).join(' -> ');
            throw new Error(`Circular fragment dependency detected: ${cycle}`);
        }

        const fragment = this.fragments.get(fragmentName);
        if (!fragment) return;

        visited.add(fragmentName);

        // Check all fragment spreads within this fragment
        this.findFragmentSpreadsInSelectionSet(fragment.selectionSet, (spreadName) => {
            this.checkCircularFragmentDependency(spreadName, new Set(visited));
        });

        visited.delete(fragmentName);
    }

    /**
     * Find all fragment spreads in a selection set
     */
    private findFragmentSpreadsInSelectionSet(selectionSet: SelectionSetNode, callback: (fragmentName: string) => void): void {
        for (const selection of selectionSet.selections) {
            if (selection.kind === 'FragmentSpread') {
                callback(selection.name.value);
            } else if (selection.kind === 'Field' && selection.selectionSet) {
                this.findFragmentSpreadsInSelectionSet(selection.selectionSet, callback);
            } else if (selection.kind === 'InlineFragment' && selection.selectionSet) {
                this.findFragmentSpreadsInSelectionSet(selection.selectionSet, callback);
            }
        }
    }

    /**
     * Check if a fragment can be spread on a given type
     */
    private canFragmentBeSpreadOnType(fragmentType: GraphQLType, parentType: GraphQLType): boolean {
        // Same type
        if (fragmentType === parentType) {
            return true;
        }

        // Fragment type is an interface that parent type implements
        if (isInterfaceType(fragmentType) && isObjectType(parentType)) {
            return parentType.getInterfaces().includes(fragmentType);
        }

        // Fragment type is a union member that includes parent type
        if (isUnionType(fragmentType) && isObjectType(parentType)) {
            return fragmentType.getTypes().includes(parentType);
        }

        // Parent type is an interface that fragment type implements
        if (isObjectType(fragmentType) && isInterfaceType(parentType)) {
            return fragmentType.getInterfaces().includes(parentType);
        }

        // Both are interfaces with compatible hierarchy
        if (isInterfaceType(fragmentType) && isInterfaceType(parentType)) {
            // Check if they share any implementing types
            const fragmentImplementors = this.schema.getPossibleTypes(fragmentType);
            const parentImplementors = this.schema.getPossibleTypes(parentType);
            return fragmentImplementors.some(type => parentImplementors.includes(type));
        }

        return false;
    }

    /**
     * Expand fragment spreads in a selection set
     */
    private expandFragmentSpreads(selectionSet: SelectionSetNode): SelectionSetNode {
        const expandedSelections = [];

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'FragmentSpread') {
                const fragment = this.fragments.get(selection.name.value);
                if (fragment) {
                    // Recursively expand the fragment's selection set
                    const expandedFragmentSelections = this.expandFragmentSpreads(fragment.selectionSet);
                    expandedSelections.push(...expandedFragmentSelections.selections);
                }
            } else if (selection.kind === 'Field' && selection.selectionSet) {
                // Recursively expand nested selection sets
                const expandedSelectionSet = this.expandFragmentSpreads(selection.selectionSet);
                expandedSelections.push({
                    ...selection,
                    selectionSet: expandedSelectionSet
                });
            } else if (selection.kind === 'InlineFragment' && selection.selectionSet) {
                // Recursively expand inline fragment selection sets
                const expandedSelectionSet = this.expandFragmentSpreads(selection.selectionSet);
                expandedSelections.push({
                    ...selection,
                    selectionSet: expandedSelectionSet
                });
            } else {
                expandedSelections.push(selection);
            }
        }

        return {
            ...selectionSet,
            selections: expandedSelections
        };
    }

    /**
     * Validate an operation against the schema
     */
    private validateOperationAgainstSchema(operation: OperationDefinitionNode): void {
        const operationType = operation.operation;
        const rootType = getRootTypeForOperation(this.schema, operationType);
        
        if (!rootType) {
            throw new Error(`Schema does not define ${operationType} type`);
        }

        // Validate all fields in the selection set exist in the schema
        this.validateSelectionSet(operation.selectionSet, rootType);
    }

    /**
     * Recursively validate a selection set against a GraphQL type
     */
    private validateSelectionSet(selectionSet: SelectionSetNode, parentType: GraphQLType): void {
        const namedParentType: GraphQLNamedType = getNamedType(parentType);
        
        if (!isObjectType(namedParentType) && !isInterfaceType(namedParentType)) {
            return; // Skip validation for scalar/enum types
        }

        const fields = namedParentType.getFields();

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field') {
                const field = fields[selection.name.value];
                if (!field) {
                    throw new Error(`Field '${selection.name.value}' not found on type '${namedParentType.name}'`);
                }

                // Recursively validate nested selection sets
                if (selection.selectionSet) {
                    this.validateSelectionSet(selection.selectionSet, field.type);
                }
            } else if (selection.kind === 'FragmentSpread') {
                // Validate fragment spread
                this.validateFragmentSpread(selection, namedParentType);
            } else if (selection.kind === 'InlineFragment') {
                // Validate inline fragments - they should target valid types
                if (selection.typeCondition) {
                    const fragmentTypeName = selection.typeCondition.name.value;
                    const fragmentType = this.schema.getTypeMap()[fragmentTypeName];
                    if (!fragmentType) {
                        throw new Error(`Unknown type '${fragmentTypeName}' in inline fragment`);
                    }
                    
                    // Recursively validate the inline fragment's selection set
                    if (selection.selectionSet) {
                        this.validateSelectionSet(selection.selectionSet, fragmentType);
                    }
                }
            }
        }
    }

    private generateServiceMethods(operations: { name: string; document: DocumentNode }[]): string[] {
        return operations.map(({ name, document }) => {
            const operation = document.definitions.find(def => def.kind === 'OperationDefinition') as OperationDefinitionNode;
            if (!operation) {
                throw new Error(`No operation definition found in document for ${name}`);
            }
            const operationName = operation.name?.value || name;

            // Use the operation name directly for persisted operations
            const methodName = operationName;
            const requestType = createRequestMessageName(methodName);
            const responseType = createResponseMessageName(methodName);

            return `  rpc ${methodName}(${requestType}) returns (${responseType}) {}`;
        });
    }

    private generateMessages(operations: { name: string; document: DocumentNode }[]): string[] {
        const messages: string[] = [];
        const inputTypesGenerated = new Set<string>();

        for (const { name, document } of operations) {
            const operation = document.definitions.find(def => def.kind === 'OperationDefinition') as OperationDefinitionNode;
            if (!operation) {
                throw new Error(`No operation definition found in document for ${name}`);
            }
            const operationName = operation.name?.value || name;

            // Collect enum types used in variables
            this.collectEnumsFromVariables(operation.variableDefinitions || []);

            // Collect enum types used in selection set
            this.collectEnumsFromSelectionSet(operation.selectionSet, operation);

            // Generate input message types from variables (if not already generated)
            const inputMessages = this.generateInputMessages(operation.variableDefinitions || [], inputTypesGenerated);
            messages.push(...inputMessages);

            // Generate request message from variables
            const requestMessage = this.generateRequestMessage(operationName, operation.variableDefinitions || []);
            messages.push(requestMessage);

            // Generate response message from selection set
            const responseMessage = this.generateResponseMessage(operationName, operation.selectionSet, operation);
            messages.push(responseMessage);

            // Generate nested messages for this operation
            const nestedMessages = this.generateNestedMessages(operationName, operation.selectionSet, '', operation);
            messages.push(...nestedMessages);
        }

        return messages;
    }

    private generateRequestMessage(operationName: string, variables: readonly VariableDefinitionNode[]): string {
        const messageName = createRequestMessageName(operationName);
        const fields: string[] = [];

        // Get field names and order them using the lock manager
        const fieldNames = variables.map(v => graphqlFieldToProtoField(v.variable.name.value));
        const orderedFieldNames = this.lockManager.reconcileMessageFieldOrder(messageName, fieldNames);

        // Generate fields in the ordered sequence
        orderedFieldNames.forEach((fieldName, index) => {
            const variable = variables.find(v => graphqlFieldToProtoField(v.variable.name.value) === fieldName);
            if (variable) {
                // Convert TypeNode to GraphQL type and use wrapper types for nullable variables
                const graphqlType = this.typeNodeToGraphQLType(variable.type);
                const wrapperTracker = { usesWrapperTypes: this.usesWrapperTypes };
                const protoType = getProtoTypeFromGraphQL(graphqlType, false, wrapperTracker);
                this.usesWrapperTypes = wrapperTracker.usesWrapperTypes;
                
                if (protoType.isRepeated) {
                    fields.push(`  repeated ${protoType.typeName} ${fieldName} = ${index + 1};`);
                } else {
                    fields.push(`  ${protoType.typeName} ${fieldName} = ${index + 1};`);
                }
            }
        });

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `// Request message for ${operationName} operation.\nmessage ${messageName} {${fieldsStr}}`;
    }


    private generateResponseMessage(operationName: string, selectionSet: SelectionSetNode, operation: OperationDefinitionNode): string {
        const messageName = createResponseMessageName(operationName);
        const fields: string[] = [];
        let fieldIndex = 1;

        // Expand fragment spreads before processing
        const expandedSelectionSet = this.expandFragmentSpreads(selectionSet);

        // Get the root type based on operation type
        const rootType = getRootTypeForOperation(this.schema, operation.operation);
        if (!rootType) {
            throw new Error(`Schema does not define ${operation.operation} type`);
        }

        for (const selection of expandedSelectionSet.selections) {
            if (selection.kind === 'Field') {
                const fieldName = graphqlFieldToProtoField(selection.name.value);
                const schemaField = rootType.getFields()[selection.name.value];

                if (schemaField) {
                    const protoType = this.getOperationSpecificType(operationName, selection, schemaField.type, '', operation);
                    fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
                } else {
                    throw new Error(`Field '${selection.name.value}' not found on ${operation.operation} type`);
                }
            }
        }

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `// Response message for ${operationName} operation.\nmessage ${messageName} {${fieldsStr}}`;
    }

    private generateNestedMessages(operationName: string, selectionSet: SelectionSetNode, currentPath: string, operation: OperationDefinitionNode, contextType?: GraphQLObjectType | GraphQLInterfaceType, fragmentTypeName?: string): string[] {
        const messages: string[] = [];

        // Expand fragment spreads before processing
        const expandedSelectionSet = this.expandFragmentSpreads(selectionSet);

        for (const selection of expandedSelectionSet.selections) {
            if (selection.kind === 'Field' && selection.selectionSet) {
                // If we're within a fragment, include the fragment type name in the path to avoid conflicts
                const fieldPath = fragmentTypeName
                    ? this.buildFieldPath(currentPath, `${fragmentTypeName}${upperFirst(camelCase(selection.name.value))}`)
                    : this.buildFieldPath(currentPath, selection.name.value);

                // Generate the nested message with the context type (fragment type if available)
                const nestedMessage = this.generateNestedMessageForField(operationName, selection, fieldPath, operation, contextType);
                messages.push(nestedMessage);

                // For deeper nested messages, resolve the field type as the new context
                let fieldType: GraphQLObjectType | GraphQLInterfaceType | undefined;
                if (contextType) {
                    const schemaField = contextType.getFields()[selection.name.value];
                    if (schemaField) {
                        const namedType = getNamedType(schemaField.type);
                        if (isObjectType(namedType) || isInterfaceType(namedType)) {
                            fieldType = namedType;
                        }
                    }
                }

                // Recursively generate deeper nested messages
                // Don't pass fragmentTypeName to deeper levels - it should only apply to the immediate level
                // Pass the resolved field type as the new context type
                const deeperMessages = this.generateNestedMessages(operationName, selection.selectionSet, fieldPath, operation, fieldType);
                messages.push(...deeperMessages);
            } else if (selection.kind === 'InlineFragment' && selection.selectionSet) {
                // Generate messages for inline fragment types
                const fragmentMessages = this.generateInlineFragmentMessages(operationName, selection, currentPath, operation);
                messages.push(...fragmentMessages);
            }
        }

        return messages;
    }

    private generateNestedMessageForField(operationName: string, field: FieldNode, fieldPath: string, operation: OperationDefinitionNode, contextType?: GraphQLObjectType | GraphQLInterfaceType): string {
        const messageName = this.createNestedMessageName(operationName, fieldPath);
        const fields: string[] = [];
        let fieldIndex = 1;

        if (field.selectionSet) {
            // Check if this selection set contains only inline fragments (union/interface case)
            const hasOnlyInlineFragments = field.selectionSet.selections.every(s => s.kind === 'InlineFragment');
            const hasInlineFragments = field.selectionSet.selections.some(s => s.kind === 'InlineFragment');
            
            if (hasOnlyInlineFragments) {
                // This is a union type - only inline fragments, no regular fields
                const oneofFields = this.generateOneofFieldsForUnion(operationName, field.selectionSet, fieldPath);
                fields.push(...oneofFields);
                fieldIndex += oneofFields.length;
            } else {
                // This is an interface or object type with regular fields and possibly inline fragments
                // Resolve the actual parent type for this field
                let parentType: GraphQLObjectType | GraphQLInterfaceType;
                
                if (contextType) {
                    // If we have a context type, we need to resolve the field type from it
                    // This handles the case where we're processing fields within an inline fragment
                    const contextField = contextType.getFields()[field.name.value];
                    if (contextField) {
                        const fieldReturnType = getNamedType(contextField.type);
                        if (isObjectType(fieldReturnType) || isInterfaceType(fieldReturnType)) {
                            parentType = fieldReturnType;
                        } else {
                            throw new Error(`Field '${field.name.value}' on type '${contextType.name}' does not return an object or interface type`);
                        }
                    } else {
                        throw new Error(`Field '${field.name.value}' not found on context type '${contextType.name}'`);
                    }
                } else {
                    // No context type provided, resolve from path
                    const resolvedType = this.resolveParentTypeForField(field.name.value, fieldPath, operation);
                    if (!resolvedType) {
                        throw new Error(`Cannot resolve parent type for field '${field.name.value}' at path '${fieldPath}'`);
                    }
                    parentType = resolvedType;
                }

                if (hasInlineFragments) {
                    // Handle polymorphic types with oneof
                    const oneofFields = this.generateOneofFields(operationName, field.selectionSet, fieldPath, parentType);
                    fields.push(...oneofFields);
                    fieldIndex += oneofFields.length;
                }

                // Process regular fields - these should come first, before oneof
                const regularFields: string[] = [];
                let regularFieldIndex = 1;
                
                for (const selection of field.selectionSet.selections) {
                    if (selection.kind === 'Field') {
                        const fieldName = graphqlFieldToProtoField(selection.name.value);

                        // Get the GraphQL field from the parent type
                        const schemaField = parentType.getFields()[selection.name.value];
                        if (!schemaField) {
                            throw new Error(`Field '${selection.name.value}' not found on type '${parentType.name}'`);
                        }

                        if (selection.selectionSet) {
                            // This field has its own selection set, so it needs a nested message
                            const nestedFieldPath = this.buildFieldPath(fieldPath, selection.name.value);
                            const nestedType = this.createNestedMessageName(operationName, nestedFieldPath);

                            // Use the proven list type detection from proto-utils
                            const protoType = isGraphQLListType(schemaField.type)
                                ? `repeated ${nestedType}`
                                : nestedType;

                            regularFields.push(`  ${protoType} ${fieldName} = ${regularFieldIndex++};`);
                        } else {
                            // Leaf field - use the battle-tested getProtoTypeFromGraphQL method
                            const wrapperTracker = { usesWrapperTypes: this.usesWrapperTypes };
                            const protoType = getProtoTypeFromGraphQL(schemaField.type, false, wrapperTracker);
                            this.usesWrapperTypes = wrapperTracker.usesWrapperTypes;
                            
                            // Handle repeated types correctly
                            if (protoType.isRepeated) {
                                regularFields.push(`  repeated ${protoType.typeName} ${fieldName} = ${regularFieldIndex++};`);
                            } else {
                                regularFields.push(`  ${protoType.typeName} ${fieldName} = ${regularFieldIndex++};`);
                            }
                        }
                    }
                }
                
                // Add regular fields first, then oneof fields
                if (hasInlineFragments) {
                    // Put regular fields first, then oneof
                    const reorderedFields = [...regularFields];
                    const oneofStartIndex = regularFieldIndex;
                    const oneofFields = this.generateOneofFields(operationName, field.selectionSet, fieldPath, parentType);
                    // Update oneof field indices
                    const updatedOneofFields = oneofFields.map(line => {
                        if (line.includes(' = ')) {
                            return line.replace(/ = (\d+);/, (match, num) => ` = ${parseInt(num) + oneofStartIndex - 1};`);
                        }
                        return line;
                    });
                    reorderedFields.push(...updatedOneofFields);
                    fields.splice(fields.length - oneofFields.length, oneofFields.length, ...reorderedFields);
                } else {
                    fields.push(...regularFields);
                }
            }
        }

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `message ${messageName} {${fieldsStr}}`;
    }

    /**
     * Generate oneof fields for polymorphic types (interfaces and unions)
     */
    private generateOneofFields(
        operationName: string,
        selectionSet: SelectionSetNode,
        fieldPath: string,
        parentType: GraphQLObjectType | GraphQLInterfaceType
    ): string[] {
        const oneofFields: string[] = [];
        const inlineFragments = selectionSet.selections.filter(s => s.kind === 'InlineFragment') as InlineFragmentNode[];
        
        if (inlineFragments.length === 0) {
            return oneofFields;
        }

        // Create a oneof field for the polymorphic type
        const oneofName = 'type_specific';
        oneofFields.push(`  oneof ${oneofName} {`);
        
        let oneofFieldIndex = 1;
        for (const fragment of inlineFragments) {
            if (fragment.typeCondition) {
                const fragmentTypeName = fragment.typeCondition.name.value;
                const fragmentMessageName = this.createInlineFragmentMessageName(operationName, fieldPath, fragmentTypeName);
                const protoFieldName = graphqlFieldToProtoField(fragmentTypeName.toLowerCase());
                
                oneofFields.push(`    ${fragmentMessageName} ${protoFieldName} = ${oneofFieldIndex++};`);
            }
        }
        
        oneofFields.push('  }');
        return oneofFields;
    }

    /**
     * Generate oneof fields for union types (only inline fragments, no regular fields)
     */
    private generateOneofFieldsForUnion(
        operationName: string,
        selectionSet: SelectionSetNode,
        fieldPath: string
    ): string[] {
        const oneofFields: string[] = [];
        const inlineFragments = selectionSet.selections.filter(s => s.kind === 'InlineFragment') as InlineFragmentNode[];
        
        if (inlineFragments.length === 0) {
            return oneofFields;
        }

        // Create a oneof field for the union type
        const oneofName = 'type_specific';
        oneofFields.push(`  oneof ${oneofName} {`);
        
        let oneofFieldIndex = 1;
        for (const fragment of inlineFragments) {
            if (fragment.typeCondition) {
                const fragmentTypeName = fragment.typeCondition.name.value;
                const fragmentMessageName = this.createInlineFragmentMessageName(operationName, fieldPath, fragmentTypeName);
                const protoFieldName = graphqlFieldToProtoField(fragmentTypeName.toLowerCase());
                
                oneofFields.push(`    ${fragmentMessageName} ${protoFieldName} = ${oneofFieldIndex++};`);
            }
        }
        
        oneofFields.push('  }');
        return oneofFields;
    }

    /**
     * Generate messages for inline fragments
     */
    private generateInlineFragmentMessages(
        operationName: string,
        fragment: InlineFragmentNode,
        currentPath: string,
        operation: OperationDefinitionNode
    ): string[] {
        const messages: string[] = [];
        
        if (!fragment.typeCondition || !fragment.selectionSet) {
            return messages;
        }

        const fragmentTypeName = fragment.typeCondition.name.value;
        const fragmentType = this.schema.getTypeMap()[fragmentTypeName];
        
        if (!fragmentType || (!isObjectType(fragmentType) && !isInterfaceType(fragmentType))) {
            return messages;
        }

        // Generate message for this fragment type
        const fragmentMessageName = this.createInlineFragmentMessageName(operationName, currentPath, fragmentTypeName);
        const fragmentMessage = this.generateFragmentMessage(operationName, fragment, fragmentMessageName, fragmentType);
        messages.push(fragmentMessage);

        // For nested messages within fragments, use the current path and pass the fragment type as context
        // Pass the fragment type name only for the immediate level to ensure unique message names
        const nestedMessages = this.generateNestedMessages(operationName, fragment.selectionSet, currentPath, operation, fragmentType, fragmentTypeName);
        messages.push(...nestedMessages);

        return messages;
    }

    /**
     * Generate a message for an inline fragment
     */
    private generateFragmentMessage(
        operationName: string,
        fragment: InlineFragmentNode,
        messageName: string,
        fragmentType: GraphQLObjectType | GraphQLInterfaceType
    ): string {
        const fields: string[] = [];
        let fieldIndex = 1;

        if (!fragment.selectionSet) {
            return `message ${messageName} {}`;
        }

        const typeFields = fragmentType.getFields();

        for (const selection of fragment.selectionSet.selections) {
            if (selection.kind === 'Field') {
                const fieldName = graphqlFieldToProtoField(selection.name.value);
                const schemaField = typeFields[selection.name.value];

                if (schemaField) {
                    if (selection.selectionSet) {
                        // This field has its own selection set, so it needs a nested message
                        const nestedFieldPath = `${messageName}${upperFirst(camelCase(selection.name.value))}`;
                        const nestedType = nestedFieldPath;

                        // Use the proven list type detection from proto-utils
                        const protoType = isGraphQLListType(schemaField.type)
                            ? `repeated ${nestedType}`
                            : nestedType;

                        fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
                    } else {
                        // Leaf field - use the battle-tested getProtoTypeFromGraphQL method
                        const wrapperTracker = { usesWrapperTypes: this.usesWrapperTypes };
                        const protoType = getProtoTypeFromGraphQL(schemaField.type, false, wrapperTracker);
                        this.usesWrapperTypes = wrapperTracker.usesWrapperTypes;
                        fields.push(`  ${protoType.typeName} ${fieldName} = ${fieldIndex++};`);
                    }
                }
            }
        }

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `message ${messageName} {${fieldsStr}}`;
    }

    /**
     * Create a message name for an inline fragment
     */
    private createInlineFragmentMessageName(operationName: string, fieldPath: string, fragmentTypeName: string): string {
        const pascalCaseOperation = operationName;
        const pascalCasePath = fieldPath.split('.').map(part =>
            upperFirst(camelCase(part))
        ).join('');
        const pascalCaseFragment = upperFirst(camelCase(fragmentTypeName));
        
        return `${pascalCaseOperation}${pascalCasePath}${pascalCaseFragment}`;
    }

    private createNestedMessageName(operationName: string, fieldPath: string): string {
        // Convert GetEmployeeByID + Employee -> GetEmployeeByIDEmployee
        const pascalCaseOperation = operationName;
        const pascalCasePath = fieldPath.split('.').map(part =>
            upperFirst(camelCase(part))
        ).join('');
        return `${pascalCaseOperation}${pascalCasePath}`;
    }

    private buildFieldPath(basePath: string, fieldName: string): string {
        const capitalizedField = upperFirst(camelCase(fieldName));
        return basePath ? `${basePath}.${capitalizedField}` : capitalizedField;
    }

    private getOperationSpecificType(operationName: string, field: FieldNode, graphqlType: any, currentPath: string, operation: OperationDefinitionNode): string {
        if (field.selectionSet) {
            const fieldPath = this.buildFieldPath(currentPath, field.name.value);
            const messageName = this.createNestedMessageName(operationName, fieldPath);

            // Check if the GraphQL type is a list type
            const isListField = isGraphQLListType(graphqlType);
            return isListField ? `repeated ${messageName}` : messageName;
        }

        // For leaf fields without selection sets, try to resolve from schema
        try {
            const rootType = getRootTypeForOperation(this.schema, operation.operation);
            if (rootType) {
                const schemaField = rootType.getFields()[field.name.value];
                if (schemaField) {
                    const wrapperTracker = { usesWrapperTypes: this.usesWrapperTypes };
                    const protoType = getProtoTypeFromGraphQL(schemaField.type, false, wrapperTracker);
                    this.usesWrapperTypes = wrapperTracker.usesWrapperTypes;
                    return protoType.typeName;
                }
            }
        } catch (error) {
            // Fallback to string if resolution fails
        }
        return 'string';
    }

    /**
     * Resolve the parent GraphQL type for a field in the operation context
     * This handles union types, interface types, and regular object types
     */
    private resolveParentTypeForField(fieldName: string, fieldPath: string, operation: OperationDefinitionNode): GraphQLObjectType | GraphQLInterfaceType | null {
        // Start from the root type based on operation type
        const rootType = getRootTypeForOperation(this.schema, operation.operation);
        if (!rootType) return null;

        // If no path, the parent is the root type
        if (!fieldPath) {
            return rootType;
        }

        // Navigate through the path to find the parent type
        let currentType: GraphQLType = rootType;
        
        // Split the path and navigate through each part
        const pathParts = fieldPath.split('.').filter(p => p.length > 0);
        
        for (let i = 0; i < pathParts.length; i++) {
            const pathPart = pathParts[i];
            const namedType: GraphQLNamedType = getNamedType(currentType);
            
            // Check if this path part is a fragment-specific compound name (e.g., "ConsultancyLead")
            // This happens when we have inline fragments and we combine the fragment type with field name
            if (pathPart.length > 0) {
                // First, check if this path part is a direct fragment type name
                const fragmentType = this.schema.getTypeMap()[pathPart];
                if (fragmentType && (isObjectType(fragmentType) || isInterfaceType(fragmentType))) {
                    currentType = fragmentType;
                    continue;
                }
                
                // Check if this is a compound name from inline fragments (e.g., "ConsultancyLead")
                // Try to find a fragment type that this path part starts with
                const typeMap = this.schema.getTypeMap();
                for (const typeName of Object.keys(typeMap)) {
                    const type = typeMap[typeName];
                    if ((isObjectType(type) || isInterfaceType(type)) && pathPart.startsWith(typeName)) {
                        // This path part starts with a known type name, so it's likely a compound name
                        // Extract the field name part (everything after the type name)
                        const fieldNamePart = pathPart.substring(typeName.length);
                        if (fieldNamePart.length > 0) {
                            // Use the fragment type as current type and continue with the field name
                            currentType = type;
                            
                            // Now resolve the field name part
                            const graphqlFieldName = this.convertPascalCaseToGraphQLField(fieldNamePart);
                            const field: GraphQLField<any, any> | undefined = type.getFields()[graphqlFieldName];
                            if (field) {
                                currentType = field.type;
                                continue;
                            }
                        }
                    }
                }
            }
            
            if (isObjectType(namedType) || isInterfaceType(namedType)) {
                // Convert PascalCase path part back to camelCase field name
                const graphqlFieldName = this.convertPascalCaseToGraphQLField(pathPart);
                
                const field: GraphQLField<any, any> | undefined = namedType.getFields()[graphqlFieldName];
                if (!field) {
                    return null;
                }
                
                currentType = field.type;
            } else if (isUnionType(namedType)) {
                // For union types, the path part represents a union member type
                // Look for the union member type that matches this path part
                const unionMemberTypes = namedType.getTypes();
                const memberType = unionMemberTypes.find(type => type.name === pathPart);
                if (!memberType) {
                    return null;
                }
                currentType = memberType;
            } else {
                return null;
            }
        }

        // Return the final type as the parent
        const finalType = getNamedType(currentType);
        if (isObjectType(finalType) || isInterfaceType(finalType)) {
            return finalType;
        }

        return null;
    }


    /**
     * Convert PascalCase field path part to camelCase GraphQL field name
     */
    private convertPascalCaseToGraphQLField(pathPart: string): string {
        return camelCase(pathPart);
    }

    /**
     * Generate input message types from GraphQL input types referenced in variables
     * Now uses shared logic from proto-utils for nested input support
     */
    private generateInputMessages(variables: readonly VariableDefinitionNode[], inputTypesGenerated: Set<string>): string[] {
        const inputTypes: GraphQLInputObjectType[] = [];

        // Collect all input types from variables (including nested dependencies)
        for (const variable of variables) {
            const graphqlType = this.typeNodeToGraphQLType(variable.type);
            const variableInputTypes = extractInputTypesFromGraphQLType(graphqlType, this.schema);
            inputTypes.push(...variableInputTypes);
        }

        // Remove duplicates
        const uniqueInputTypes = inputTypes.filter((type, index, array) =>
            array.findIndex(t => t.name === type.name) === index
        );

        // Filter out already generated types
        const newInputTypes = uniqueInputTypes.filter(type => !inputTypesGenerated.has(type.name));

        if (newInputTypes.length === 0) {
            return [];
        }

        // Use shared logic to process input types with dependency resolution
        const wrapperTracker = { usesWrapperTypes: this.usesWrapperTypes };
        const messages = processInputTypeQueue(
            newInputTypes,
            this.schema,
            this.lockManager,
            false, // includeComments - operations visitor doesn't include comments
            wrapperTracker
        );
        this.usesWrapperTypes = wrapperTracker.usesWrapperTypes;

        // Mark all types as generated
        newInputTypes.forEach(type => inputTypesGenerated.add(type.name));

        return messages;
    }


    /**
     * Collect enum types used in operation variables
     */
    private collectEnumsFromVariables(variables: readonly VariableDefinitionNode[]): void {
        for (const variable of variables) {
            collectEnumsFromTypeNode(variable.type, this.schema, this.enumsUsed);
        }
    }

    /**
     * Collect enum types used in selection sets
     */
    private collectEnumsFromSelectionSet(selectionSet: SelectionSetNode, operation: OperationDefinitionNode): void {
        const rootType = getRootTypeForOperation(this.schema, operation.operation);
        if (!rootType) return;

        // Expand fragment spreads before collecting enums
        const expandedSelectionSet = this.expandFragmentSpreads(selectionSet);
        this.collectEnumsFromSelectionSetRecursive(expandedSelectionSet, rootType);
    }

    /**
     * Recursively collect enum types from selection sets
     */
    private collectEnumsFromSelectionSetRecursive(selectionSet: SelectionSetNode, parentType: GraphQLType): void {
        const namedParentType: GraphQLNamedType = getNamedType(parentType);
        
        if (!isObjectType(namedParentType) && !isInterfaceType(namedParentType) && !isUnionType(namedParentType)) {
            return; // Skip for scalar/enum types
        }

        // Handle union types - process inline fragments
        if (isUnionType(namedParentType)) {
            for (const selection of selectionSet.selections) {
                if (selection.kind === 'InlineFragment') {
                    if (selection.typeCondition && selection.selectionSet) {
                        const fragmentTypeName = selection.typeCondition.name.value;
                        const fragmentType = this.schema.getTypeMap()[fragmentTypeName];
                        if (fragmentType && (isObjectType(fragmentType) || isInterfaceType(fragmentType))) {
                            this.collectEnumsFromSelectionSetRecursive(selection.selectionSet, fragmentType);
                        }
                    }
                }
            }
            return;
        }

        // Handle object and interface types
        const fields = namedParentType.getFields();

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field') {
                const field = fields[selection.name.value];
                if (field) {
                    // Check if the field type is an enum
                    const fieldType = getNamedType(field.type);
                    if (isEnumType(fieldType)) {
                        this.enumsUsed.add(fieldType.name);
                    }

                    // Recursively check nested selection sets
                    if (selection.selectionSet) {
                        this.collectEnumsFromSelectionSetRecursive(selection.selectionSet, field.type);
                    }
                }
            } else if (selection.kind === 'InlineFragment') {
                // Handle inline fragments - collect enums from fragment types
                if (selection.typeCondition && selection.selectionSet) {
                    const fragmentTypeName = selection.typeCondition.name.value;
                    const fragmentType = this.schema.getTypeMap()[fragmentTypeName];
                    if (fragmentType && (isObjectType(fragmentType) || isInterfaceType(fragmentType))) {
                        this.collectEnumsFromSelectionSetRecursive(selection.selectionSet, fragmentType);
                    }
                }
            }
        }
    }

    /**
     * Generate Protocol Buffer enum definitions for all enums used in operations
     */
    private generateEnumDefinitions(): string[] {
        const enumDefinitions: string[] = [];

        for (const enumName of this.enumsUsed) {
            const enumType = this.schema.getTypeMap()[enumName];
            if (enumType && isEnumType(enumType)) {
                const enumDef = generateEnumDefinition(enumType, this.lockManager, false);
                enumDefinitions.push(enumDef);
            }
        }

        return enumDefinitions;
    }

    private assembleProto(serviceMethods: string[], messages: string[], enums: string[]): string {
        const parts: string[] = [];

        // Build imports and options
        const imports: string[] = [];
        const options: string[] = [];

        // Add wrapper import if needed
        if (this.usesWrapperTypes) {
            imports.push('google/protobuf/wrappers.proto');
        }

        if (this.goPackage) {
            options.push(`option go_package = "${this.goPackage}";`);
        }

        // Proto header
        parts.push('syntax = "proto3";');
        parts.push(`package ${this.packageName};`);
        parts.push('');

        // Add imports
        for (const importPath of imports) {
            parts.push(`import "${importPath}";`);
        }
        if (imports.length > 0) {
            parts.push('');
        }

        // Add options
        for (const option of options) {
            parts.push(option);
        }
        if (options.length > 0) {
            parts.push('');
        }

        // Service definition
        parts.push(`// Service definition for ${this.serviceName}`);
        parts.push(`service ${this.serviceName} {`);
        parts.push(...serviceMethods);
        parts.push('}');
        parts.push(''); // Add spacing after service

        // Enum definitions with spacing between each enum
        for (let i = 0; i < enums.length; i++) {
            parts.push(enums[i]);
            // Add empty line after each enum (except the last one)
            if (i < enums.length - 1) {
                parts.push('');
            }
        }

        // Add spacing between enums and messages if both exist
        if (enums.length > 0 && messages.length > 0) {
            parts.push('');
        }

        // Messages with spacing between each message
        for (let i = 0; i < messages.length; i++) {
            parts.push(messages[i]);
            // Add empty line after each message (except the last one)
            if (i < messages.length - 1) {
                parts.push('');
            }
        }

        return parts.join('\n');
    }

    /**
     * Convert a GraphQL TypeNode to a GraphQL type
     */
    private typeNodeToGraphQLType(typeNode: any): GraphQLType {
        if (typeNode.kind === 'NonNullType') {
            const innerType = this.typeNodeToGraphQLType(typeNode.type);
            return new GraphQLNonNull(innerType);
        } else if (typeNode.kind === 'ListType') {
            const innerType = this.typeNodeToGraphQLType(typeNode.type);
            return new GraphQLList(innerType);
        } else if (typeNode.kind === 'NamedType') {
            const typeName = typeNode.name.value;
            const type = this.schema.getTypeMap()[typeName];
            if (!type) {
                throw new Error(`Unknown type: ${typeName}`);
            }
            return type;
        }
        throw new Error(`Unknown type node kind: ${typeNode.kind}`);
    }

}
