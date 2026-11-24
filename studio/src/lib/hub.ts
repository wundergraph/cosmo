import { buildUrl } from '@/lib/build-url';

/**
 * Undefined when Studio has no Hub URL, including the unreplaced placeholder a Docker image keeps when the
 * variable is not set.
 */
const parseHubUrl = (hubUrl: string | undefined): URL | undefined => {
  if (!hubUrl || !/^https?:\/\//.test(hubUrl) || !URL.canParse(hubUrl)) {
    return undefined;
  }

  return new URL(hubUrl.endsWith('/') ? hubUrl : `${hubUrl}/`);
};

/** The origin Hub frames Studio from, the only one Studio posts messages to. */
export const hubOrigin = (hubUrl: string | undefined): string | undefined => parseHubUrl(hubUrl)?.origin;

/** Hub's page that launches a sandbox from a Cosmo federated graph. */
export const hubLaunchUrl = ({
  hubUrl,
  graph,
  namespace,
  organization,
}: {
  hubUrl: string | undefined;
  graph: string;
  namespace: string;
  /** The Cosmo organization's slug, so Hub knows which organization to set up. */
  organization?: string;
}): string | undefined => {
  const hub = parseHubUrl(hubUrl);
  if (!hub) {
    return undefined;
  }

  return buildUrl(new URL('launch', hub).toString(), { graph, namespace, organization });
};
