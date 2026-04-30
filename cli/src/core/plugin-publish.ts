import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { arch, platform } from 'node:os';
import path from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { splitLabel } from '@wundergraph/cosmo-shared';
import { execa, type ResultPromise } from 'execa';
import { config, getBaseHeaders } from './config.js';
import type { BaseCommandOptions } from './types/types.js';

export interface PluginFiles {
  schema: string;
  dockerFile: string;
  protoSchema: string;
  protoMapping: string;
  protoLock: string;
}

export interface PluginPublishParams {
  client: BaseCommandOptions['client'];
  pluginName: string;
  pluginDir: string;
  namespace: string;
  labels: string[];
  platforms: string[];
  files: PluginFiles;
  cancelSignal?: AbortSignal;
  /** Called with each spawned execa process so the caller can pipe/inherit output. */
  onProcess?: (proc: ResultPromise) => void;
}

export interface PluginPublishResult {
  error: Error | null;
  /** Raw response from publishFederatedSubgraph, available when the RPC call was reached. */
  response?: {
    code?: number;
    details?: string;
    hasChanged?: boolean;
    compositionErrors: Array<{ federatedGraphName: string; namespace: string; featureFlag: string; message: string }>;
    deploymentErrors: Array<{ federatedGraphName: string; namespace: string; message: string }>;
    compositionWarnings: Array<{
      federatedGraphName: string;
      namespace: string;
      featureFlag: string;
      message: string;
    }>;
    proposalMatchMessage?: string;
  };
}

export function getDefaultPlatforms(): string[] {
  const supportedPlatforms = ['linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64', 'windows/amd64'];
  const defaultPlatforms = ['linux/amd64', 'linux/arm64'];

  const currentPlatform = platform();
  const currentArch = arch();

  let dockerPlatform: string | null = null;

  switch (currentPlatform) {
    case 'linux': {
      if (currentArch === 'x64') {
        dockerPlatform = 'linux/amd64';
      } else if (currentArch === 'arm64') {
        dockerPlatform = 'linux/arm64';
      }
      break;
    }
    case 'darwin': {
      if (currentArch === 'x64') {
        dockerPlatform = 'darwin/amd64';
      } else if (currentArch === 'arm64') {
        dockerPlatform = 'darwin/arm64';
      }
      break;
    }
    case 'win32': {
      if (currentArch === 'x64') {
        dockerPlatform = 'windows/amd64';
      }
      break;
    }
  }

  if (dockerPlatform && supportedPlatforms.includes(dockerPlatform) && !defaultPlatforms.includes(dockerPlatform)) {
    defaultPlatforms.push(dockerPlatform);
  }

  return defaultPlatforms;
}

export const SUPPORTED_PLATFORMS = ['linux/amd64', 'linux/arm64', 'darwin/amd64', 'darwin/arm64', 'windows/amd64'];

/**
 * Reads and validates the 5 required plugin files from a plugin directory.
 * Throws on missing/empty files.
 */
export async function readPluginFiles(pluginDir: string): Promise<PluginFiles> {
  const schemaFile = path.join(pluginDir, 'src', 'schema.graphql');
  const dockerFile = path.join(pluginDir, 'Dockerfile');
  const protoSchemaFile = path.join(pluginDir, 'generated', 'service.proto');
  const protoMappingFile = path.join(pluginDir, 'generated', 'mapping.json');
  const protoLockFile = path.join(pluginDir, 'generated', 'service.proto.lock.json');

  const requiredFiles = [schemaFile, dockerFile, protoSchemaFile, protoMappingFile, protoLockFile];
  for (const f of requiredFiles) {
    if (!existsSync(f)) {
      throw new Error(`Required file does not exist: ${f}`);
    }
  }

  async function readNonEmpty(filePath: string): Promise<string> {
    const buffer = await readFile(filePath);
    const content = new TextDecoder().decode(buffer);
    if (content.trim().length === 0) {
      throw new Error(`File is empty: ${filePath}`);
    }
    return content;
  }

  const [schema, protoSchema, protoMapping, protoLock] = await Promise.all([
    readNonEmpty(schemaFile),
    readNonEmpty(protoSchemaFile),
    readNonEmpty(protoMappingFile),
    readNonEmpty(protoLockFile),
  ]);

  return { schema, dockerFile, protoSchema, protoMapping, protoLock };
}

/**
 * Core plugin publish pipeline:
 * 1. validateAndFetchPluginData (RPC)
 * 2. Docker login → buildx build+push → logout
 * 3. publishFederatedSubgraph (RPC)
 *
 * Returns a result object; never calls program.error() — the caller decides
 * how to handle errors.
 */
export async function publishPluginPipeline(params: PluginPublishParams): Promise<PluginPublishResult> {
  const { client, pluginName, pluginDir, namespace, labels, platforms, files, cancelSignal, onProcess } = params;

  // Step 1: Validate and fetch plugin data
  const pluginDataResponse = await client.platform.validateAndFetchPluginData(
    {
      name: pluginName,
      namespace,
      labels: labels.map((label) => splitLabel(label)),
    },
    {
      headers: getBaseHeaders(),
    },
  );

  if (pluginDataResponse.response?.code !== EnumStatusCode.OK) {
    return { error: new Error(pluginDataResponse.response?.details ?? 'Failed to validate plugin data') };
  }

  const { reference, newVersion, pushToken } = pluginDataResponse;
  const imageTag = `${config.pluginRegistryURL}/${reference}:${newVersion}`;
  const platformStr = platforms.join(',');

  // Step 2: Docker operations
  try {
    const loginProc = execa('docker', ['login', config.pluginRegistryURL, '-u', 'x', '--password-stdin'], {
      stdio: 'pipe',
      input: pushToken,
      ...(cancelSignal ? { cancelSignal } : {}),
    });
    onProcess?.(loginProc);
    await loginProc;

    const buildProc = execa(
      'docker',
      [
        'buildx',
        'build',
        '--sbom=false',
        '--provenance=false',
        '--push',
        '--platform',
        platformStr,
        '-f',
        files.dockerFile,
        '-t',
        imageTag,
        pluginDir,
      ],
      {
        stdio: 'pipe',
        ...(cancelSignal ? { cancelSignal } : {}),
      },
    );
    onProcess?.(buildProc);
    await buildProc;
  } catch (error) {
    return { error: new Error(`Docker operation failed: ${error instanceof Error ? error.message : String(error)}`) };
  } finally {
    try {
      const logoutProc = execa('docker', ['logout', config.pluginRegistryURL], { stdio: 'pipe' });
      onProcess?.(logoutProc);
      await logoutProc;
    } catch {
      // best-effort logout
    }
  }

  // Step 3: Publish schema
  const resp = await client.platform.publishFederatedSubgraph(
    {
      name: pluginName,
      namespace,
      schema: files.schema,
      labels: labels.map((label) => splitLabel(label)),
      type: SubgraphType.GRPC_PLUGIN,
      proto: {
        schema: files.protoSchema,
        mappings: files.protoMapping,
        lock: files.protoLock,
        platforms,
        version: newVersion,
      },
    },
    {
      headers: getBaseHeaders(),
    },
  );

  const result: PluginPublishResult = {
    error: null,
    response: {
      code: resp.response?.code,
      details: resp.response?.details,
      hasChanged: resp.hasChanged,
      compositionErrors: resp.compositionErrors,
      deploymentErrors: resp.deploymentErrors,
      compositionWarnings: resp.compositionWarnings,
      proposalMatchMessage: resp.proposalMatchMessage,
    },
  };

  switch (resp.response?.code) {
    case EnumStatusCode.OK:
    case EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED:
    case EnumStatusCode.ERR_DEPLOYMENT_FAILED:
    case EnumStatusCode.ERR_SCHEMA_MISMATCH_WITH_APPROVED_PROPOSAL: {
      return result;
    }
    default: {
      return {
        ...result,
        error: new Error(resp.response?.details ?? 'Failed to publish plugin subgraph'),
      };
    }
  }
}
