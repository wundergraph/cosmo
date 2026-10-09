import { type FieldCoords, type PolicyName, type TypeName } from '../../../types/types';

export type ORPolicies = Array<Set<PolicyName>>;

export type UnsatisfiedPolicyData = {
  fieldCoords: Set<FieldCoords>;
  typeNames: Set<TypeName>;
};
