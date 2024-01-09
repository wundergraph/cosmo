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

export type HttpObjMap = {
  [name: string]: string | HttpObjMap;
};

export type HttpConfiguration = {
  sourceName?: string;
  endpoint?: string;
  operationHeaders?: HttpObjMap;
  queryStringOptions?: HttpObjMap;
  queryParams?: HttpObjMap;
};

export type HttpOperationConfiguration = {
  fieldName: string;
  path?: string;
  operationSpecificHeaders?: HttpObjMap;
  httpMethod?: string;
  isBinary?: boolean;
  requestBaseBody?: HttpObjMap;
  queryParamArgMap?: HttpObjMap;
  queryStringOptionsByParam?: HttpObjMap;
};

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requires?: RequiredFieldConfiguration[];
  events?: EventConfiguration[];
  httpConfiguration?: HttpConfiguration;
  httpOperations?: HttpOperationConfiguration[];
  typeName: string;
};

export type ArgumentConfigurationData = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
};
