import { useFeature } from "./use-feature";

/**
 * Returns the limit of feature for the current organization or the organization with the given id.
 * @param feature The feature id
 * @param fallback Optional fallback value
 * @param orgId Optional organization id, defaults to the current organization
 * @returns The feature or undefined
 */
export const useFeatureLimit = <Fallback extends number | undefined>(
  featureId: string,
  fallback?: Fallback,
  orgId?: string,
): Fallback extends number ? number : number | undefined => {
  const feature = useFeature(featureId, orgId);
  return (feature?.limit || fallback) as any;
};
