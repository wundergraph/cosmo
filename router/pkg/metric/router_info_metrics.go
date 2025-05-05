package metric

import (
	"context"
	"errors"
	"fmt"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.uber.org/zap"
)

const (
	cosmoRouterInfoMeterName = "cosmo.router.info"
	operationRouterInfo      = "router.info"
)

type routerInfoStore struct {
	routerInfo map[string]routerConfigInfo
}

type routerConfigInfo struct {
	isFeatureFlag bool
	gauge         otelmetric.Int64ObservableGauge
	configValue   string
}

type RouterInfoMetrics struct {
	meterConfigs            *routerInfoStore
	meter                   otelmetric.Meter
	baseAttributes          []attribute.KeyValue
	instrumentRegistrations []otelmetric.Registration
	logger                  *zap.Logger
}

func InitPromAndOltpMetricRouterInfoStores(
	logger *zap.Logger,
	promProvider *metric.MeterProvider,
	oltpProvider *metric.MeterProvider,
	baseAttributes []attribute.KeyValue,
	routerConfigVersion string,
	ffConfigs *nodev1.FeatureFlagRouterExecutionConfigs,
	metricsConfig *Config,
) (promStore *RouterInfoMetrics, oltpStore *RouterInfoMetrics, err error) {
	if metricsConfig.Prometheus.Enabled {
		promStore, err = NewRouterInfoStore(
			logger,
			promProvider,
			baseAttributes,
			routerConfigVersion,
			ffConfigs,
		)
		if err != nil {
			return nil, nil, err
		}
	}

	if metricsConfig.OpenTelemetry.Enabled {
		oltpStore, err = NewRouterInfoStore(
			logger,
			oltpProvider,
			baseAttributes,
			routerConfigVersion,
			ffConfigs,
		)
		if err != nil {
			return nil, nil, err
		}
	}

	return promStore, oltpStore, nil
}

func NewRouterInfoStore(
	logger *zap.Logger,
	provider *metric.MeterProvider,
	baseAttributes []attribute.KeyValue,
	routerConfigVersion string,
	ffConfigs *nodev1.FeatureFlagRouterExecutionConfigs,
) (*RouterInfoMetrics, error) {
	meter := provider.Meter(cosmoRouterInfoMeterName)

	pm, err := configureRouterInfoMeter(meter, routerConfigVersion, ffConfigs)
	if err != nil {
		return nil, err
	}

	routerInfoMetrics := &RouterInfoMetrics{
		meterConfigs:   pm,
		baseAttributes: baseAttributes,
		meter:          meter,
		logger:         logger,
	}

	err = routerInfoMetrics.registerObservers()
	if err != nil {
		return nil, err
	}

	return routerInfoMetrics, nil
}

func configureRouterInfoMeter(
	meter otelmetric.Meter,
	routerConfigVersion string,
	ffConfigs *nodev1.FeatureFlagRouterExecutionConfigs,
) (*routerInfoStore, error) {
	routerConfigMap := make(map[string]routerConfigInfo)
	gauge, err := meter.Int64ObservableGauge(
		operationRouterInfo,
		otelmetric.WithDescription("Router Info stats for base"),
	)
	if err != nil {
		return nil, err
	}
	routerConfigMap["base"] = routerConfigInfo{
		gauge:       gauge,
		configValue: routerConfigVersion,
	}

	for featureFlagName, executionConfig := range ffConfigs.GetConfigByFeatureFlagName() {
		ffGauge, err := meter.Int64ObservableGauge(
			operationRouterInfo,
			otelmetric.WithDescription(fmt.Sprintf("Router Info stats for %s", featureFlagName)),
		)
		if err != nil {
			return nil, err
		}
		routerConfigMap[featureFlagName] = routerConfigInfo{
			gauge:         ffGauge,
			isFeatureFlag: true,
			configValue:   executionConfig.GetVersion(),
		}
	}

	return &routerInfoStore{
		routerInfo: routerConfigMap,
	}, nil
}

func (c *RouterInfoMetrics) registerObservers() error {
	observables := c.getObservables()

	rc, err := c.meter.RegisterCallback(func(_ context.Context, o otelmetric.Observer) error {
		for key, routerInfoMetric := range c.meterConfigs.routerInfo {
			attrKeyValues := make([]attribute.KeyValue, 0, 2)
			attrKeyValues = append(attrKeyValues, otel.WgRouterConfigVersion.String(routerInfoMetric.configValue))
			attrKeyValues = append(attrKeyValues, c.baseAttributes...)

			if routerInfoMetric.isFeatureFlag {
				attrKeyValues = append(attrKeyValues, otel.WgFeatureFlag.String(key))
			}

			o.ObserveInt64(
				routerInfoMetric.gauge,
				1,
				otelmetric.WithAttributes(attrKeyValues...),
			)
		}
		return nil
	}, observables...)

	if err != nil {
		return err
	}

	c.instrumentRegistrations = append(c.instrumentRegistrations, rc)
	return nil
}

func (c *RouterInfoMetrics) getObservables() []otelmetric.Observable {
	observables := make([]otelmetric.Observable, 0, len(c.meterConfigs.routerInfo))
	for _, val := range c.meterConfigs.routerInfo {
		observables = append(observables, val.gauge)
	}
	return observables
}

func (c *RouterInfoMetrics) Shutdown() error {
	var err error

	for _, reg := range c.instrumentRegistrations {
		if regErr := reg.Unregister(); regErr != nil {
			err = errors.Join(regErr)
		}
	}

	return err
}
