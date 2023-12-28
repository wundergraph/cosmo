import { useUser } from "./use-user";

export const useCurrentOrganization = () => {
  const user = useUser();
  return user?.currentOrganization;
};
