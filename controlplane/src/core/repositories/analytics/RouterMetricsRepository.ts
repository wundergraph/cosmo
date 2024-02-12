import { ClickHouseClient } from '../../clickhouse/index.js';

export interface RouterDTO {
  hostname: string;
  processId: string;
  clusterName: string;
  configVersionId: string;
  uptimeSeconds: string;
  serviceName: string;
  serviceVersion: string;
  serviceInstanceId: string;
}

export interface RouterRuntimeDTO {
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
                 FederatedGraphID = '${input.federatedGraphId}' AND
                 OrganizationID = '${input.organizationId}' AND
                 ServiceInstanceID = '${input.serviceInstanceId}'
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

    if (Array.isArray(res)) {
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
           toString(argMax(UptimeSeconds, Timestamp)) as uptimeSeconds,
           Hostname as hostname,
           ProcessID as processId,
           ClusterName as clusterName,
           ConfigVersionID as configVersionId,
           ServiceName as serviceName,
           ServiceVersion as serviceVersion,
           ServiceInstanceID as serviceInstanceId,
           ClusterName as clusterName
           from ${this.client.database}.router_uptime_1_30_mv
        where Timestamp >= now() - interval 60 second AND
            FederatedGraphID = '${input.federatedGraphId}' AND
            OrganizationID = '${input.organizationId}'
        group by Hostname, ProcessID, ClusterName, ConfigVersionID, ServiceName, ServiceVersion, ServiceInstanceID
        order by uptimeSeconds desc
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
        uptimeSeconds: p.uptimeSeconds,
      }));
    }

    return [];
  }
}
