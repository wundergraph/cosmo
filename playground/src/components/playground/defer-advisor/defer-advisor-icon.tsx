import type { SVGProps } from 'react';
import { TbHourglass } from 'react-icons/tb';

// Match GraphiQL's sidebar icons: default caps and joins.
export const DeferAdvisorIcon = (props: SVGProps<SVGSVGElement>) => (
  <TbHourglass strokeWidth={1.5} strokeLinecap="butt" strokeLinejoin="miter" {...props} />
);
