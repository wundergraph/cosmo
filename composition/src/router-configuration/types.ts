import { FieldName, TypeName } from '../types/types';

export type NatsEventType = 'subscribe' | 'publish' | 'request';

export type KafkaEventType = 'subscribe' | 'publish';

export type RedisEventType = 'subscribe' | 'publish';

export type StreamConfiguration = {
  consumerInactiveThreshold: number;
  consumerName: string;
  streamName: string;
};

export type KafkaEventConfiguration = {
  fieldName: string;
  providerId: string;
  providerType: 'kafka';
  topics: string[];
  type: KafkaEventType;
};

export type NatsEventConfiguration = {
  fieldName: string;
  providerId: string;
  providerType: 'nats';
  subjects: string[];
  type: NatsEventType;
  streamConfiguration?: StreamConfiguration;
};

export type RedisEventConfiguration = {
  fieldName: string;
  providerId: string;
  providerType: 'redis';
  channels: string[];
  type: RedisEventType;
};

export type EventConfiguration = KafkaEventConfiguration | NatsEventConfiguration | RedisEventConfiguration;

export type SubscriptionFilterValue = boolean | null | number | string;

export type SubscriptionFieldCondition = {
  fieldPath: string[];
  values: SubscriptionFilterValue[];
};

export type SubscriptionCondition = {
  and?: SubscriptionCondition[];
  in?: SubscriptionFieldCondition;
  not?: SubscriptionCondition;
  or?: SubscriptionCondition[];
};

export type FieldConfiguration = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
  subscriptionFilterCondition?: SubscriptionCondition;
  requiresAuthentication?: boolean;
  requiredScopes?: Array<Array<string>>;
  requiredScopesByOR?: Array<Array<string>>;
};

export type FieldSetConditionData = {
  fieldCoordinatesPath: Array<string>;
  fieldPath: Array<string>;
};

export type FieldSetConditionDataParams = {
  fieldCoordinatesPath: Array<string>;
  fieldPath: Array<string>;
};

export type RequiredFieldConfiguration = {
  fieldName: FieldName;
  selectionSet: string;
  conditions?: Array<FieldSetConditionData>;
  disableEntityResolver?: boolean;
};

export type ConfigurationData = {
  fieldNames: Set<FieldName>;
  isRootNode: boolean;
  typeName: TypeName;
  entityInterfaceConcreteTypeNames?: Set<TypeName>;
  events?: EventConfiguration[];
  externalFieldNames?: Set<FieldName>;
  isInterfaceObject?: boolean;
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requireFetchReasonsFieldNames?: Array<FieldName>;
  requires?: RequiredFieldConfiguration[];
};
