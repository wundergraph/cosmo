import {
    DocumentNode,
    FieldNode,
    GraphQLSchema,
    OperationDefinitionNode,
    SelectionSetNode,
    VariableDefinitionNode,
    buildSchema,
    getNamedType,
    isListType,
    isNonNullType,
    parse,
    visit,
} from 'graphql';
import {
    createRequestMessageName,
    createResponseMessageName,
    graphqlFieldToProtoField,
} from './naming-conventions.js';
import type { ProtoLock } from './proto-lock.js';
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
    private usedTypes = new Set<string>();
    private generatedMessages = new Map<string, string>();

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
    }

    visit(): string {
        const parsedOperations = this.operations.map(op => ({
            ...op,
            document: parse(op.content)
        }));

        // Generate service definition
        const serviceMethods = this.generateServiceMethods(parsedOperations);

        // Generate all message types for each operation
        const messages = this.generateMessages(parsedOperations);

        return this.assembleProto(serviceMethods, messages);
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
        const methodName = operationName;
        const messageName = createRequestMessageName(methodName);
        const fields: string[] = [];

        variables.forEach((variable, index) => {
            const fieldName = graphqlFieldToProtoField(variable.variable.name.value);
            const protoType = this.convertVariableTypeToProto(variable.type);
            fields.push(`  ${protoType} ${fieldName} = ${index + 1};`);
        });

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `// Request message for ${operationName} operation.\nmessage ${messageName} {${fieldsStr}}`;
    }

    private convertVariableTypeToProto(typeNode: any): string {
        if (typeNode.kind === 'NonNullType') {
            return this.convertVariableTypeToProto(typeNode.type);
        }

        if (typeNode.kind === 'ListType') {
            return `repeated ${this.convertVariableTypeToProto(typeNode.type)}`;
        }

        if (typeNode.kind === 'NamedType') {
            const typeName = typeNode.name.value;
            switch (typeName) {
                case 'Int': return 'int32';
                case 'String': return 'string';
                case 'Boolean': return 'bool';
                case 'Float': return 'double';
                case 'ID': return 'string';
                default:
                    return 'string';
            }
        }

        return 'string';
    }

    private generateResponseMessage(operationName: string, selectionSet: SelectionSetNode): string {
        const methodName = operationName;
        const messageName = createResponseMessageName(methodName);
        const fields: string[] = [];
        let fieldIndex = 1;

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field') {
                const fieldName = graphqlFieldToProtoField(selection.name.value);
                const schemaField = this.schema.getQueryType()?.getFields()[selection.name.value];

                if (schemaField) {
                    const protoType = this.getOperationSpecificType(operationName, selection, schemaField.type, '');
                    fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
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
                const messageName = this.createNestedMessageName(operationName, fieldPath);

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
            for (const selection of field.selectionSet.selections) {
                if (selection.kind === 'Field') {
                    const fieldName = graphqlFieldToProtoField(selection.name.value);

                    if (selection.selectionSet) {
                        // This field has its own selection set, so it needs a nested message
                        const nestedFieldPath = this.buildFieldPath(fieldPath, selection.name.value);
                        const nestedType = this.createNestedMessageName(operationName, nestedFieldPath);

                        // Check if this should be repeated based on GraphQL schema
                        const schemaField = this.getSchemaFieldFromPath(field.name.value, selection.name.value);
                        const protoType = schemaField && this.isGraphQLListType(schemaField.type)
                            ? `repeated ${nestedType}`
                            : nestedType;

                        fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
                    } else {
                        // Leaf field - use scalar type
                        const protoType = this.getScalarProtoType(selection.name.value);
                        fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
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
            const isListField = this.isGraphQLListType(graphqlType);
            return isListField ? `repeated ${messageName}` : messageName;
        }

        return this.getScalarProtoType(field.name.value);
    }

    private isGraphQLListType(graphqlType: any): boolean {
        // Handle NonNull wrapper
        if (isNonNullType(graphqlType)) {
            return this.isGraphQLListType(graphqlType.ofType);
        }

        // Check if it's a list type
        return isListType(graphqlType);
    }

    private getSchemaFieldFromPath(parentFieldName: string, fieldName: string): any {
        // This is a simplified version - you might need more sophisticated path resolution
        const queryType = this.schema.getQueryType();
        if (!queryType) return null;

        const parentField = queryType.getFields()[parentFieldName];
        if (!parentField) return null;

        // Get the type and navigate to the field
        const parentType = getNamedType(parentField.type);
        if (parentType && 'getFields' in parentType) {
            const fields = (parentType as any).getFields();
            return fields[fieldName];
        }

        return null;
    }

    private getScalarProtoType(fieldName: string): string {
        // Simplified mapping based on common field names
        switch (fieldName) {
            case 'id': return 'int32';
            case 'tag':
            case 'name':
            case 'forename':
            case 'surname': return 'string';
            case 'hasChildren': return 'bool';
            default: return 'string';
        }
    }

    private assembleProto(serviceMethods: string[], messages: string[]): string {
        const parts: string[] = [];

        // Proto header
        parts.push('syntax = "proto3";');
        parts.push(`package ${this.packageName};`);
        parts.push('');

        if (this.goPackage) {
            parts.push(`option go_package = "${this.goPackage}";`);
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
