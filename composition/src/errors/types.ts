export type InvalidRootTypeFieldEventsDirectiveData = {
  definesDirectives: boolean;
  invalidDirectiveNames: string[];
};

export type IncompatibleMergedTypesErrorParams = {
  actualType: string;
  expectedType: string;
  coords: string;
  isArgument?: boolean;
};
