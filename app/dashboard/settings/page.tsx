'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Bell,
  Lock,
  Palette,
  User,
  LogOut,
  MapPin,
  Gauge,
  AlertTriangle,
} from 'lucide-react';
import { useTheme } from 'next-themes';

type NotificationSettings = {
  emailAlerts: boolean;
  speedingAlerts: boolean;
  geofenceAlerts: boolean;
  maintenanceAlerts: boolean;
  offlineAlerts: boolean;
};

type DisplaySettings = {
  theme: string;
  speedUnit: string;
  temperatureUnit: string;
};



export default function SettingsPage() {
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  const { setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('account');

  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>({
    emailAlerts: true,
    speedingAlerts: true,
    geofenceAlerts: true,
    maintenanceAlerts: true,
    offlineAlerts: true,
  });

  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>({
    theme: 'dark',
    speedUnit: 'km/h',
    temperatureUnit: 'C',
  });

  const [pageLoading, setPageLoading] = useState(true);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [savingDisplay, setSavingDisplay] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });


  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    if (user) {
      fetchSettings();
    }
  }, [user]);

  const fetchSettings = async () => {
    try {
      setPageLoading(true);
      setError('');
      setMessage('');

      const res = await fetch('/api/settings', {
        method: 'GET',
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to load settings');
      }

      const loadedNotificationSettings = {
        emailAlerts: data.emailAlerts,
        speedingAlerts: data.speedingAlerts,
        geofenceAlerts: data.geofenceAlerts,
        maintenanceAlerts: data.maintenanceAlerts,
        offlineAlerts: data.offlineAlerts,
      };

      const loadedDisplaySettings = {
        theme: data.theme,
        speedUnit: data.speedUnit,
        temperatureUnit: data.temperatureUnit,
      };

      setNotificationSettings(loadedNotificationSettings);
      setDisplaySettings(loadedDisplaySettings);
      setTheme(data.theme);
    } catch (err: any) {
      setError(err.message || 'Failed to load settings');
    } finally {
      setPageLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  const saveNotificationSettings = async () => {
    try {
      setSavingNotifications(true);
      setError('');
      setMessage('');

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...notificationSettings,
          ...displaySettings,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to save notification settings');
      }

      setMessage('Notification settings saved successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to save notification settings');
    } finally {
      setSavingNotifications(false);
    }
  };

  const saveDisplaySettings = async () => {
    try {
      setSavingDisplay(true);
      setError('');
      setMessage('');

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...notificationSettings,
          ...displaySettings,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to save display settings');
      }

      setTheme(displaySettings.theme);
      setMessage('Display settings saved successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to save display settings');
    } finally {
      setSavingDisplay(false);
    }
  };

  const handleChangePassword = async () => {
    try {
      setError('');
      setMessage('');

      if (
        !passwordForm.currentPassword ||
        !passwordForm.newPassword ||
        !passwordForm.confirmPassword
      ) {
        throw new Error('Please fill all password fields');
      }

      if (passwordForm.newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters');
      }

      if (passwordForm.newPassword !== passwordForm.confirmPassword) {
        throw new Error('New password and confirm password do not match');
      }

      setChangingPassword(true);

      const res = await fetch('/api/settings/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Failed to update password');
      }

      setMessage('Password updated successfully');
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update password');
    } finally {
      setChangingPassword(false);
    }
  };

  if (isLoading || !user || pageLoading) {
    return <div className="p-6">Loading settings...</div>;
  }

  const tabs = [
    { id: 'account', label: 'Account', icon: <User className="h-4 w-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
    { id: 'display', label: 'Display', icon: <Palette className="h-4 w-4" /> },
    { id: 'security', label: 'Security', icon: <Lock className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="mt-2 text-muted-foreground">Manage your account and preferences</p>
      </div>

      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-lg ${activeTab === tab.id
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'account' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>View your account details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Full Name</label>
                <Input value={user.name} readOnly className="mt-1 bg-muted" />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Email Address</label>
                <Input value={user.email} readOnly className="mt-1 bg-muted" />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Company</label>
                <Input value={user.company || ''} readOnly className="mt-1 bg-muted" />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Role</label>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="default">{user.role.toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {user.role === 'ADMIN' && 'Full system access'}
                    {user.role === 'USER' && 'Customer access'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Logging out will end your current session.
              </p>
              <Button
                onClick={handleLogout}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'notifications' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Choose which alerts you want to receive</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  id: 'emailAlerts',
                  label: 'Email Notifications',
                  description: 'Receive alerts via email',
                  icon: <Bell className="h-4 w-4" />,
                },
                {
                  id: 'speedingAlerts',
                  label: 'Speeding Alerts',
                  description: 'Alert when vehicle exceeds speed limit',
                  icon: <Gauge className="h-4 w-4" />,
                },
                {
                  id: 'geofenceAlerts',
                  label: 'Geofence Alerts',
                  description: 'Alert when vehicle enters/exits zones',
                  icon: <MapPin className="h-4 w-4" />,
                },
                {
                  id: 'maintenanceAlerts',
                  label: 'Maintenance Alerts',
                  description: 'Alert for scheduled maintenance',
                  icon: <AlertTriangle className="h-4 w-4" />,
                },
                {
                  id: 'offlineAlerts',
                  label: 'Offline Alerts',
                  description: 'Alert when vehicle goes offline',
                  icon: <Bell className="h-4 w-4" />,
                },
              ].map((setting) => (
                <div
                  key={setting.id}
                  className="flex items-start justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-0.5 text-primary">{setting.icon}</div>
                    <div>
                      <p className="font-medium text-foreground">{setting.label}</p>
                      <p className="text-xs text-muted-foreground">{setting.description}</p>
                    </div>
                  </div>

                  <input
                    type="checkbox"
                    checked={notificationSettings[setting.id as keyof NotificationSettings]}
                    onChange={(e) =>
                      setNotificationSettings((prev) => ({
                        ...prev,
                        [setting.id]: e.target.checked,
                      }))
                    }
                    className="h-4 w-4"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Button
            className="w-full"
            onClick={saveNotificationSettings}
            disabled={savingNotifications}
          >
            {savingNotifications ? 'Saving...' : 'Save Notification Settings'}
          </Button>
        </div>
      )}

      {activeTab === 'display' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Display Preferences</CardTitle>
              <CardDescription>Customize dashboard behavior</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Theme</label>
                <select
                  value={displaySettings.theme}
                  onChange={(e) => {
                    const newTheme = e.target.value;
                    setDisplaySettings((prev) => ({ ...prev, theme: newTheme }));
                    setTheme(newTheme);
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">Auto (System)</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Speed Unit</label>
                <select
                  value={displaySettings.speedUnit}
                  onChange={(e) =>
                    setDisplaySettings((prev) => ({ ...prev, speedUnit: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground"
                >
                  <option value="km/h">Kilometers per hour (km/h)</option>
                  <option value="mph">Miles per hour (mph)</option>
                  <option value="m/s">Meters per second (m/s)</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Temperature Unit</label>
                <select
                  value={displaySettings.temperatureUnit}
                  onChange={(e) =>
                    setDisplaySettings((prev) => ({
                      ...prev,
                      temperatureUnit: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground"
                >
                  <option value="C">Celsius (°C)</option>
                  <option value="F">Fahrenheit (°F)</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Button className="w-full" onClick={saveDisplaySettings} disabled={savingDisplay}>
            {savingDisplay ? 'Saving...' : 'Save Display Settings'}
          </Button>
        </div>
      )}

      {activeTab === 'security' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage your account security</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <h3 className="font-semibold text-foreground">Change Password</h3>

                <Input
                  type="password"
                  placeholder="Current password"
                  value={passwordForm.currentPassword}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({
                      ...prev,
                      currentPassword: e.target.value,
                    }))
                  }
                />

                <Input
                  type="password"
                  placeholder="New password"
                  value={passwordForm.newPassword}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({
                      ...prev,
                      newPassword: e.target.value,
                    }))
                  }
                />

                <Input
                  type="password"
                  placeholder="Confirm new password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) =>
                    setPasswordForm((prev) => ({
                      ...prev,
                      confirmPassword: e.target.value,
                    }))
                  }
                />

                <Button
                  variant="outline"
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                >
                  {changingPassword ? 'Updating...' : 'Change Password'}
                </Button>
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">Two-Factor Authentication</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  This feature is not implemented yet.
                </p>
                <Button variant="outline" disabled>
                  Enable 2FA
                </Button>
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">Active Sessions</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Session management is not implemented yet.
                </p>
                <Button variant="outline" disabled>
                  View All Sessions
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}