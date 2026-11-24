import { useForm, UseFormProps, FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import z from 'zod';

export type { SubmitHandler } from 'react-hook-form';

export interface UseZodForm<Input extends FieldValues, Output extends FieldValues = Input>
  extends Omit<UseFormProps<Input, unknown, Output>, 'resolver'> {
  schema: z.ZodType<Output, Input>;
}

export const useZodForm = <Input extends FieldValues, Output extends FieldValues = Input>(
  props: UseZodForm<Input, Output>,
) => {
  const { schema, ...formProps } = props;
  return useForm<Input, unknown, Output>({
    resolver: zodResolver(schema),
    reValidateMode: 'onChange',
    ...formProps,
  });
};
