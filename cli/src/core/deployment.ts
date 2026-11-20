interface DeploymentHosts {
  cosmoApiUrl: string;
  cosmoWebUrl: string;
  /** Hub's API: `/mcp`, `/rpc`, `/cli`, `/.well-known/hub.json` and the portal tunnels. */
  hubUrl: string;
  /** Hub's web app, for links a person opens in a browser. */
  hubAppUrl: string;
  cdnUrl: string;
  /** The Keycloak base that `/realms/<realm>` is appended to. */
  keycloakUrl: string;
}

export type HubDeployment = DeploymentHosts & {
  kind: 'hub';
  /** Serves `wgc.tgz` and `wgc-plugin-<name>.tgz`. */
  cliPackagesUrl: string;
};

/**
 * Where this wgc build sends its requests. The published wgc talks to Cosmo Cloud. For a Hub
 * deployment, cli-plugins/scripts/pack-for-hub.sh replaces this module's compiled output with that
 * deployment's hosts, so the packed wgc holds no Cosmo Cloud host at all.
 */
export type Deployment = (DeploymentHosts & { kind: 'cosmo-cloud'; pluginRegistryHost: string }) | HubDeployment;

export const deployment: Deployment = {
  kind: 'cosmo-cloud',
  cosmoApiUrl: 'https://cosmo-cp.wundergraph.com',
  cosmoWebUrl: 'https://cosmo.wundergraph.com',
  hubUrl: 'https://hub.wundergraph.com',
  hubAppUrl: 'https://hub.wundergraph.com',
  cdnUrl: 'https://cosmo-cdn.wundergraph.com',
  keycloakUrl: 'https://accounts.wundergraph.com/auth',
  pluginRegistryHost: 'cosmo-registry.wundergraph.com',
};

/**
 * The hosts pack-for-hub.sh bakes in for the Hub deployment at `baseDomain`. `localhost` is the
 * local install on its fixed ports, where Hub's API and web app listen on different ports.
 */
export const hubDeployment = (baseDomain: string): HubDeployment => {
  if (baseDomain === 'localhost') {
    return {
      kind: 'hub',
      cosmoApiUrl: 'http://localhost:4431',
      cosmoWebUrl: 'http://localhost:4430',
      hubUrl: 'http://localhost:4405',
      hubAppUrl: 'http://localhost:4400',
      cdnUrl: 'http://localhost:4487',
      keycloakUrl: 'http://localhost:4480',
      cliPackagesUrl: 'http://localhost:4405/cli',
    };
  }

  const hubUrl = `https://hub.${baseDomain}`;

  return {
    kind: 'hub',
    cosmoApiUrl: `https://cosmo.${baseDomain}`,
    cosmoWebUrl: `https://studio.${baseDomain}`,
    hubUrl,
    hubAppUrl: hubUrl,
    cdnUrl: `https://cdn.${baseDomain}`,
    keycloakUrl: hubUrl,
    cliPackagesUrl: `${hubUrl}/cli`,
  };
};
