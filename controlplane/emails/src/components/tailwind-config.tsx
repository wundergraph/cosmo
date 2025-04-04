import React from 'react';
import { Tailwind, } from '@react-email/components';

export function TailwindConfig({ children }: React.PropsWithChildren) {
  return (
    <Tailwind
      config={{
        theme: {
          extend: {
            colors: {
              brand: '#ea4899',
            }
          }
        }
      }}
    >
      {children}
    </Tailwind>
  );
}