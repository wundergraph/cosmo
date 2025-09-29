export type VisitNodeResult = {
  visited: boolean;
  areDescendantsResolved: boolean;
  isRevisitedNode?: boolean;
};

export type FieldPath = string;

export type FieldName = string;

export type NodeName = `${SubgraphName}.${TypeName}`;

export type RootCoords = `${TypeName}.${FieldName}`;

export type SelectionPath = string;

export type SubgraphName = string;

export type TypeName = string;

export type RootFieldData = {
  coords: `${TypeName}.${FieldName}`;
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

export type VisitEntityFailure = {
  subgraphNameByUnresolvablePath: Map<SelectionPath, SubgraphName>;
  success: false;
};

export type VisitEntitySuccess = {
  success: true;
};

export type VisitEntityResult = VisitEntityFailure | VisitEntitySuccess;
