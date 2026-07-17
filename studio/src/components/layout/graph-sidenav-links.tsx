import {
  ChartBarIcon,
  ClipboardIcon,
  CommandLineIcon,
  ServerStackIcon,
} from '@heroicons/react/24/outline';
import {
  CheckCircledIcon,
  Component2Icon,
  FileTextIcon,
  HomeIcon,
  PlayIcon,
} from '@radix-ui/react-icons';
import { MdOutlineFeaturedPlayList } from 'react-icons/md';
import { PiBracketsCurlyBold, PiCubeFocus, PiDevices, PiGitBranch, PiToggleRight } from 'react-icons/pi';
import { NavChild, NavLink } from './sidenav';

export const buildGraphSideNavLinks = ({
  basePath,
  proposalsEnabled,
  subgraphChildren,
}: {
  basePath: string;
  proposalsEnabled: boolean;
  subgraphChildren: NavChild[];
}): NavLink[] => {
  const graphLinks: NavLink[] = [
    {
      title: 'Overview',
      href: basePath,
      icon: <HomeIcon className="h-4 w-4" />,
    },
    {
      title: 'Subgraphs',
      href: basePath + '/subgraphs',
      icon: <Component2Icon className="h-4 w-4" />,
      children: subgraphChildren,
    },
    {
      title: 'Feature Flags',
      href: basePath + '/feature-flags',
      icon: <MdOutlineFeaturedPlayList className="h-4 w-4" />,
      matchExact: false,
    },
    {
      title: 'Playground',
      href: basePath + '/playground',
      icon: <PlayIcon className="h-4 w-4" />,
    },
    {
      title: 'Schema',
      href: basePath + '/schema',
      matchExact: false,
      icon: <FileTextIcon className="h-4 w-4" />,
    },
    {
      title: 'Analytics',
      href: basePath + '/analytics',
      matchExact: false,
      icon: <ChartBarIcon className="h-4 w-4" />,
    },
    {
      title: 'Operations',
      href: basePath + '/operations',
      matchExact: false,
      icon: <CommandLineIcon className="h-4 w-4" />,
    },
    {
      title: 'Routers',
      href: basePath + '/routers',
      matchExact: false,
      icon: <ServerStackIcon className="h-4 w-4" />,
    },
    {
      title: 'Compositions',
      href: basePath + '/compositions',
      matchExact: false,
      icon: <PiCubeFocus className="h-4 w-4" />,
    },
    {
      title: 'Clients',
      href: basePath + '/clients',
      icon: <PiDevices className="h-4 w-4" />,
    },
    {
      title: 'Changelog',
      href: basePath + '/changelog',
      icon: <PiGitBranch className="h-4 w-4" />,
    },
    {
      title: 'Checks',
      href: basePath + '/checks',
      matchExact: false,
      icon: <CheckCircledIcon className="h-4 w-4" />,
    },
    {
      title: 'Overrides',
      href: basePath + '/overrides',
      matchExact: true,
      icon: <PiToggleRight className="h-4 w-4" />,
    },
    {
      title: 'Cache Operations',
      href: basePath + '/cache-operations',
      matchExact: false,
      icon: <PiBracketsCurlyBold className="h-4 w-4" />,
    },
  ];

  if (proposalsEnabled) {
    graphLinks.push({
      title: 'Proposals',
      href: basePath + '/proposals',
      matchExact: false,
      icon: <ClipboardIcon className="h-4 w-4" />,
    });
  }

  return graphLinks;
};
