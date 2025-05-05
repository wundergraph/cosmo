import {
  Kind,
  parse,
  type DefinitionNode,
  type FieldDefinitionNode,
  type InputObjectTypeDefinitionNode,
  type InputValueDefinitionNode,
  type ObjectTypeDefinitionNode,
  type TypeNode,
} from "graphql";
import {
  type Message,
  type RPC,
  type Field,
  type Service,
  ServiceBuilder,
  type Type,
} from "@/common/service";

export function intoIntermediate(serviceName: string, sdl: string): Service {
  const ast = parse(sdl);

  const svcBuilder = new ServiceBuilder(serviceName);

  for (const node of ast.definitions) {
    switch (node.kind) {
      case Kind.OBJECT_TYPE_DEFINITION:
        switch (node.name.value) {
          case "Subscription":
          case "Mutation":
          case "Query":
            svcBuilder.addRPCs(...operationObjectToRPCs(node));
            break;
          default:
            svcBuilder.addMessages(objectToMessage(node));
            break;
        }

        break;
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
        svcBuilder.addMessages(objectToMessage(node));
        break;
      default:
        console.error("unsupported graphql type used: " + node.kind);
    }
  }

  return svcBuilder.build();
}

function operationObjectToRPCs(node: ObjectTypeDefinitionNode): RPC[] {
  const rpcs: RPC[] = [];

  for (const field of node.fields ?? []) {
    rpcs.push(operationFieldToRPC(node.name.value, field));
  }

  return rpcs;
}

function operationFieldToRPC(type: string, node: FieldDefinitionNode): RPC {
  const rpc: RPC = {
    name: node.name.value,
    kind: "Query",
    type: typeFromTypeNode(node.type),
    arguments: [],
  };

  switch (type) {
    case "Subscription":
      rpc.kind = "Subscription";
      break;
    case "Mutation":
      rpc.kind = "Mutation";
      break;
    case "Query":
      rpc.kind = "Query";
      break;
    default:
      console.error("unsupported graphql type used: " + type);
  }

  for (const field of node.arguments ?? []) {
    rpc.arguments.push(fieldNodeToField(field));
  }

  return rpc;
}

function fieldNodeToField(
  input: InputValueDefinitionNode | FieldDefinitionNode,
): Field {
  const field: Field = {
    name: input.name.value,
    type: typeFromTypeNode(input.type),

    resolved: false,
  };

  return field;
}

function typeFromTypeNode(type: TypeNode): Type {
  const typeObj: Type = { name: "", required: false, list: false };

  let fieldType = type;

  if (fieldType.kind === Kind.NON_NULL_TYPE) {
    typeObj.required = true;
    fieldType = fieldType.type;
  }

  if (fieldType.kind === Kind.LIST_TYPE) {
    typeObj.list = true;
    if (fieldType.type.kind === Kind.NON_NULL_TYPE) {
      fieldType = fieldType.type.type;
    } else {
      fieldType = fieldType.type;
    }
  }

  if (fieldType.kind === Kind.NAMED_TYPE) {
    typeObj.name = fieldType.name.value;
  }

  return typeObj;
}

function objectToMessage(
  node: ObjectTypeDefinitionNode | InputObjectTypeDefinitionNode,
): Message {
  const message: Message = {
    name: node.name.value,
    fields: [],
  };

  for (const field of node.fields ?? []) {
    message.fields.push(fieldNodeToField(field));
  }

  return message;
}
