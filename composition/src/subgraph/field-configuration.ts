export type ConfigurationDataMap = Map<string, ConfigurationData>;

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  selectionSets: string[];
  typeName: string;
};

export type ArgumentConfigurationData = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
};