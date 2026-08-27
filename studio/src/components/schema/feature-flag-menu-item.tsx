import { SchemaSelection } from '@/components/schema/schema-selection';
import { StaleCompositionIcon } from '@/components/schema/stale-composition-warning';
import {
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { FeatureFlag, FeatureSubgraphInFlagComposition } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { RxComponentInstance } from 'react-icons/rx';

export interface FeatureFlagMenuItemProps {
  featureFlag: FeatureFlag;
  featureSubgraphs: FeatureSubgraphInFlagComposition[];
  selection: SchemaSelection;
  onSelect: (selection: SchemaSelection) => void;
}

export const FeatureFlagMenuItem = ({
  featureFlag,
  featureSubgraphs,
  selection,
  onSelect,
}: FeatureFlagMenuItemProps) => {
  const { name, hasFailedLatestComposition } = featureFlag;
  const isActive = selection.featureFlag === name;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex items-center gap-x-1.5">
          {name}
          {hasFailedLatestComposition && <StaleCompositionIcon />}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={isActive && !selection.subgraph ? (selection.schemaType ?? 'client') : ''}
            onValueChange={(value) => onSelect({ featureFlag: name, schemaType: value })}
          >
            <DropdownMenuRadioItem className="w-[170px] items-center justify-between pl-2" value="client">
              Client Schema
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem className="w-[170px] items-center justify-between pl-2" value="router">
              Router Schema
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>

          {featureSubgraphs.length > 0 && (
            <>
              <DropdownMenuSeparator className="my-2" />
              <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                <RxComponentInstance className="h-3 w-3" /> Feature Subgraphs
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={isActive ? (selection.subgraph ?? '') : ''}
                onValueChange={(value) => onSelect({ featureFlag: name, subgraph: value })}
              >
                {featureSubgraphs.map((featureSubgraph) => (
                  <DropdownMenuRadioItem
                    className="w-[170px] items-center justify-between pl-2"
                    key={featureSubgraph.id}
                    value={featureSubgraph.name}
                  >
                    <span className="truncate">{featureSubgraph.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
};
