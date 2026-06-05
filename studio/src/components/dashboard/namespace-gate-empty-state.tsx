import { PiLockKey } from 'react-icons/pi';
import { LoginMethodType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { EmptyState } from '@/components/empty-state';
import { useUser } from '@/hooks/use-user';

export const NamespaceGateEmptyState = () => {
  const loginMethod = useUser()?.loginMethod;

  const loginMethodLabel =
    loginMethod?.type === LoginMethodType.SSO
      ? loginMethod.ssoProviderName || loginMethod.ssoAlias || 'your SSO provider'
      : 'password';

  return (
    <div className="px-4 py-6 lg:px-10">
      <EmptyState
        icon={<PiLockKey />}
        title="No namespaces are available"
        description={
          <>
            No namespaces are mapped to your login method ({loginMethodLabel}). Ask an admin to grant access in the
            Namespace SSO settings, or sign in with a different method.
          </>
        }
      />
    </div>
  );
};
