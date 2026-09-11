import { SchemaType, toSchemaType } from '@/components/schema/schema-selection';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface SchemaTypeRadioGroupProps {
  /** Empty while another entry in the dropdown is selected, so neither item shows as active. */
  value: SchemaType | '';
  onSelect: (schemaType: SchemaType) => void;
  className?: string;
}

/** The client/router choice, offered both for the graph and for each feature flag. */
export const SchemaTypeRadioGroup = ({ value, onSelect, className }: SchemaTypeRadioGroupProps) => {
  const itemClassName = cn('items-center justify-between pl-2', className);

  return (
    <DropdownMenuRadioGroup value={value} onValueChange={(next) => onSelect(toSchemaType(next))}>
      <DropdownMenuRadioItem className={itemClassName} value="client">
        Client Schema
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem className={itemClassName} value="router">
        Router Schema
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
};
