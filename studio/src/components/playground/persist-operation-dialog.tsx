import { CodeViewer } from '@/components/code-viewer';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { PiDevices } from 'react-icons/pi';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input as TextInput } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { SubmitHandler, useZodForm } from '@/hooks/use-form';
import { create } from '@bufbuild/protobuf';
import { useMutation, useQuery } from '@connectrpc/connect-query';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  getClients,
  publishPersistedOperations,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform-PlatformService_connectquery';
import {
  PersistedOperationSchema,
  PublishedOperationStatus,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import crypto from 'crypto';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { z } from 'zod';

const FormSchema = z.object({
  clientId: z.string().optional(),
  clientName: z.string().trim().min(1, 'The name cannot be empty'),
});

type Input = z.infer<typeof FormSchema>;

export const PersistOperationDialog = ({
  open,
  onOpenChange,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
}) => {
  const router = useRouter();
  const slug = router.query.slug as string;
  const namespace = router.query.namespace as string;

  const [isNew, setIsNew] = useState(false);

  const { toast } = useToast();

  const { mutate, isPending } = useMutation(publishPersistedOperations, {
    onSuccess(data) {
      if (data.response?.code !== EnumStatusCode.OK) {
        toast({
          variant: 'destructive',
          title: 'Could not save operation',
          description: data.response?.details ?? 'Please try again',
        });
        return;
      }

      if (data.operations.length > 0 && data.operations[0].status === PublishedOperationStatus.CONFLICT) {
        toast({
          variant: 'destructive',
          title: 'Could not save operation',
          description: 'There were conflicts detected while saving',
        });
        return;
      }

      toast({
        title: 'Operation persisted successfully',
      });

      onOpenChange(false);
    },
  });

  const { data, refetch } = useQuery(getClients, {
    fedGraphName: slug,
    namespace,
  });

  useEffect(() => {
    if (open) {
      refetch();
    }
  }, [open, refetch]);

  const form = useZodForm<Input>({
    schema: FormSchema,
  });

  const onSubmit: SubmitHandler<Input> = (formData) => {
    const clientName = formData.clientId
      ? data?.clients.find((c) => c.id === formData.clientId)?.name
      : formData.clientName;

    if (!query) {
      toast({
        description: 'Please save a valid query',
      });
      return;
    }

    if (!clientName) {
      toast({
        description: 'Please use a valid client name',
      });
      return;
    }

    const operations = [
      create(PersistedOperationSchema, {
        id: crypto.createHash('sha256').update(query).digest('hex'),
        contents: query,
      }),
    ];

    mutate({
      fedGraphName: slug,
      clientName,
      operations,
      namespace,
    });
  };

  if (!query) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-w-4xl grid-cols-5 items-start divide-x">
        <div className="scrollbar-custom col-span-3 h-full max-h-[450px] overflow-auto">
          <CodeViewer code={query} />
        </div>
        <div className="col-span-2 flex h-full w-full flex-col pl-4">
          <DialogHeader>
            <DialogTitle>Persist Operation</DialogTitle>
            <DialogDescription>Save query to persisted operations</DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex-1">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="flex h-full flex-col gap-y-6">
                <FormField
                  control={form.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client</FormLabel>
                      <Select
                        onValueChange={(val) => {
                          if (!val) {
                            setIsNew(true);
                            form.setValue('clientName', '');
                          } else {
                            setIsNew(false);
                            form.setValue('clientName', data?.clients.find((c) => c.id === val)?.name ?? '');
                          }

                          field.onChange(val);
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a client" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="">
                            <span className="flex items-center gap-x-2">
                              <SparklesIcon className="h-4 w-4" /> Create New
                            </span>
                          </SelectItem>
                          {data?.clients?.map((c) => {
                            return (
                              <SelectItem key={c.id} value={c.id}>
                                <span className="flex items-center gap-x-2">
                                  <PiDevices className="h-4 w-4" /> {c.name}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>

                      <FormMessage />
                    </FormItem>
                  )}
                />
                {isNew && (
                  <FormField
                    control={form.control}
                    name="clientName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Enter name</FormLabel>
                        <FormControl>
                          <TextInput placeholder="Enter new client name" {...field} />
                        </FormControl>

                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                <Button
                  isLoading={isPending}
                  disabled={!form.formState.isValid}
                  className="mt-auto w-full"
                  type="submit"
                >
                  Save
                </Button>
              </form>
            </Form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
