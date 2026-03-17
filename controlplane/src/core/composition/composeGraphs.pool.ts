/**
 * Main-thread bridge for composition worker execution.
 *
 * The worker only exchanges plain `Serialized*` payloads so we do not rely on
 * structured cloning of rich runtime objects across the Tinypool boundary.
 * Node 22 loads the source `.ts` worker natively in development, and the built
 * `.js` worker in production.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { Warning } from '@wundergraph/composition';
import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import WorkerPool from 'tinypool';
import { FederatedGraphDTO } from '../../types/index.js';
import { validateRouterCompatibilityVersion } from './composition.js';
import { ComposedFederatedGraph, CompositionSubgraphRecord } from './composer.js';
import {
  ComposeGraphsTaskInput,
  ComposeGraphsTaskResult,
  SerializedComposedGraphArtifact,
} from './composeGraphs.types.js';

let composeGraphsPool: WorkerPool | undefined;
const composeGraphsPoolConfig = {
  maxThreads: 0,
};

export interface ConfigureComposeGraphsPoolOptions {
  maxThreads: number;
}

function getWorkerFilename() {
  const sourceWorker = new URL('composeGraphs.worker.ts', import.meta.url);
  if (existsSync(fileURLToPath(sourceWorker))) {
    return {
      filename: sourceWorker.href,
    };
  }

  return {
    filename: new URL('composeGraphs.worker.js', import.meta.url).href,
  };
}

function getMaxThreads() {
  if (composeGraphsPoolConfig.maxThreads > 0) {
    return composeGraphsPoolConfig.maxThreads;
  }

  return Math.max(1, availableParallelism());
}

function getComposeGraphsPool() {
  if (composeGraphsPool) {
    return composeGraphsPool;
  }

  const { filename } = getWorkerFilename();

  composeGraphsPool = new WorkerPool({
    filename,
    minThreads: 1,
    maxThreads: getMaxThreads(),
    runtime: 'child_process',
    concurrentTasksPerWorker: 2,
    serialization: 'advanced',
  });

  return composeGraphsPool;
}

function deserializeWarning(message: string, subgraphName?: string) {
  return new Warning({
    message,
    subgraph: {
      name: subgraphName || '',
    },
  });
}

export type DeserializedComposedGraph = Omit<ComposedFederatedGraph, 'subgraphs'> & {
  subgraphs: CompositionSubgraphRecord[];
};

export function deserializeComposedGraphArtifact(
  federatedGraph: Pick<FederatedGraphDTO, 'id' | 'targetId' | 'name' | 'namespace' | 'namespaceId'>,
  artifact: SerializedComposedGraphArtifact,
): DeserializedComposedGraph {
  return {
    id: federatedGraph.id,
    targetID: federatedGraph.targetId,
    name: federatedGraph.name,
    namespace: federatedGraph.namespace,
    namespaceId: federatedGraph.namespaceId,
    composedSchema: artifact.composedSchema,
    federatedClientSchema: artifact.federatedClientSchema,
    shouldIncludeClientSchema: artifact.shouldIncludeClientSchema,
    errors: artifact.errors.map((message) => new Error(message)),
    fieldConfigurations: artifact.fieldConfigurations,
    subgraphs: artifact.subgraphs,
    warnings: artifact.warnings.map((warning) => deserializeWarning(warning.message, warning.subgraphName)),
  };
}

export function deserializeRouterExecutionConfig(routerExecutionConfigJson?: ReturnType<RouterConfig['toJson']>) {
  if (!routerExecutionConfigJson) {
    return;
  }

  return RouterConfig.fromJson(routerExecutionConfigJson);
}

export function composeGraphsInWorker(task: Omit<ComposeGraphsTaskInput, 'routerCompatibilityVersion'>) {
  const fullTask: ComposeGraphsTaskInput = {
    ...task,
    routerCompatibilityVersion: validateRouterCompatibilityVersion(task.federatedGraph.routerCompatibilityVersion),
  };
  return getComposeGraphsPool().run(fullTask) as Promise<ComposeGraphsTaskResult>;
}

export function configureComposeGraphsPool(options: ConfigureComposeGraphsPoolOptions) {
  composeGraphsPoolConfig.maxThreads = options.maxThreads;
}

export async function destroyComposeGraphsPool() {
  if (!composeGraphsPool) {
    return;
  }

  const pool = composeGraphsPool;
  composeGraphsPool = undefined;
  await pool.destroy();
}
