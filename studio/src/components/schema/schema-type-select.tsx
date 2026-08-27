import { SchemaType } from '@/components/schema/schema-selection';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { sentenceCase } from 'change-case';

export interface SchemaTypeSelectProps {
  value: SchemaType;
  onValueChange: (value: SchemaType) => void;
  className?: string;
}

/** Switches between a graph's client and router schema, with a note on what each one is. */
export const SchemaTypeSelect = ({ value, onValueChange, className }: SchemaTypeSelectProps) => {
  return (
    <Select onValueChange={onValueChange} value={value}>
      <SelectTrigger className={className}>
        <SelectValue>{sentenceCase(value)} Schema</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="client">
          Client Schema
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            The schema available to the clients and through introspection
          </p>
        </SelectItem>
        <Separator />
        <SelectItem value="router">
          Router Schema
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            The full schema used by the router to plan your operations
          </p>
        </SelectItem>
      </SelectContent>
    </Select>
  );
};
