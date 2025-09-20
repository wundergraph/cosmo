import {
    buildSchema,
    DocumentNode,
    FieldNode,
    getNamedType,
    GraphQLField,
    GraphQLInterfaceType,
    GraphQLNamedType,
    GraphQLObjectType,
    GraphQLSchema,
    GraphQLType,
    isInterfaceType,
    isObjectType,
    OperationDefinitionNode,
    parse,
    SelectionSetNode,
    VariableDefinitionNode,
} from 'graphql';
import {createRequestMessageName, createResponseMessageName, graphqlFieldToProtoField,} from './naming-conventions.js';
import type {ProtoLock} from './proto-lock.js';
import {ProtoLockManager} from './proto-lock.js';
import {
    convertVariableTypeToProto,
    getProtoTypeFromGraphQL,
    getRootTypeForOperation,
    isGraphQLListType,
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

        // Validate operations against schema
        for (const { document } of parsedOperations) {
            const operation = document.definitions[0] as OperationDefinitionNode;
            this.validateOperationAgainstSchema(operation);
        }

        // Generate service definition
        const serviceMethods = this.generateServiceMethods(parsedOperations);

        // Generate all message types for each operation
        const messages = this.generateMessages(parsedOperations);

        return this.assembleProto(serviceMethods, messages);
    }

    /**
     * Get the generated lock data
     */
    public getGeneratedLockData(): ProtoLock | null {
        return this.lockManager.getLockData();
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
            }
        }
    }

    private generateServiceMethods(operations: { name: string; document: DocumentNode }[]): string[] {
        return operations.map(({ name, document }) => {
            const operation = document.definitions[0] as OperationDefinitionNode;
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

        for (const { name, document } of operations) {
            const operation = document.definitions[0] as OperationDefinitionNode;
            const operationName = operation.name?.value || name;

            // Generate request message from variables
            const requestMessage = this.generateRequestMessage(operationName, operation.variableDefinitions || []);
            messages.push(requestMessage);

            // Generate response message from selection set
            const responseMessage = this.generateResponseMessage(operationName, operation.selectionSet);
            messages.push(responseMessage);

            // Generate nested messages for this operation
            const nestedMessages = this.generateNestedMessages(operationName, operation.selectionSet, '');
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
                const protoType = convertVariableTypeToProto(variable.type);
                fields.push(`  ${protoType} ${fieldName} = ${index + 1};`);
            }
        });

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `// Request message for ${operationName} operation.\nmessage ${messageName} {${fieldsStr}}`;
    }


    private generateResponseMessage(operationName: string, selectionSet: SelectionSetNode): string {
        const messageName = createResponseMessageName(operationName);
        const fields: string[] = [];
        let fieldIndex = 1;

        // Get the root type based on operation type (assume Query for now, can be enhanced)
        const rootType = this.schema.getQueryType();
        if (!rootType) {
            throw new Error('Schema does not define Query type');
        }

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field') {
                const fieldName = graphqlFieldToProtoField(selection.name.value);
                const schemaField = rootType.getFields()[selection.name.value];

                if (schemaField) {
                    const protoType = this.getOperationSpecificType(operationName, selection, schemaField.type, '');
                    fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
                } else {
                    throw new Error(`Field '${selection.name.value}' not found on Query type`);
                }
            }
        }

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `// Response message for ${operationName} operation.\nmessage ${messageName} {${fieldsStr}}`;
    }

    private generateNestedMessages(operationName: string, selectionSet: SelectionSetNode, currentPath: string): string[] {
        const messages: string[] = [];

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field' && selection.selectionSet) {
                const fieldPath = this.buildFieldPath(currentPath, selection.name.value);

                // Generate the nested message
                const nestedMessage = this.generateNestedMessageForField(operationName, selection, fieldPath);
                messages.push(nestedMessage);

                // Recursively generate deeper nested messages
                const deeperMessages = this.generateNestedMessages(operationName, selection.selectionSet, fieldPath);
                messages.push(...deeperMessages);
            }
        }

        return messages;
    }

    private generateNestedMessageForField(operationName: string, field: FieldNode, fieldPath: string): string {
        const messageName = this.createNestedMessageName(operationName, fieldPath);
        const fields: string[] = [];
        let fieldIndex = 1;

        if (field.selectionSet) {
            // Resolve the GraphQL type for this field using the schema
            const parentType = this.resolveParentTypeForField(field.name.value, fieldPath);
            if (!parentType) {
                throw new Error(`Cannot resolve parent type for field '${field.name.value}' at path '${fieldPath}'`);
            }

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

    private getOperationSpecificType(operationName: string, field: FieldNode, graphqlType: any, currentPath: string): string {
        if (field.selectionSet) {
            const fieldPath = this.buildFieldPath(currentPath, field.name.value);
            const messageName = this.createNestedMessageName(operationName, fieldPath);

            // Check if the GraphQL type is a list type
            const isListField = isGraphQLListType(graphqlType);
            return isListField ? `repeated ${messageName}` : messageName;
        }

        // For leaf fields without selection sets, try to resolve from schema
        try {
            const rootType = this.schema.getQueryType();
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
     * This is a simplified version that focuses on the specific use case
     */
    private resolveParentTypeForField(fieldName: string, fieldPath: string): GraphQLObjectType | GraphQLInterfaceType | null {
        // Start from the root type (Query for now - can be enhanced for Mutation/Subscription)
        const rootType = this.schema.getQueryType();
        if (!rootType) return null;

        // If no path, the parent is the root type
        if (!fieldPath) {
            return rootType;
        }

        // Navigate through the path to find the parent type
        let currentType: GraphQLType = rootType;
        
        // Split the path and navigate through each part
        const pathParts = fieldPath.split('.').filter(p => p.length > 0);
        for (const pathPart of pathParts) {
            const namedType: GraphQLNamedType = getNamedType(currentType);
            if (!isObjectType(namedType) && !isInterfaceType(namedType)) {
                return null;
            }
            
            // Convert PascalCase path part back to camelCase field name
            const graphqlFieldName = this.convertPascalCaseToGraphQLField(pathPart);
            const field: GraphQLField<any, any> | undefined = namedType.getFields()[graphqlFieldName];
            if (!field) {
                return null;
            }
            
            currentType = field.type;
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

    private assembleProto(serviceMethods: string[], messages: string[]): string {
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

}
