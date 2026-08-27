import { GraphContext } from '@/components/layout/graph-layout';
import { FeatureFlagMenuItem } from '@/components/schema/feature-flag-menu-item';
import { SchemaSelection } from '@/components/schema/schema-selection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { Component2Icon } from '@radix-ui/react-icons';
import { FeatureFlag, FeatureSubgraphInFlagComposition } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { useContext } from 'react';
import { MdOutlineFeaturedPlayList } from 'react-icons/md';
import { PiGraphLight } from 'react-icons/pi';

export interface SchemaSelectorProps {
  title: string;
  supportsFederation: boolean;
  featureFlags: FeatureFlag[];
  selection: SchemaSelection;
  onSelect: (selection: SchemaSelection) => void;
  subgraphNames?: string[];
  featureSubgraphsOfFlag?: (featureFlagId: string) => FeatureSubgraphInFlagComposition[];
}

export const SchemaSelector = ({
  title,
  supportsFederation,
  featureFlags,
  selection,
  onSelect,
  subgraphNames,
  featureSubgraphsOfFlag,
}: SchemaSelectorProps) => {
  const graphData = useContext(GraphContext);
  const activeSchemaType = selection.schemaType ?? 'client';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger value={title} className="w-full md:ml-auto md:w-max md:min-w-[200px]" asChild>
        <div className="flex items-center justify-center">
          <Button className="flex w-[220px] text-sm" variant="outline" asChild>
            <div className="flex justify-between">
              <div className="flex">
                <p className="max-w-[120px] truncate">
                  {supportsFederation ? title : selection.subgraph ? 'Published SDL' : 'Router SDL'}
                </p>
                {!selection.subgraph && (
                  <Badge variant="secondary" className="ml-2">
                    {activeSchemaType}
                  </Badge>
                )}
              </div>
              <ChevronUpDownIcon className="h-4 w-4" />
            </div>
          </Button>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[220px]">
        {supportsFederation ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                <PiGraphLight className="h-3 w-3" /> Graph
              </DropdownMenuLabel>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{graphData?.graph?.name}</DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      onValueChange={(value) => onSelect({ schemaType: value })}
                      value={!selection.featureFlag && !selection.subgraph ? activeSchemaType : ''}
                    >
                      <DropdownMenuRadioItem className="w-[150px] items-center justify-between pl-2" value="client">
                        Client Schema
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem className="w-[150px] items-center justify-between pl-2" value="router">
                        Router Schema
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>
            </DropdownMenuGroup>

            {featureFlags.length > 0 && (
              <>
                <Separator className="my-2" />

                <DropdownMenuGroup>
                  <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                    <MdOutlineFeaturedPlayList className="h-3 w-3" /> Feature Flags
                  </DropdownMenuLabel>
                  {featureFlags.map((featureFlag) => (
                    <FeatureFlagMenuItem
                      key={featureFlag.id}
                      featureFlag={featureFlag}
                      featureSubgraphs={featureSubgraphsOfFlag?.(featureFlag.id) ?? []}
                      selection={selection}
                      onSelect={onSelect}
                    />
                  ))}
                </DropdownMenuGroup>
              </>
            )}

            {subgraphNames && subgraphNames.length > 0 && (
              <>
                <Separator className="my-2" />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="mb-1 flex flex-row items-center justify-start gap-x-1 text-[0.7rem] uppercase tracking-wider">
                    <Component2Icon className="h-3 w-3" /> Subgraphs
                  </DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    onValueChange={(value) => onSelect({ subgraph: value })}
                    value={selection.featureFlag ? '' : (selection.subgraph ?? '')}
                  >
                    {subgraphNames.map((name) => (
                      <DropdownMenuRadioItem className="items-center justify-between pl-2" key={name} value={name}>
                        {name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </>
            )}
          </>
        ) : (
          <DropdownMenuRadioGroup
            onValueChange={(value) => onSelect({ subgraph: value || undefined })}
            value={selection.subgraph ?? ''}
          >
            <DropdownMenuRadioItem className="w-[150px] items-center justify-between pl-2" value="">
              Router SDL
            </DropdownMenuRadioItem>
            {(subgraphNames ?? []).map((name) => (
              <DropdownMenuRadioItem className="w-[150px] items-center justify-between pl-2" key={name} value={name}>
                Published SDL
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
