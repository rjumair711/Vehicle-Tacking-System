'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { user, login, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      router.push('/dashboard');
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError('Invalid credentials. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const demoAccounts = [
    { email: 'admin@fleettrack.com', password: 'admin123', role: 'Admin' },
    { email: 'manager@fleettrack.com', password: 'manager123', role: 'Manager' },
    { email: 'operator@fleettrack.com', password: 'operator123', role: 'Operator' },
    { email: 'viewer@fleettrack.com', password: 'viewer123', role: 'Viewer' },
  ];

  const fillDemo = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background to-background/95 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">
        {/* Logo and Branding */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <span className="text-xl font-bold text-primary-foreground">FT</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">FleetTrack</h1>
          <p className="mt-2 text-sm text-muted-foreground">Professional Fleet Management System</p>
        </div>

        {/* Login Form */}
        <Card className="border-border bg-card shadow-lg">
          <CardHeader>
            <CardTitle>Login</CardTitle>
            <CardDescription>Enter your credentials to access the dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-foreground">
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-input"
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium text-foreground">
                  Password
                </label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="bg-input"
                />
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting || !email || !password}>
                {isSubmitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Demo Accounts */}
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase text-muted-foreground">Demo Accounts</p>
          <div className="grid gap-2">
            {demoAccounts.map((account) => (
              <button
                key={account.email}
                onClick={() => fillDemo(account.email, account.password)}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{account.role}</span>
                  <span className="text-xs text-muted-foreground truncate">{account.email}</span>
                </div>
                <span className="text-xs font-mono text-muted-foreground">•••••</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
