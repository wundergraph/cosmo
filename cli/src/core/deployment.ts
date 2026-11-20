interface DeploymentHosts {
  cosmoApiUrl: string;
  cosmoWebUrl: string;
  hubUrl: string;
  cdnUrl: string;
  /** The Keycloak base that `/realms/<realm>` is appended to. */
  keycloakUrl: string;
}

/**
 * Where this wgc build sends its requests. The published wgc talks to Cosmo Cloud. For a Hub
 * deployment, cli-plugins/scripts/pack-for-hub.sh replaces this module's compiled output with that
 * deployment's hosts, so the packed wgc holds no Cosmo Cloud host at all.
 */
export type Deployment =
  | (DeploymentHosts & { kind: 'cosmo-cloud'; pluginRegistryHost: string })
  | (DeploymentHosts & {
      kind: 'hub';
      /** Serves `wgc.tgz` and `wgc-plugin-<name>.tgz`. */
      cliPackagesUrl: string;
    });

export const deployment: Deployment = {
  kind: 'cosmo-cloud',
  cosmoApiUrl: 'https://cosmo-cp.wundergraph.com',
  cosmoWebUrl: 'https://cosmo.wundergraph.com',
  hubUrl: 'https://hub.wundergraph.com',
  cdnUrl: 'https://cosmo-cdn.wundergraph.com',
  keycloakUrl: 'https://accounts.wundergraph.com/auth',
  pluginRegistryHost: 'cosmo-registry.wundergraph.com',
};
