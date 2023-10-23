import { BoltSlashIcon } from "@heroicons/react/24/outline";
import { CompositionErrorsDialog } from "@/components/composition-errors-dialog";
import React from "react";

export const CompositionErrorsBanner = ({ errors }: { errors?: string }) => {
  return (
    <div className="mb-3 flex items-center justify-between space-x-2.5 rounded-lg border border-red-600 p-2 px-4 text-red-600 dark:border-red-900">
      <div className="flex items-center justify-between space-x-2.5">
        <div>
          <BoltSlashIcon className="h-5 w-5 text-red-500" />
        </div>
        <div className="text-xs">
          This version of the API schema does not include the latest from some
          of your subgraphs because the composition failed.
        </div>
      </div>
      {errors && <CompositionErrorsDialog errors={errors} />}
    </div>
  );
};
