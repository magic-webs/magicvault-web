'use client';

import { useState, useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { VStack } from '@astryxdesign/core/VStack';
import { Center } from '@astryxdesign/core/Center';
import { Text, Heading } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Icon } from '@astryxdesign/core/Icon';
import { Banner } from '@astryxdesign/core/Banner';
import { Link } from '@astryxdesign/core/Link';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import { register, saveSession, getStoredUser, AuthApiError } from '@/lib/auth-api';
import { PhoneInput, DEFAULT_COUNTRY_CODE, toE164 } from '@/components/phone-input';
import { ThemeToggle } from '@/components/theme-provider';

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

// Standalone auth page paints its own background (no AppShell host).
const pageStyle: CSSProperties = { minHeight: '100%', backgroundColor: 'var(--color-background-body)', position: 'relative' };
const contentStyle: CSSProperties = { width: '100%', maxWidth: 400 };

export default function RegisterPage() {
  const router = useRouter();
  const isMobile = useMediaQuery('(max-width: 639px)');
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [localNumber, setLocalNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (getStoredUser()) {
      router.push('/profile');
    }
  }, [router]);

  async function handleRegister() {
    setError('');
    const whatsappNumber = toE164(countryCode, localNumber);

    if (!PHONE_PATTERN.test(whatsappNumber)) {
      setError('Enter a valid phone number.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await register(whatsappNumber, password);
      saveSession(result);
      router.push('/');
    } catch (err) {
      setError(err instanceof AuthApiError ? err.message : 'Could not create your account. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Center axis="both" style={{ ...pageStyle, padding: isMobile ? 'var(--spacing-4) var(--spacing-3)' : 'var(--spacing-8)' }}>
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle size="md" />
      </div>
      <VStack gap={4} hAlign="center" style={contentStyle}>
        <VStack gap={2} hAlign="center">
          <Icon icon={ChatBubbleLeftRightIcon} size="lg" />
          <Text type="body" weight="bold" size="lg">
            Magic Vault
          </Text>
        </VStack>

        <Card padding={isMobile ? 4 : 8} width="100%">
          <VStack gap={4} hAlign="stretch">
            <VStack gap={1} hAlign="center">
              <Heading level={2}>Create your account</Heading>
              <Text type="body" color="secondary" size="sm">
                Sign up with your WhatsApp number
              </Text>
            </VStack>

            {error && <Banner status="error" title={error} container="card" />}

            <PhoneInput
              countryCode={countryCode}
              onCountryCodeChange={setCountryCode}
              localNumber={localNumber}
              onLocalNumberChange={setLocalNumber}
              size="lg"
              isRequired
            />

            <TextInput
              label="Password"
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
              type="password"
              size="lg"
              isRequired
            />

            <TextInput
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter your password"
              type="password"
              size="lg"
              isRequired
            />

            <Button label="Create account" variant="primary" size="lg" isLoading={isLoading} onClick={handleRegister} />

            <Text type="body" size="sm" justify="center">
              Already have an account?{' '}
              <Link as={NextLink} href="/login">
                Sign in
              </Link>
            </Text>
          </VStack>
        </Card>
      </VStack>
    </Center>
  );
}
