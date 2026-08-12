'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MessageSquare, AlertCircle, Loader2 } from "lucide-react";
import { register, saveSession, getStoredUser, AuthApiError } from '@/lib/auth-api';
import { PhoneInput, DEFAULT_COUNTRY_CODE, toE164 } from '@/components/phone-input';
import { ThemeToggle } from '@/components/theme-provider';

const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export default function RegisterPage() {
  const router = useRouter();
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

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
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
    <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-background p-4 relative">
      {/* Top right theme toggle */}
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[400px] flex flex-col gap-6">
        {/* Logo and Brand */}
        <div className="flex flex-col items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <MessageSquare className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">Magic Vault</h1>
        </div>

        {/* Card for registration form */}
        <Card className="border-border/80 shadow-md">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-xl font-bold">Create account</CardTitle>
            <CardDescription className="text-xs">
              Sign up with your WhatsApp number
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRegister} className="flex flex-col gap-4">
              {error && (
                <div className="flex items-center gap-2 text-xs font-medium text-red-600 bg-red-500/10 border border-red-500/20 px-3.5 py-2.5 rounded-lg">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <PhoneInput
                countryCode={countryCode}
                onCountryCodeChange={setCountryCode}
                localNumber={localNumber}
                onLocalNumberChange={setLocalNumber}
                isRequired
              />

              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-medium text-foreground">
                  Password <span className="text-red-500">*</span>
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-sm font-medium text-foreground">
                  Confirm Password <span className="text-red-500">*</span>
                </label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                />
              </div>

              <Button type="submit" className="w-full mt-2" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create account'
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground mt-1">
                Already have an account?{' '}
                <NextLink href="/login" className="text-primary hover:underline font-medium">
                  Sign in
                </NextLink>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
