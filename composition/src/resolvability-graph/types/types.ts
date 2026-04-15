export type VisitNodeResult = {
  visited: boolean;
  areDescendantsResolved: boolean;
  isExternal?: true;
  isRevisitedNode?: true;
};

export type FieldName = string;

export type FieldCoords = `${TypeName}.${FieldName}`;

export type NodeName = `${SubgraphName}.${TypeName}`;

export type SelectionPath = string;

export type SubgraphName = string;

export type TypeName = string;

export type RootFieldData = {
  coords: FieldCoords;
  message: string;
  subgraphNames: Set<SubgraphName>;
};

export type ValidationFailure = {
  errors: Array<Error>;
  success: false;
};

export type ValidationSuccess = {
  success: true;
};

export type ValidationResult = ValidationFailure | ValidationSuccess;
