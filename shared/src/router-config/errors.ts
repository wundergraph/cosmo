export function normalizationFailureError(objectName: string): Error {
  return new Error(
    `Normalization failed to return a ${objectName}.`
  );
}