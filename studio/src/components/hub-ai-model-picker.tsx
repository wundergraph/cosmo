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

const PROVIDERS = [
  { provider: 'google', label: 'Google' },
  { provider: 'anthropic', label: 'Anthropic' },
  { provider: 'openai', label: 'OpenAI' },
];

const TIERS: Record<string, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

// Radix Select gives an empty value no item, so "no model picked" has a value of its own.
const UNSET = 'unset';

/** A model as admins pick it: its provider and tier, as in "Google · Light". */
export const modelLabel = (model: Pick<HubAiModel, 'provider' | 'tier'>) => {
  const provider = PROVIDERS.find((entry) => entry.provider === model.provider)?.label ?? model.provider;
  return `${provider} · ${TIERS[model.tier] ?? model.tier}`;
};

/**
 * Picks one of the models Hub offers, grouped by provider, or none. `value`
 * is a gateway model id, empty for none; `unsetLabel` names what none means.
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
  const groups = PROVIDERS.map(({ provider, label }) => ({
    label,
    models: models.filter((model) => model.provider === provider),
  })).filter((group) => group.models.length > 0);

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
                {modelLabel(model)}
                <span className="ml-2 text-muted-foreground">{model.name}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
};
