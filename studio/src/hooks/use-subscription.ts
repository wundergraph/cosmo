import { useUser } from "./use-user";

export const useSubscription = () => {
  const user = useUser();
  return user?.currentOrganization?.subscription;
};
