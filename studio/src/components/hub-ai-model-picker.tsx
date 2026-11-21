import type { HubAiModel } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Radix Select gives an empty value no item, so "no model picked" has a value of its own.
const UNSET = 'unset';

/**
 * Picks one of the models Hub offers, grouped by provider in Hub's order, or
 * none, with the labels Hub gives them. `value` is a gateway model id, empty
 * for none; `unsetLabel` names what none means.
 */
export const HubAiModelPicker = ({
  id,
  models,
  value,
  unsetLabel,
  onChange,
}: {
  id: string;
  models: HubAiModel[];
  value: string;
  unsetLabel: string;
  onChange: (value: string) => void;
}) => {
  const groups = [...new Set(models.map((model) => model.providerLabel))].map((label) => ({
    label,
    models: models.filter((model) => model.providerLabel === label),
  }));

  return (
    <Select value={value === '' ? UNSET : value} onValueChange={(picked) => onChange(picked === UNSET ? '' : picked)}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>{unsetLabel}</SelectItem>
        {groups.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.models.map((model) => (
              <SelectItem key={model.gatewayModelId} value={model.gatewayModelId}>
                {model.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
};
