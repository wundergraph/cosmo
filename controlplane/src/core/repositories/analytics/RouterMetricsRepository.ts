import { ClickHouseClient } from '../../clickhouse/index.js';

export interface RouterDTO {
  hostname: string;
  processId: string;
  clusterName: string;
  configVersionId: string;
  processUptimeSeconds: string;
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
}

export interface RouterRuntimeDTO {
  serverUptimeSeconds: string;
  cpuUsage: {
    currentPercent: number;
    changePercent: number;
  };
  memoryUsage: {
    currentMb: number;
    changePercent: number;
  };
}

export class RouterMetricsRepository {
  constructor(private client: ClickHouseClient) {}

  public async getRouterRuntime(input: {
    federatedGraphId: string;
    organizationId: string;
    serviceInstanceId: string;
  }): Promise<RouterRuntimeDTO> {
    const query = `
        select
          groupArray(2)(MetricValue) as metricValue,
          MetricName as metricName
        from (
               select
                 MetricValue,
                 MetricName
               from cosmo.router_metrics_30
               where
                 Timestamp >= now() - interval 45 second AND
                 FederatedGraphID = '${input.federatedGraphId}' AND
                 OrganizationID = '${input.organizationId}' AND
                 ServiceInstanceID = '${input.serviceInstanceId}' AND
                 MetricName in ('server.uptime', 'process.runtime.go.mem.heap_alloc', 'process.cpu.usage')
               order by Timestamp desc
               )
        group by MetricName
    `;

    const res = await this.client.queryPromise<{
      metricValue: number[];
      metricName: string;
    }>(query);

    let memoryUsageMb = 0;
    let memoryChangePercent = 0;
    let cpuUsagePercent = 0;
    let cpuChangePercent = 0;
    let serverUptimeSeconds = '';

    if (Array.isArray(res)) {
      /**
       * Server uptime.
       */
      const serverUptimeMetric = res.find((p) => p.metricName === 'server.uptime');
      if (serverUptimeMetric && serverUptimeMetric.metricValue.length > 0) {
        serverUptimeSeconds = serverUptimeMetric.metricValue[0].toString();
      }

      /**
       * Memory usage from heap_alloc metric. Converting bytes to megabytes.
       */

      const processMemoryUsagePercent = res.find((p) => p.metricName === 'process.runtime.go.mem.heap_alloc');
      if (processMemoryUsagePercent && processMemoryUsagePercent.metricValue.length > 0) {
        memoryUsageMb = processMemoryUsagePercent.metricValue[0] / 1024 / 1024;
        if (
          processMemoryUsagePercent.metricValue.length === 2 &&
          processMemoryUsagePercent.metricValue[0] > 0 &&
          processMemoryUsagePercent.metricValue[1] > 0
        ) {
          const currentMB = processMemoryUsagePercent.metricValue[0] / 1024 / 1024;
          const prevMB = processMemoryUsagePercent.metricValue[1] / 1024 / 1024;
          memoryChangePercent = ((currentMB - prevMB) / prevMB) * 100;
        }
      }

      /**
       * CPU usage. Underlying library of the router calculates the average percentage of CPU usage between two samples.
       */

      const cpuUsagePercentUsage = res.find((p) => p.metricName === 'process.cpu.usage');

      if (cpuUsagePercentUsage && cpuUsagePercentUsage.metricValue.length > 0) {
        cpuUsagePercent = cpuUsagePercentUsage.metricValue[0];
        if (
          cpuUsagePercentUsage.metricValue.length === 2 &&
          cpuUsagePercentUsage.metricValue[0] > 0 &&
          cpuUsagePercentUsage.metricValue[1] > 0
        ) {
          cpuChangePercent =
            ((cpuUsagePercentUsage.metricValue[0] - cpuUsagePercentUsage.metricValue[1]) /
              cpuUsagePercentUsage.metricValue[1]) *
            100;
        }
      }

      return {
        serverUptimeSeconds,
        cpuUsage: {
          currentPercent: cpuUsagePercent,
          changePercent: cpuChangePercent,
        },
        memoryUsage: {
          currentMb: memoryUsageMb,
          changePercent: memoryChangePercent,
        },
      };
    }

    return {
      serverUptimeSeconds: '',
      cpuUsage: {
        currentPercent: 0,
        changePercent: 0,
      },
      memoryUsage: {
        currentMb: 0,
        changePercent: 0,
      },
    };
  }

  public async getActiveRouters(input: { federatedGraphId: string; organizationId: string }): Promise<RouterDTO[]> {
    const query = `
      select
        first_value(Timestamp) as timestamp,
        toString(first_value(ProcessUptimeSeconds)) as processUptimeSeconds,
        first_value(Hostname) as hostname,
        first_value(ClusterName) as clusterName,
        first_value(ConfigVersionID) as configVersionId,
        first_value(ServiceName) as serviceName,
        first_value(ServiceVersion) as serviceVersion,
        ServiceInstanceID as serviceInstanceId,
        first_value(ProcessID) as processId
      from (
         select Timestamp,
                ProcessUptimeSeconds,
                Hostname,
                ConfigVersionID,
                ServiceName,
                ServiceVersion,
                ServiceInstanceID,
                ClusterName,
                ProcessID
         from cosmo.router_uptime_30
         where Timestamp >= now() - interval 45 second AND
           FederatedGraphID = '${input.federatedGraphId}' AND
           OrganizationID = '${input.organizationId}'
         order by Timestamp desc
      )
      group by ServiceInstanceID
    `;

    const res = await this.client.queryPromise(query);

    if (Array.isArray(res)) {
      return res.map((p) => ({
        hostname: p.hostname,
        serviceName: p.serviceName,
        serviceVersion: p.serviceVersion,
        serviceInstanceId: p.serviceInstanceId,
        processId: p.processId,
        clusterName: p.clusterName,
        configVersionId: p.configVersionId,
        processUptimeSeconds: p.processUptimeSeconds,
      }));
    }

    return [];
  }
}
