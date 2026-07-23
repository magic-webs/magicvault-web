'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@astryxdesign/core/AppShell';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { NavIcon } from '@astryxdesign/core/NavIcon';
import { Center } from '@astryxdesign/core/Center';
import { Card } from '@astryxdesign/core/Card';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text, Heading } from '@astryxdesign/core/Text';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Divider } from '@astryxdesign/core/Divider';
import {
  ChatBubbleLeftRightIcon,
  UserIcon,
  ArrowLeftOnRectangleIcon,
  PhoneIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { getStoredUser, getMe, clearSession, type AuthUser } from '@/lib/auth-api';
import { ThemeToggle } from '@/components/theme-provider';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const cached = getStoredUser();
    if (cached) {
      setUser(cached);
    }

    getMe()
      .then((fetchedUser) => {
        setUser(fetchedUser);
      })
      .catch(() => {
        if (!cached) {
          setUser(null);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  function handleSignOut() {
    clearSession();
    router.push('/login');
  }

  if (isLoading) {
    return (
      <AppShell
        height="fill"
        contentPadding={0}
        topNav={
          <TopNav
            label="Magic Vault Profile"
            heading={<TopNavHeading heading="Magic Vault" logo={<NavIcon icon={<ChatBubbleLeftRightIcon />} />} />}
          />
        }
      >
        <Center axis="both" style={{ minHeight: '100%', padding: 'var(--spacing-8)' }}>
          <Text type="body" color="secondary">
            Loading profile...
          </Text>
        </Center>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell
        height="fill"
        contentPadding={0}
        topNav={
          <TopNav
            label="Magic Vault Profile"
            heading={<TopNavHeading heading="Magic Vault" logo={<NavIcon icon={<ChatBubbleLeftRightIcon />} />} />}
          />
        }
      >
        <Center axis="both" style={{ minHeight: '100%', padding: 'var(--spacing-4)' }}>
          <Card padding={6} width="100%" maxWidth={420}>
            <VStack gap={4} hAlign="center">
              <Icon icon={UserIcon} size="lg" />
              <VStack gap={1} hAlign="center">
                <Heading level={2}>Not Signed In</Heading>
                <Text type="body" color="secondary" justify="center">
                  Sign in or register an account to view your profile and saved vault settings.
                </Text>
              </VStack>
              <HStack gap={3} justify="center" wrap="wrap">
                <Button label="Sign in" variant="primary" onClick={() => router.push('/login')} />
                <Button label="Register" variant="secondary" onClick={() => router.push('/register')} />
              </HStack>
            </VStack>
          </Card>
        </Center>
      </AppShell>
    );
  }

  const userDisplayName = user.name || 'Magic Vault User';

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      topNav={
        <TopNav
          label="Magic Vault Profile"
          heading={
            <TopNavHeading
              heading="Magic Vault"
              logo={<NavIcon icon={<ChatBubbleLeftRightIcon />} />}
              onClick={() => router.push('/')}
            />
          }
          endContent={
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button
                label="Simulator"
                size="sm"
                variant="secondary"
                icon={<Icon icon={ChatBubbleLeftRightIcon} />}
                onClick={() => router.push('/')}
              />
              <ThemeToggle size="sm" />
            </HStack>
          }
        />
      }
    >
      <Center axis="both" style={{ minHeight: '100%', padding: 'var(--spacing-4) var(--spacing-4)' }}>
        <Card padding={8} width="100%" maxWidth={480}>
          <VStack gap={5} hAlign="stretch">
            <HStack gap={4} vAlign="center" wrap="wrap">
              <Avatar name={userDisplayName} size="xl" />
              <VStack gap={1} style={{ flex: 1 }}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Heading level={2}>{userDisplayName}</Heading>
                  <Badge variant="success" label="Active" icon={<Icon icon={ShieldCheckIcon} />} />
                </HStack>
                <Text type="body" color="secondary" size="sm">
                  WhatsApp Document Assistant Account
                </Text>
              </VStack>
            </HStack>

            <Divider />

            <VStack gap={3}>
              <Text type="supporting" weight="bold">
                ACCOUNT DETAILS
              </Text>

              <HStack gap={3} vAlign="center">
                <Icon icon={PhoneIcon} size="md" color="secondary" />
                <VStack gap={0.5}>
                  <Text type="supporting">WhatsApp Number</Text>
                  <Text type="body" weight="medium">
                    {user.whatsappNumber}
                  </Text>
                </VStack>
              </HStack>

              <HStack gap={3} vAlign="center">
                <Icon icon={UserIcon} size="md" color="secondary" />
                <VStack gap={0.5}>
                  <Text type="supporting">User Account ID</Text>
                  <Text type="body" weight="medium" className="font-mono text-xs">
                    {user.id}
                  </Text>
                </VStack>
              </HStack>
            </VStack>

            <Divider />

            <VStack gap={3}>
              <Button
                label="View Saved Vault Documents"
                variant="secondary"
                size="lg"
                icon={<Icon icon={DocumentTextIcon} />}
                onClick={() => router.push('/documents')}
              />
              <Button
                label="Launch WhatsApp Simulator"
                variant="primary"
                size="lg"
                icon={<Icon icon={ChatBubbleLeftRightIcon} />}
                onClick={() => router.push('/')}
              />
              <Button
                label="Sign out"
                variant="destructive"
                size="lg"
                icon={<Icon icon={ArrowLeftOnRectangleIcon} />}
                onClick={handleSignOut}
              />
            </VStack>
          </VStack>
        </Card>
      </Center>
    </AppShell>
  );
}
