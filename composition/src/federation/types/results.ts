import { type ExecutionSuccess } from '../../types/results';
import { type SubscriptionCondition } from '../../router-configuration/types';

export interface SubscriptionFilterTargetSuccess extends ExecutionSuccess {
  condition: SubscriptionCondition;
}
