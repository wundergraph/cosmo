import React from 'react';
import { Container, Section } from '@react-email/components';
import { CosmoLogo } from './cosmo-logo.js';

export function MainContainer({ children }: React.PropsWithChildren) {
  return (
    <Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px]">
      <Section className="mt-[32px]">
        <CosmoLogo />
      </Section>

      {children}
    </Container>
  );
}