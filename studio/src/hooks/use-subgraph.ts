import {
  SubgraphContext,
  SubgraphContextProps,
} from "@/components/layout/subgraph-layout";
import { useContext } from "react";

export const useSubgraph = (): SubgraphContextProps | undefined => {
  return useContext(SubgraphContext);
};
