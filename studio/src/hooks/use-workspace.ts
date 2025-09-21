import { useContext } from "react";
import { WorkspaceContext, WorkspaceContextType } from "@/components/dashboard/workspace-provider";

export function useWorkspace(): WorkspaceContextType {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error(`useWorkspace must be used within <WorkspaceProvider>`);
  }

  return context;
}