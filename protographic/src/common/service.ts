export interface Service {
  name: string;
  rpcs: RPC[];
  messages: Message[];
}

export class ServiceBuilder {
  private name: string;
  private rpcs: RPC[] = [];
  private messages: Message[] = [];

  constructor(name: string) {
    this.name = name;
  }

  addRPCs(...rpcs: RPC[]): void {
    this.rpcs.push(...rpcs);
  }

  addMessages(...messages: Message[]): void {
    this.messages.push(...messages);
  }

  build(): Service {
    return {
      name: this.name,
      rpcs: this.rpcs,
      messages: this.messages,
    };
  }
}

export interface RPC {
  name: string;
  kind: "Query" | "Mutation" | "Subscription";
  arguments: Field[];
  type: Type;
}

export interface Message {
  name: string;
  fields: Field[];
}

export interface Field {
  name: string;
  type: Type;

  resolved: boolean;
}

export interface Type {
  name: string;
  list: boolean;
  required: boolean;
}
