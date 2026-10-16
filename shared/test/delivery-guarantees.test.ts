import { describe, expect, test } from 'vitest';
import { type ConfigurationData, type EventConfiguration, type TypeName } from '@wundergraph/composition';
import { DeliveryGuaranteeMode } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { configurationDatasToDataSourceConfiguration } from '../src/router-config/graphql-configuration';

function subscriptionConfigurationData(events: Array<EventConfiguration>): Map<TypeName, ConfigurationData> {
  return new Map<TypeName, ConfigurationData>([
    [
      'Subscription',
      {
        fieldNames: new Set<string>(events.map((event) => event.fieldName)),
        isRootNode: true,
        typeName: 'Subscription',
        events,
      },
    ],
  ]);
}

describe('Delivery guarantees proto generation tests', () => {
  test('that deliveryGuarantees is propagated to the Kafka engine event configuration', () => {
    const { events } = configurationDatasToDataSourceConfiguration(
      subscriptionConfigurationData([
        {
          deliveryGuarantees: { mode: 'CURSOR' },
          fieldName: 'kafkaField',
          providerId: 'default',
          providerType: 'kafka',
          topics: ['topic'],
          type: 'subscribe',
        },
      ]),
    );
    expect(events.kafka[0].engineEventConfiguration?.deliveryGuarantees?.mode).toBe(DeliveryGuaranteeMode.CURSOR);
  });

  test('that deliveryGuarantees is not set if it is absent from the event configuration', () => {
    const { events } = configurationDatasToDataSourceConfiguration(
      subscriptionConfigurationData([
        {
          fieldName: 'kafkaField',
          providerId: 'default',
          providerType: 'kafka',
          topics: ['topic'],
          type: 'subscribe',
        },
      ]),
    );
    expect(events.kafka[0].engineEventConfiguration?.deliveryGuarantees).toBeUndefined();
  });
});
