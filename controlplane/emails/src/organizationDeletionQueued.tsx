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
  Row,
} from '@react-email/components';
import * as React from 'react';
import { TailwindConfig } from '@/components/tailwind-config.js';
import { MainContainer } from '@/components/main-container.js'

export const OrganizationQueuedForDeletionEmail = () => {
  return (
    <Html>
      <Head />
      <TailwindConfig>
        <Body className="bg-white my-auto mx-auto font-sans px-2">
          <Preview>Organization Queued for Deletion</Preview>
          <MainContainer>
            <Heading className="text-black text-[24px] font-bold text-center p-0 my-[30px] mx-0">
              Organization Queued for Deletion
            </Heading>
            <Text className="text-black text-[16px]">
              The organization <span className="font-bold">[%= organizationName %]</span> has been scheduled for
              {' '}deletion by:
            </Text>
            <Section className="bg-gray-100 text-[14px] p-3 font-mono">
              <Row className="py-0.5">User: [%= userDisplayName %]</Row>
              <Row>Date: [%= queuedOnDate %]</Row>
            </Section>
            <Text>
              This irreversible deletion will take place on <span className="font-bold">[%= deletionDate %]</span>{' '}
              and will permanently remove the organization and all data associated with it.
            </Text>
            <Text className="font-bold">
              If this was unintentional and you would like to cancel the deletion:
            </Text>
            <Section className="text-center mt-[32px] mb-[32px]">
              <Button
                className="bg-brand rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
                href="[%= restoreLink %]"
              >
                Restore Organization
              </Button>
            </Section>
            <Text className="text-black text-[14px] leading-[24px]">
              or copy and paste this URL into your browser:{' '}
              <Link href="[%= restoreLink %]" className="text-brand no-underline">
                [%= restoreLink %]
              </Link>
            </Text>
          </MainContainer>
        </Body>
      </TailwindConfig>
    </Html>
  );
};

export default OrganizationQueuedForDeletionEmail;
