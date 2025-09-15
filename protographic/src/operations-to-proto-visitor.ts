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
    createOperationMethodName,
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

            // For persisted operations, we use the operation name directly as the method name
            // since it already contains the semantic meaning (e.g., "GetEmployeeByID")
            const methodName = upperFirst(camelCase(operationName));
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
            const nestedMessages = this.generateNestedMessages(operationName, operation.selectionSet);
            messages.push(...nestedMessages);
        }

        return messages;
    }

    private generateRequestMessage(operationName: string, variables: readonly VariableDefinitionNode[]): string {
        const methodName = upperFirst(camelCase(operationName));
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
            // For non-null types, unwrap and convert the inner type
            return this.convertVariableTypeToProto(typeNode.type);
        }

        if (typeNode.kind === 'ListType') {
            // For list types, add repeated keyword
            return `repeated ${this.convertVariableTypeToProto(typeNode.type)}`;
        }

        if (typeNode.kind === 'NamedType') {
            // Convert GraphQL scalar types to proto types
            const typeName = typeNode.name.value;
            switch (typeName) {
                case 'Int': return 'int32';
                case 'String': return 'string';
                case 'Boolean': return 'bool';
                case 'Float': return 'double';
                case 'ID': return 'string';
                default:
                    // For custom scalar or object types, you might want to handle them differently
                    // For now, treating them as strings
                    return 'string';
            }
        }

        // Fallback
        return 'string';
    }

    private generateResponseMessage(operationName: string, selectionSet: SelectionSetNode): string {
        const messageName = createResponseMessageName(operationName);
        const fields: string[] = [];
        let fieldIndex = 1;

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field') {
                const fieldName = graphqlFieldToProtoField(selection.name.value);
                const schemaField = this.schema.getQueryType()?.getFields()[selection.name.value];

                if (schemaField) {
                    const protoType = this.getOperationSpecificType(operationName, selection, schemaField.type);
                    fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
                }
            }
        }

        const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
        return `// Response message for ${operationName} operation.\nmessage ${messageName} {${fieldsStr}}`;
    }

    private generateNestedMessages(operationName: string, selectionSet: SelectionSetNode): string[] {
        const messages: string[] = [];

        for (const selection of selectionSet.selections) {
            if (selection.kind === 'Field' && selection.selectionSet) {
                const nestedMessages = this.generateNestedMessageForField(operationName, selection);
                messages.push(...nestedMessages);
            }
        }

        return messages;
    }

    private generateNestedMessageForField(operationName: string, field: FieldNode): string[] {
        const messages: string[] = [];
        const fieldPath = this.buildFieldPath(operationName, field.name.value);

        if (field.selectionSet) {
            const messageName = this.createNestedMessageName(operationName, fieldPath);
            const fields: string[] = [];
            let fieldIndex = 1;

            for (const selection of field.selectionSet.selections) {
                if (selection.kind === 'Field') {
                    const fieldName = graphqlFieldToProtoField(selection.name.value);

                    if (selection.selectionSet) {
                        // This field has its own selection set, so it needs a nested message
                        const nestedType = this.createNestedMessageName(operationName,
                            this.buildFieldPath(fieldPath, selection.name.value));
                        const protoType = this.wrapTypeIfList(nestedType, selection);
                        fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);

                        // Recursively generate nested messages
                        const deeperMessages = this.generateNestedMessageForField(operationName, selection);
                        messages.push(...deeperMessages);
                    } else {
                        // Leaf field - use scalar type
                        const protoType = this.getScalarProtoType(selection.name.value);
                        fields.push(`  ${protoType} ${fieldName} = ${fieldIndex++};`);
                    }
                }
            }

            const fieldsStr = fields.length > 0 ? '\n' + fields.join('\n') + '\n' : '';
            messages.unshift(`message ${messageName} {${fieldsStr}}`);
        }

        return messages;
    }

    private createNestedMessageName(operationName: string, fieldPath: string): string {
        // Convert GetEmployeeByID + Employee.Details.Location -> GetEmployeeByIDEmployeeDetailsLocation
        const pascalCaseOperation = operationName.charAt(0).toUpperCase() + operationName.slice(1);
        const pascalCasePath = fieldPath.split('.').map(part =>
            part.charAt(0).toUpperCase() + part.slice(1)
        ).join('');
        return `${pascalCaseOperation}${pascalCasePath}`;
    }

    private buildFieldPath(basePath: string, fieldName: string): string {
        const capitalizedField = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
        return basePath ? `${basePath}.${capitalizedField}` : capitalizedField;
    }

    private getOperationSpecificType(operationName: string, field: FieldNode, graphqlType: any): string {
        if (field.selectionSet) {
            const fieldPath = this.buildFieldPath('', field.name.value);
            const messageName = this.createNestedMessageName(operationName, fieldPath);
            return this.wrapTypeIfList(messageName, field);
        }

        return this.getScalarProtoType(field.name.value);
    }

    private wrapTypeIfList(baseType: string, field: FieldNode): string {
        // This is simplified - you'd need to check the actual GraphQL type
        // For now, assume arrays based on field name patterns
        const fieldName = field.name.value;
        if (fieldName.endsWith('s') || fieldName === 'pets') {
            return `repeated ${baseType}`;
        }
        return baseType;
    }

    private getScalarProtoType(fieldName: string): string {
        // Simplified mapping - in reality, you'd check the actual GraphQL type
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
        parts.push('');

        // Messages
        parts.push(...messages);

        return parts.join('\n');
    }
}
