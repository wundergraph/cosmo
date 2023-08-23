import { useForm, UseFormProps, FieldValues } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

export type { SubmitHandler } from "react-hook-form";

export interface UseZodForm<TFieldValues extends FieldValues = FieldValues>
  extends UseFormProps<TFieldValues> {
  schema: z.ZodSchema<any>;
}

export const useZodForm = <TFieldValues extends FieldValues = FieldValues>(
  props: UseZodForm<TFieldValues>
) => {
  const { schema, ...formProps } = props;
  return useForm<TFieldValues>({
    resolver: zodResolver(schema),
    reValidateMode: "onChange",
    ...formProps,
  });
};
