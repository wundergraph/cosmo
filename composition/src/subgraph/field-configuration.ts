export type ArgumentConfigurationData = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
};

export type RequiredFieldConfiguration = {
  fieldName: string;
  selectionSet: string;
};

export type EventType = 'subscribe' | 'publish' | 'request';

export type EventConfiguration = {
  fieldName: string;
  topic: string;
  type: EventType;
  sourceId?: string;
};

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  typeName: string;
  entityInterfaceConcreteTypeNames?: Set<string>;
  isInterfaceObject?: boolean;
  events?: EventConfiguration[];
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requires?: RequiredFieldConfiguration[];
};

export type ConfigurationDataMap = Map<string, ConfigurationData>;
