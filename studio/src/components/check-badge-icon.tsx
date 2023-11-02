import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { Badge } from "./ui/badge";

const isCheckSuccessful = (
  isComposable: boolean,
  isBreaking: boolean,
  hasClientTraffic: boolean,
) => {
  return isComposable && (!isBreaking || (isBreaking && !hasClientTraffic));
};

const getCheckBadge = (successful: boolean, isForced: boolean) => {
  if (isForced) {
    return <Badge variant="outline">FORCED</Badge>;
  }

  return successful ? (
    <Badge variant="success">PASSED</Badge>
  ) : (
    <Badge variant="destructive">FAILED</Badge>
  );
};

const getCheckIcon = (check: boolean) => {
  if (check) {
    return (
      <div className="flex justify-center">
        <CheckCircledIcon className="h-5 w-5 text-success" />
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <CrossCircledIcon className="h-5 w-5 text-destructive" />
    </div>
  );
};

export { getCheckBadge, getCheckIcon, isCheckSuccessful };
