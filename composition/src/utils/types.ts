export type RootTypeName = 'Mutation' | 'Query' | 'Subscription';

export type InvalidArgumentImplementation = {
  actualType: string;
  argumentName: string;
  expectedType: string;
};

export type InvalidFieldImplementation = {
  implementedResponseType?: string;
  invalidAdditionalArguments: Set<string>;
  invalidImplementedArguments: InvalidArgumentImplementation[];
  isInaccessible: boolean;
  originalResponseType: string;
  unimplementedArguments: Set<string>;
};

export type ImplementationErrors = {
  invalidFieldImplementations: Map<string, InvalidFieldImplementation>;
  unimplementedFields: string[];
};

export type GraphFieldData = {
  name: string;
  namedTypeName: string;
  isLeaf: boolean;
  subgraphNames: Set<string>;
};

// The accumulation of all EntityInterfaceSubgraphData for the type name
export type InvalidRequiredInputValueData = {
  inputValueName: string;
  missingSubgraphs: string[];
  requiredSubgraphs: string[];
};

export type InvalidArgument = {
  argumentName: string;
  namedType: string;
  typeName: string;
  typeString: string;
};

export type InvalidEntityInterface = {
  subgraphName: string;
  concreteTypeNames: Set<string>;
};
