import { EmptyState } from "@/components/empty-state";
import { CheckCircleIcon, NoSymbolIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/router";
import { useUser } from "@/hooks/use-user";
import React, { useContext, useState } from "react";
import { GraphContext } from "@/components/layout/graph-layout";
import { WebhookDeliveryDetails } from "@/components/webhook-delivery-details";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CrossCircledIcon } from "@radix-ui/react-icons";

export interface SubgraphCheckExtensionProps {
  enabled: boolean;
  deliveryId: string | undefined;
  errorMessage: string | undefined;
}

export function SubgraphCheckExtension({ enabled, deliveryId, errorMessage }: SubgraphCheckExtensionProps) {
  const router = useRouter();
  const user = useUser();
  const graphContext = useContext(GraphContext);
  const [d, setD] = useState<string | undefined>(undefined);

  if (!deliveryId) {
    return (
      <EmptyState
        icon={<NoSymbolIcon className="text-gray-400"/>}
        title="Subgraph Check Extension Skipped"
        description={
          !enabled
            ? "Subgraph check extension was skipped for this run."
            : "Subgraph check extension is not configured for this namespace. Enable it to execute subgraph check extensions in your schema."
        }
        actions={
          <Button
            onClick={() => {
              router.push(
                `/${user!.currentOrganization.slug}/check-extensions?namespace=${graphContext?.graph?.namespace ?? "default"}`,
              );
            }}
          >
            Configure Subgraph Check Extensions
          </Button>
        }
      />
    );
  }

  return (
    <>
      {errorMessage ? (
        <Alert variant="destructive">
          <CrossCircledIcon className="h-4 w-4" />
          <AlertTitle>Subgraph Check Extension failed</AlertTitle>
          <AlertDescription>
            {errorMessage}
            {deliveryId && (
              <p className="mt-4">
                <Button
                  variant="link"
                  className="p-0 h-auto"
                  onClick={() => setD(deliveryId)}
                >
                  View delivery details
                </Button>
              </p>
            )}
          </AlertDescription>
        </Alert>
        ) : (
        <EmptyState
          icon={<CheckCircleIcon className="text-success" />}
          title="Composition Check Successful"
          description="There are no composition errors or warnings."
          actions={deliveryId && (<Button onClick={() => setD(deliveryId)}>View delivery details</Button>)}
        />
      )}

      <WebhookDeliveryDetails
        deliveryId={d}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setD(undefined);
          }
        }}
        refreshDeliveries={() => {}}
      />
    </>
  );
}