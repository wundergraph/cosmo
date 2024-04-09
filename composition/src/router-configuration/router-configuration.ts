export type EventType = 'subscribe' | 'publish' | 'request';

export type StreamConfiguration = {
  consumer: string;
  streamName: string;
};

export type EventConfiguration = {
  fieldName: string;
  sourceName: string;
  subjects: string[];
  type: EventType;
  streamConfiguration?: StreamConfiguration;
};

export type FieldConfiguration = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
  requiresAuthentication?: boolean;
  requiredScopes?: string[][];
};

export type RequiredFieldConfiguration = {
  fieldName: string;
  selectionSet: string;
  disableEntityResolver?: boolean;
};

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  typeName: string;
  entityInterfaceConcreteTypeNames?: Set<string>;
  events?: EventConfiguration[];
  isInterfaceObject?: boolean;
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requires?: RequiredFieldConfiguration[];
};
