export type ConfigurationDataMap = Map<string, ConfigurationData>;

export type RequiredFieldConfiguration = {
  fieldName: string;
  selectionSet: string;
};

export type EventType = 'subscribe' | 'publish' | 'request';

export type EventConfiguration = {
  type: EventType;
  fieldName: string;
  topic: string;
  sourceId?: string;
};

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requires?: RequiredFieldConfiguration[];
  events?: EventConfiguration[];
  typeName: string;
};

export type ArgumentConfigurationData = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
};
