import {
  Body,
  Button,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';
import { TailwindConfig } from '@/components/tailwind-config.js';
import { MainContainer } from '@/components/main-container.js';

export const OrganizationInviteEmail = () => {
  return (
    <Html>
      <Head />
      <TailwindConfig>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Preview>Join [%= organizationName %] on WunderGraph Cosmo</Preview>
          <MainContainer>
            <Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
              Join the <strong className="font-bold">[%= organizationName %]</strong> organization on
              {' '}<strong className="font-bold">WunderGraph Cosmo</strong>
            </Heading>
            <Text className="text-black text-[14px] leading-[24px]">
              [%- inviteBody %]
            </Text>
            <Section className="text-center mt-[32px] mb-[32px]">
              <Button
                className="bg-brand rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
                href="[%= inviteLink %]"
              >
                Join the organization
              </Button>
            </Section>
            <Text className="text-black text-[14px] leading-[24px]">
              or copy and paste this URL into your browser:{' '}
              <Link href="[%= inviteLink %]" className="text-brand no-underline">
                [%= inviteLink %]
              </Link>
            </Text>
          </MainContainer>
        </Body>
      </TailwindConfig>
    </Html>
  );
};

export default OrganizationInviteEmail;
