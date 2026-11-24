import { fetchSession, UnauthorizedError } from '@/components/app-provider';
import { EmptyState } from '@/components/empty-state';
import { Loader } from '@/components/ui/loader';
import { embedLoginUrl, embedSessionTarget } from '@/lib/embed';
import { NextPageWithLayout } from '@/lib/page';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { useQueryState } from 'nuqs';
import { useEffect, useState } from 'react';

/**
 * Hub sends the browser here, top level, when its frame of a Studio page has no session. A signed-in user goes
 * straight back to Hub; anyone else signs in first and then goes back.
 */
const EmbedSessionPage: NextPageWithLayout = () => {
  const [returnUrl] = useQueryState('return');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchSession()
      .then((session) => {
        if (!session) {
          setFailed(true);
          return;
        }

        window.location.replace(embedSessionTarget({ returnUrl, hubUrl: process.env.NEXT_PUBLIC_HUB_URL }));
      })
      .catch((error) => {
        if (!(error instanceof UnauthorizedError)) {
          setFailed(true);
          return;
        }

        window.location.replace(
          embedLoginUrl({
            controlplaneUrl: process.env.NEXT_PUBLIC_COSMO_CP_URL,
            studioUrl: process.env.NEXT_PUBLIC_COSMO_STUDIO_URL,
            returnUrl,
          }),
        );
      });
  }, [returnUrl]);

  if (failed) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon />}
        title="Could not reach Cosmo"
        description="Reload the page to try again."
      />
    );
  }

  return <Loader fullscreen />;
};

EmbedSessionPage.ownsSession = true;
EmbedSessionPage.getLayout = (page) => <div className="flex min-h-screen bg-background">{page}</div>;

export default EmbedSessionPage;
