export type NatsEventType = 'subscribe' | 'publish' | 'request';

export type KafkaEventType = 'subscribe' | 'publish';

export type StreamConfiguration = {
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

export type EventConfiguration = KafkaEventConfiguration | NatsEventConfiguration;

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
  requiredScopes?: string[][];
};

export type FieldSetCondition = {
  fieldCoordinatesPath: Array<string>;
  fieldPath: Array<string>;
};

export type FieldSetConditionOptions = {
  fieldCoordinatesPath: Array<string>;
  fieldPath: Array<string>;
};

export function newFieldSetConditionData({
  fieldCoordinatesPath,
  fieldPath,
}: FieldSetConditionOptions): FieldSetCondition {
  return {
    fieldCoordinatesPath,
    fieldPath,
  };
}

export type RequiredFieldConfiguration = {
  fieldName: string;
  selectionSet: string;
  conditions?: Array<FieldSetCondition>;
  disableEntityResolver?: boolean;
};

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  typeName: string;
  entityInterfaceConcreteTypeNames?: Set<string>;
  events?: EventConfiguration[];
  externalFieldNames?: Set<string>;
  isInterfaceObject?: boolean;
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requires?: RequiredFieldConfiguration[];
};
