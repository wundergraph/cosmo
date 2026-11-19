import { buildUrl } from '@/lib/build-url';

/**
 * Hub's page that launches a sandbox from a Cosmo federated graph. Undefined when Studio has no Hub URL,
 * including the unreplaced placeholder a Docker image keeps when the variable is not set.
 */
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
  if (!hubUrl || !/^https?:\/\//.test(hubUrl) || !URL.canParse(hubUrl)) {
    return undefined;
  }

  const launchPage = new URL('launch', hubUrl.endsWith('/') ? hubUrl : `${hubUrl}/`).toString();
  return buildUrl(launchPage, { graph, namespace, organization });
};
