import { type OperationTypeNode } from 'graphql';
import {
  type ArgumentName,
  type DirectiveArgumentCoords,
  type FieldCoords,
  type FieldName,
  type TypeName,
} from '../types/types';

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

export type RequestScopedFieldConfig = {
  fieldName: FieldName;
  typeName: TypeName;
  // L1 cache key used to store/lookup this field's value for the duration of a request.
  // Format: "{subgraphName}.{key}" where `key` is the @openfed__requestScoped(key:) argument.
  // All fields in the same subgraph declaring @openfed__requestScoped with the same key share
  // the same L1 entry — the first one to resolve populates it, subsequent ones inject
  // from it (subject to widening checks and alias-aware normalization).
  l1Key: string;
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
  entityCaching?: EntityCachingConfiguration;
};

// Extracted from @openfed__entityCache(maxAge: Int!, negativeCacheTTL: Int, includeHeaders: Boolean,
// partialCacheLoad: Boolean, shadowMode: Boolean) on OBJECT types. Defines per-entity cache TTL and behavior.
export type EntityCacheConfiguration = {
  typeName: TypeName;
  maxAgeSeconds: number;
  // TTL (in seconds) for caching "not found" entity responses (entity returned null
  // from _entities without errors). 0 disables negative caching; composition rejects
  // negative values at validation time.
  notFoundCacheTtlSeconds: number;
  // When true, request headers are included in the cache key (useful for user-specific entities).
  includeHeaders: boolean;
  // When true, allows partial cache hits — the router fetches only missing entities from the subgraph.
  partialCacheLoad: boolean;
  // When true, the cache runs in shadow mode — cache reads/writes happen but responses always come
  // from the subgraph. Useful for warming caches or validating correctness without affecting traffic.
  shadowMode: boolean;
};

// Maps a single query argument to an entity's @key field. Every mapping is declared explicitly with
// @openfed__is; an argument is never matched to a @key field by name alone.
// Example: product(productId: ID! @openfed__is(fields: "id")) on a @openfed__queryCache field
//   → entityKeyField: "id", argumentPath: ["productId"]
export type FieldMappingConfig = {
  entityKeyField: FieldName;
  argumentPath: Array<string>;
  isBatch?: boolean;
};

// Groups field mappings for a single entity type returned by a @openfed__queryCache field.
export type EntityKeyMappingConfig = {
  entityTypeName: TypeName;
  fieldMappings: Array<FieldMappingConfig>;
};

// Extracted from @openfed__queryCache(maxAge: Int!, includeHeaders: Boolean, shadowMode: Boolean)
// on Query fields. Tells the router which query fields can serve entities from cache.
export type QueryCacheConfig = {
  fieldName: FieldName;
  maxAgeSeconds: number;
  includeHeaders: boolean;
  shadowMode: boolean;
  // The entity type this query field returns (must have @openfed__entityCache).
  entityTypeName: TypeName;
  // Maps query arguments to entity @key fields so the router can construct cache keys from query
  // arguments. Empty for list-returning fields without batch mappings (cache reads are skipped).
  entityKeyMappings: Array<EntityKeyMappingConfig>;
};

// Extracted from @openfed__cacheInvalidate on Mutation/Subscription fields.
// Tells the router to evict the returned entity from the cache after the operation completes.
export type CacheInvalidateConfiguration = {
  entityTypeName: TypeName;
  fieldName: FieldName;
  operationType: OperationTypeNode;
};

// Extracted from @openfed__cachePopulate on Mutation/Subscription fields.
// Tells the router to populate the entity cache with the operation's return value.
// maxAgeSeconds overrides the entity's default TTL when provided.
export type CachePopulateConfig = {
  entityTypeName: TypeName;
  fieldName: FieldName;
  maxAgeSeconds?: number;
  operationType: string;
};

export type EntityCachingConfiguration = {
  // Attached to the Mutation/Subscription type's ConfigurationData from @openfed__cacheInvalidate.
  cacheInvalidateConfigurations: Array<CacheInvalidateConfiguration>;
  // Attached to an entity type's ConfigurationData (e.g. "Product") from @openfed__entityCache.
  entityCacheConfigurations: Array<EntityCacheConfiguration>;
  // Attached to the Mutation/Subscription type's ConfigurationData from @openfed__cachePopulate.
  cachePopulateConfigurations: Array<CachePopulateConfig>;
  requestScopedFields?: Array<RequestScopedFieldConfig>;
  // Attached to the Query type's ConfigurationData from @openfed__queryCache.
  queryCacheConfigurations?: Array<QueryCacheConfig>;
};

export type Costs = {
  directiveArgumentWeights: Map<DirectiveArgumentCoords, number>;
  fieldWeights: Map<FieldCoords, FieldWeightConfiguration>;
  listSizes: Map<FieldCoords, FieldListSizeConfiguration>;
  typeWeights: Map<TypeName, number>;
};

export type FieldWeightConfiguration = {
  argumentWeights: Map<ArgumentName, number>;
  directiveArgumentWeights: Map<DirectiveArgumentCoords, number>;
  fieldName: FieldName;
  typeName: TypeName;
  weight?: number;
};

export type FieldListSizeConfiguration = {
  fieldName: FieldName;
  requireOneSlicingArgument: boolean;
  sizedFields: Array<FieldName>;
  slicingArguments: Array<ArgumentName>;
  typeName: TypeName;
  assumedSize?: number;
};
