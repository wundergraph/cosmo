import type { Service } from "@/common/service";
import { camelCase, snakeCase, upperFirst } from "lodash";
import type {
  ArgumentMapping,
  FieldMapping,
  OperationMapping,
  ServiceMapping,
  TypeFieldMapping,
} from "@/common/mapping";

// Our lightweight Proto AST types
interface ProtoAST {
  syntax: string;
  package: string;
  services: ProtoService[];
  messages: ProtoMessage[];
}

interface ProtoService {
  name: string;
  rpcs: ProtoRPC[];
}

interface ProtoRPC {
  name: string;
  requestType: string;
  responseType: string;
  isResponseStream?: boolean;
}

interface ProtoMessage {
  name: string;
  fields: ProtoField[];
}

interface ProtoField {
  name: string;
  type: string;
  number: number;
  isRepeated?: boolean;
  isOptional?: boolean;
  oneof?: ProtoOneOf;
}

interface ProtoOneOf {
  name: string;
  fields: ProtoField[];
}

export function intoProto3(svc: Service): {
  proto: ProtoAST;
  mapping: ServiceMapping;
} {
  const ast: ProtoAST = {
    syntax: "proto3",
    package: svc.name,
    services: [],
    messages: [],
  };

  const mapping: ServiceMapping = {
    version: 1,

    service: svc.name,
    operation_mappings: [],
    entity_mappings: [],
    type_field_mappings: [],
  };

  const protoService: ProtoService = {
    name: svc.name,
    rpcs: [],
  };

  const typeFieldMappingMap: Record<
    string,
    Omit<TypeFieldMapping, "type">
  > = {};

  // const typeFieldMapping: TypeFieldMapping = {
  //   type: rpc.kind as string,
  //   field_mappings: [],
  // };

  // RPCs and their request/response messages
  for (const rpc of svc.rpcs) {
    const protoRPCName = formatProtoRPCName(rpc.kind, rpc.name);
    const protoRPCRequest = formatProtoMessageName(`${protoRPCName}_Request`);
    const protoRPCResponse = formatProtoMessageName(`${protoRPCName}_Response`);

    const operationMapping: OperationMapping = {
      kind: rpc.kind,
      original: rpc.name,
      mapped: protoRPCName,
      request: protoRPCRequest,
      response: protoRPCResponse,
    };

    mapping.operation_mappings.push(operationMapping);

    const typeFieldMapping = typeFieldMappingMap[rpc.kind] || {
      field_mappings: [],
    };

    const fieldMapping: FieldMapping = {
      original: rpc.name,
      mapped: protoRPCName,
      argument_mappings: [],
    };

    typeFieldMapping.field_mappings.push(fieldMapping);

    const protoRequestMessage: ProtoMessage = {
      name: protoRPCRequest,
      fields: [],
    };

    for (let [index, argument] of rpc.arguments.entries()) {
      const protoFieldName = formatProtoMessageFieldName(argument.name);

      const argumentMapping: ArgumentMapping = {
        original: argument.name,
        mapped: protoFieldName,
      };

      fieldMapping.argument_mappings.push(argumentMapping);

      protoRequestMessage.fields.push({
        name: protoFieldName,
        type: mapTypeToProtoType(argument.type.name),
        isRepeated: argument.type.list,
        isOptional: !argument.type.required,

        number: index + 1,
      });
    }

    typeFieldMappingMap[rpc.kind] = typeFieldMapping;

    const protoResponseMessage: ProtoMessage = {
      name: protoRPCResponse,
      fields: [
        {
          name: formatProtoMessageFieldName(rpc.name),
          type: mapTypeToProtoType(rpc.type.name),
          isRepeated: rpc.type.list,
          isOptional: !rpc.type.required,

          number: 1,
        },
      ],
    };

    ast.messages.push(protoRequestMessage);
    ast.messages.push(protoResponseMessage);

    protoService.rpcs.push({
      name: protoRPCName,
      requestType: protoRequestMessage.name,
      responseType: protoResponseMessage.name,
    });
  }

  // Normal messages
  for (const message of svc.messages) {
    const protoMessage: ProtoMessage = {
      name: formatProtoMessageName(message.name),
      fields: message.fields.map((field, index) => ({
        name: formatProtoMessageFieldName(field.name),
        type: mapTypeToProtoType(field.type.name),

        isRepeated: field.type.list,
        isOptional: !field.type.required,

        number: index + 1,
      })),
    };

    ast.messages.push(protoMessage);
  }

  ast.services.push(protoService);

  for (const [type, fields] of Object.entries(typeFieldMappingMap)) {
    mapping.type_field_mappings.push({
      type,
      field_mappings: fields.field_mappings,
    });
  }

  console.log(JSON.stringify(mapping, undefined, 2));

  return { proto: ast, mapping: mapping };
}

export function printProto3(ast: ProtoAST): string {
  let output = "";

  // Print syntax and package
  output += `syntax = "${ast.syntax}";\n`;
  output += `package ${ast.package};\n\n`;

  // Print services
  for (const service of ast.services) {
    output += `service ${service.name} {\n`;
    for (const rpc of service.rpcs) {
      const responseType = rpc.isResponseStream
        ? `stream ${rpc.responseType}`
        : rpc.responseType;
      output += `  rpc ${rpc.name}(${rpc.requestType}) returns (${responseType}) {}\n`;
    }
    output += "}\n\n";
  }

  // Sort messages to match expected order
  const sortedMessages = [...ast.messages].sort((a, b) => {
    // First, group messages by their base name (without Request/Response/etc.)
    const aBase = a.name.replace(/(Request|Response|Input|Key|Result)$/, "");
    const bBase = b.name.replace(/(Request|Response|Input|Key|Result)$/, "");

    if (aBase !== bBase) {
      return aBase.localeCompare(bBase);
    }

    // Within the same base name, sort by suffix in specific order
    const suffixOrder = ["Request", "Input", "Key", "Response", "Result"];
    const aIndex = suffixOrder.findIndex((suffix) => a.name.endsWith(suffix));
    const bIndex = suffixOrder.findIndex((suffix) => b.name.endsWith(suffix));

    // If neither has a suffix, keep original order
    if (aIndex === -1 && bIndex === -1) {
      return 0;
    }

    // Put messages without suffix at the end
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;

    return aIndex - bIndex;
  });

  // Print messages
  for (const message of sortedMessages) {
    output += `message ${message.name} {`;
    if (message.fields.length === 0) {
      output += "}\n\n";
      continue;
    }
    output += "\n";
    for (const field of message.fields) {
      if (field.oneof) {
        output += `  oneof ${field.oneof.name} {\n`;
        for (const oneofField of field.oneof.fields) {
          output += `    ${oneofField.type} ${oneofField.name} = ${oneofField.number};\n`;
        }
        output += "  }\n";
      } else {
        const repeated = field.isRepeated ? "repeated " : "";
        const optional = field.isOptional ? "optional " : "";
        output += `  ${repeated}${optional}${field.type} ${field.name} = ${field.number};\n`;
      }
    }
    output += "}\n\n";
  }

  return output.trim();
}

function mapTypeToProtoType(type: string): string {
  const typeMap: Record<string, string> = {
    ID: "string",
    String: "string",
    Int: "int32",
    Float: "float",
    Boolean: "bool",
  };
  return typeMap[type] || formatProtoMessageName(type);
}

function formatProtoMessageFieldName(name: string): string {
  return snakeCase(name);
}

function formatProtoMessageName(name: string): string {
  return upperFirst(camelCase(name));
}

function formatProtoRPCName(type: Operation, name: string): string {
  return `${upperFirst(type)}${formatProtoMessageName(name)}`;
}
