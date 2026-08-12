'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  User as UserIcon,
  LogOut,
  Phone,
  ShieldCheck,
  FileText,
  ArrowLeft,
  Loader2
} from "lucide-react";
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

  // Header Nav template for profile
  const HeaderNav = () => (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm">
      <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => router.push('/')}>
        <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
          <MessageSquare className="h-5 w-5" />
        </div>
        <h3 className="font-semibold text-sm">Magic Vault</h3>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/')}
          className="text-xs h-8 gap-1.5"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Chat
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen w-screen flex flex-col bg-background">
        <HeaderNav />
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen w-screen flex flex-col bg-background">
        <HeaderNav />
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-[420px] border-border/80 shadow-md">
            <CardHeader className="text-center pb-2">
              <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-2">
                <UserIcon className="h-6 w-6" />
              </div>
              <CardTitle className="text-xl font-bold">Not Signed In</CardTitle>
              <CardDescription className="text-xs mt-1 leading-relaxed">
                Sign in or register an account to view your profile and saved vault settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-3 justify-center mt-2">
              <Button onClick={() => router.push('/login')} className="flex-1 h-9 text-xs">Sign in</Button>
              <Button onClick={() => router.push('/register')} variant="outline" className="flex-1 h-9 text-xs">Register</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const userDisplayName = user.name || 'Magic Vault User';

  return (
    <div className="min-h-screen w-screen flex flex-col bg-background">
      <HeaderNav />
      
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6 md:p-8">
        <Card className="w-full max-w-[480px] border border-border/80 shadow-md">
          <CardContent className="p-6 space-y-6">
            
            {/* Profile Intro */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
              <Avatar className="size-16 bg-primary text-primary-foreground">
                <AvatarFallback className="bg-primary text-primary-foreground text-xl font-bold">
                  {userDisplayName[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <h2 className="text-xl font-bold leading-none">{userDisplayName}</h2>
                  <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 gap-1 text-[10px] py-0.5 px-2 font-semibold">
                    <ShieldCheck className="h-3 w-3 shrink-0" />
                    Active
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  WhatsApp Document Assistant Account
                </p>
              </div>
            </div>

            <Separator className="bg-border/60" />

            {/* Account Details */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                ACCOUNT DETAILS
              </h3>

              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-0.5">
                  <Phone className="h-4.5 w-4.5" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground leading-none">WhatsApp Number</p>
                  <p className="text-sm font-semibold text-foreground mt-1">{user.whatsappNumber}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 mt-0.5">
                  <UserIcon className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground leading-none">User Account ID</p>
                  <p className="text-xs font-mono text-foreground mt-1 truncate">{user.id}</p>
                </div>
              </div>
            </div>

            <Separator className="bg-border/60" />

            {/* Navigation Options */}
            <div className="flex flex-col gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => router.push('/documents')}
                className="w-full justify-start text-xs h-10 gap-2 font-medium"
              >
                <FileText className="h-4.5 w-4.5 text-muted-foreground" />
                View Saved Vault Documents
              </Button>
              <Button
                variant="default"
                onClick={() => router.push('/')}
                className="w-full justify-start text-xs h-10 gap-2 font-medium bg-emerald-500 hover:bg-emerald-600 text-white border-0"
              >
                <MessageSquare className="h-4.5 w-4.5" />
                Open Chat
              </Button>
              <Button
                variant="destructive"
                onClick={handleSignOut}
                className="w-full justify-start text-xs h-10 gap-2 font-medium"
              >
                <LogOut className="h-4.5 w-4.5" />
                Sign out
              </Button>
            </div>

          </CardContent>
        </Card>
      </div>
    </div>
  );
}
