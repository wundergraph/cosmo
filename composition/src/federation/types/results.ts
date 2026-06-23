import { type ExecutionSuccess, type ExecutionMultiFailure } from '../../types/results';
import { type SubscriptionCondition } from '../../router-configuration/types';

export interface SubscriptionFilterTargetSuccess extends ExecutionSuccess {
  condition: SubscriptionCondition;
}

export type SubscriptionFilterTargetResult = SubscriptionFilterTargetSuccess | ExecutionMultiFailure;
