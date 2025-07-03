import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";

export function useStarBannerDisabled(): [boolean, Dispatch<SetStateAction<string>>] {
  const [isStarBannerDisabled, setIsStarBannerDisabled] = useState(true);
  const [isStarBannerDisabledOnClient, setDisableStarBanner] = useLocalStorage(
    "disableStarBanner",
    "false",
  );

  useEffect(() => {
    setIsStarBannerDisabled(isStarBannerDisabledOnClient === "true");
  }, [isStarBannerDisabledOnClient]);

  return [isStarBannerDisabled, setDisableStarBanner];
}