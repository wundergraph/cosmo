export type ConfigurationDataMap = Map<string, ConfigurationData>;

export type RequiredFieldConfiguration = {
  fieldName: string;
  selectionSet: string;
};

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requires?: RequiredFieldConfiguration[];
  typeName: string;
};

export type ArgumentConfigurationData = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
};
