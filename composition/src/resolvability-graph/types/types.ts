export type ValidateNodeResult = {
  visited: boolean;
  areDescendentsResolved: boolean;
};

export type FieldPath = string;

export type FieldName = string;

export type NodeName = `${SubgraphName}.${TypeName}`;

export type RootCoords = `${TypeName}.${FieldName}`;

export type SubgraphName = string;

export type TypeName = string;