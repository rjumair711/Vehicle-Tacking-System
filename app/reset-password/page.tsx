'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (!/^[0-9a-f]{64}$/.test(token)) { setError('Invalid reset link. Request a new link from the login page.'); return; }
    if (password.length < 8 || password.length > 128) { setError('Password must be between 8 and 128 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSaving(true);
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Reset failed');
      setPassword(''); setConfirm(''); setSuccess(data.message || 'Password updated.');
      // Remove the token from visible browser history after use.
      window.history.replaceState(null, '', '/reset-password');
    } catch (err: any) { setError(err?.message || 'Reset failed'); }
    finally { setSaving(false); }
  };

  return <Card className="w-full max-w-md shadow-lg">
    <CardHeader><CardTitle>Choose a new password</CardTitle>
      <CardDescription>Your password reset link expires after 15 minutes and works only once.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {success ? <><p role="status" className="text-sm">{success}</p><Button asChild className="w-full"><Link href="/">Go to sign in</Link></Button></> :
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1"><label htmlFor="new-password" className="text-sm font-medium">New password</label>
            <Input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <div className="space-y-1"><label htmlFor="confirm-password" className="text-sm font-medium">Confirm new password</label>
            <Input id="confirm-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} /> Show password</label>
          <Button className="w-full" type="submit" disabled={saving || !token}>{saving ? 'Saving...' : 'Change password'}</Button>
          <Link href="/" className="block text-center text-sm text-primary hover:underline">Back to sign in</Link>
        </form>}
    </CardContent>
  </Card>;
}

export default function ResetPasswordPage() {
  return <main className="flex min-h-screen items-center justify-center bg-background px-4">
    <Suspense fallback={<p>Loading reset page...</p>}><ResetPasswordForm /></Suspense>
  </main>;
}
