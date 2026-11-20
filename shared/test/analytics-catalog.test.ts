import { describe, expect, test } from 'vitest';
import { ANALYTICS_DATASETS, analyticsRetentionFamilies } from '../src/index.js';

describe('Analytics catalog', () => {
  test('gives each retention family one plan feature and one storage period', () => {
    const conflicts = analyticsRetentionFamilies().filter(({ family, retentionFeature, storageTtlDays }) =>
      ANALYTICS_DATASETS.some(
        (dataset) =>
          dataset.retentionFamily === family &&
          (dataset.retentionFeature !== retentionFeature || dataset.storageTtlDays !== storageTtlDays),
      ),
    );

    expect(conflicts).toEqual([]);
  });

  test('derives the retention families from the datasets', () => {
    expect(analyticsRetentionFamilies()).toEqual([
      { family: 'analytics', retentionFeature: 'analytics-retention', storageTtlDays: 30 },
      { family: 'request_volume', retentionFeature: 'analytics-retention', storageTtlDays: 90 },
      { family: 'tracing', retentionFeature: 'tracing-retention', storageTtlDays: 30 },
      { family: 'schema_usage', retentionFeature: 'analytics-retention', storageTtlDays: 90 },
    ]);
  });
});
