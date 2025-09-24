import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { useLocalStorage } from "./use-local-storage";

export function useNewFeaturesPopupDisabled(): [boolean, Dispatch<SetStateAction<string>>] {
  const [isPopupDisabled, setIsPopupDisabled] = useState(true);
  const [isPopupDisabledOnClient, setDisablePopup] = useLocalStorage(
    "dismissNewFeaturesPopup",
    "false",
  );

  useEffect(() => {
    setIsPopupDisabled(isPopupDisabledOnClient === "true");
  }, [isPopupDisabledOnClient]);

  return [isPopupDisabled, setDisablePopup];
}
