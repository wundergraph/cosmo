export type NatsEventType = 'subscribe' | 'publish' | 'request';

export type KafkaEventType = 'subscribe' | 'publish';

// export type EventType = KafkaEventType | NatsEventType;

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

export type FieldConfiguration = {
  argumentNames: string[];
  fieldName: string;
  typeName: string;
  requiresAuthentication?: boolean;
  requiredScopes?: string[][];
};

export type RequiredFieldConfiguration = {
  fieldName: string;
  selectionSet: string;
  disableEntityResolver?: boolean;
};

export type ConfigurationData = {
  fieldNames: Set<string>;
  isRootNode: boolean;
  typeName: string;
  entityInterfaceConcreteTypeNames?: Set<string>;
  events?: EventConfiguration[];
  isInterfaceObject?: boolean;
  provides?: RequiredFieldConfiguration[];
  keys?: RequiredFieldConfiguration[];
  requires?: RequiredFieldConfiguration[];
};
