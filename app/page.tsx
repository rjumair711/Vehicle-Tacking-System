'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

type PageMode = 'login' | 'forgot-email' | 'forgot-reset';

export default function LoginPage() {
  const router = useRouter();
  const { user, login, isLoading } = useAuth();

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Forgot password state
  const [mode, setMode] = useState<PageMode>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Shared UI state
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) router.push('/dashboard');
  }, [user, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 1: verify email exists
  const handleCheckEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'check-email', email: resetEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setMode('forgot-reset');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: set new password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'reset',
          email: resetEmail,
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setSuccess('Password updated! You can now log in.');
      setMode('login');
      setResetEmail('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchMode = (next: PageMode) => {
    setMode(next);
    setError('');
    setSuccess('');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-linear-to-br from-background to-background/95 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8">

        {/* Logo */}
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <span className="text-xl font-bold text-primary-foreground">FT</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground">FleetTrack</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Professional KTrack Management System
          </p>
        </div>

        <Card className="border-border bg-card shadow-lg">

          {/* ── LOGIN ── */}
          {mode === 'login' && (
            <>
              <CardHeader>
                <CardTitle>Login</CardTitle>
                <CardDescription>Enter your credentials to access the dashboard</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleLogin} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                  {success && (
                    <Alert className="border-green-500 text-green-700">
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertDescription>{success}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <label htmlFor="email" className="text-sm font-medium text-foreground">Email</label>
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
                    <label htmlFor="password" className="text-sm font-medium text-foreground">Password</label>
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

                  <p className="text-center text-sm text-muted-foreground">
                    Forgot your password?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('forgot-email')}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Reset it
                    </button>
                  </p>
                </form>
              </CardContent>
            </>
          )}

          {/* ── FORGOT — STEP 1: enter email ── */}
          {mode === 'forgot-email' && (
            <>
              <CardHeader>
                <CardTitle>Reset Password</CardTitle>
                <CardDescription>Enter your account email to continue</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCheckEmail} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Email</label>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      className="bg-input"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={isSubmitting || !resetEmail}>
                    {isSubmitting ? 'Checking...' : 'Continue'}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Back to Login
                    </button>
                  </p>
                </form>
              </CardContent>
            </>
          )}

          {/* ── FORGOT — STEP 2: set new password ── */}
          {mode === 'forgot-reset' && (
            <>
              <CardHeader>
                <CardTitle>Set New Password</CardTitle>
                <CardDescription>Choose a new password for <strong>{resetEmail}</strong></CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleResetPassword} className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">New Password</label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      className="bg-input"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">Confirm Password</label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="bg-input"
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={isSubmitting || !newPassword || !confirmPassword}>
                    {isSubmitting ? 'Updating...' : 'Update Password'}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Back to Login
                    </button>
                  </p>
                </form>
              </CardContent>
            </>
          )}

        </Card>
      </div>
    </div>
  );
}