export const useActiveResponseHeaders = (activeResponse: string, activeHeader: string) =>
  activeResponse ? activeHeader : undefined;
