import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { formatDateTime } from "@/lib/format-date";
import { Link } from "@/components/ui/link";
import { useRouter } from "next/router";

export function OrgPendingDeletionBanner() {
  const org = useCurrentOrganization();
  const router = useRouter();
  if (!org?.deletion || router.pathname.startsWith("/account/")) {
    return null;
  }

  return (
    <div
      className="border-b bg-card text-card-foreground shadow-lg transition-all border-t-0 rounded-t-none p-6 space-y-3"
    >
      <h1 className="text-2xl font-bold">Deletion Scheduled</h1>
      <p>
        The organization <span className="font-bold">{org.name}</span> is currently scheduled for deletion on
        {' '}<span className="font-bold">{formatDateTime(new Date(org.deletion.queuedAt))}</span>.
      </p>
      {org.roles.includes('admin')
        ? (
          <p>
            If this was unintentional and you would like to cancel the deletion, head to the{' '}
            <Link href={`/${org.slug}/settings/restore`} className="text-primary">
              settings page
            </Link>.
          </p>
        )
        : (
          <p>If you believe this was unintentional, please contact the organization administrator.</p>
        )}
    </div>
  );
}