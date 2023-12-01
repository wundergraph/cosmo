import { FiCheck, FiCopy } from "react-icons/fi";
import { Button, ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { MouseEventHandler, useEffect, useState } from "react";

export interface CopyButtonProps extends ButtonProps {
  tooltip: string;
  value: string;
}

const copyToClipboard = (value: string) => {
  if (!navigator.clipboard) {
    const el = document.createElement("textarea");
    el.value = value;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  } else {
    navigator.clipboard.writeText(value);
  }
};

export const CopyButton: React.FC<CopyButtonProps> = (props) => {
  const [copy, setCopy] = useState(false);

  useEffect(() => {
    if (copy) {
      setTimeout(() => setCopy(false), 1000);
    }
  });

  const handleClick: MouseEventHandler<HTMLButtonElement> = (e) => {
    copyToClipboard(props.value);
    setCopy(true);
    props.onClick?.(e);
  };

  return (
    <Tooltip delayDuration={100}>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" {...props} onClick={handleClick}>
          {copy ? <FiCheck /> : <FiCopy className="h-3 w-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{props.tooltip}</TooltipContent>
    </Tooltip>
  );
};
