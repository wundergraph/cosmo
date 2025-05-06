export function normalizationFailureError(objectName: string): Error {
  return new Error(`Normalization failed to return a ${objectName}.`);
}

export function invalidRouterCompatibilityVersion(version: string): Error {
  return new Error(`Invalid router compatibility version "${version}".`);
}
