import React from 'react';
import { Img, Link, Section, Container } from '@react-email/components';

export function CosmoLogo() {
  return (
    <Link
      href="https://wundergraph.com/"
      className="flex items-center space-x-2 font-bold text-slate-800 no-underline w-full"
    >
      <Img
        alt="WunderGraph"
        src="https://wundergraph.com/images/logos/wundergraph-light.png"
        width="45"
        height="45"
      />
      WunderGraph
    </Link>
  );
}