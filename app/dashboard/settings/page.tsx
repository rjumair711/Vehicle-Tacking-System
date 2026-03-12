'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Bell, Lock, Palette, User, LogOut, MapPin, Gauge, AlertTriangle } from 'lucide-react';

export default function SettingsPage() {
  const router = useRouter();
  const { user, logout, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('account');
  const [notificationSettings, setNotificationSettings] = useState({
    emailAlerts: true,
    speedingAlerts: true,
    geofenceAlerts: true,
    maintenanceAlerts: true,
    offlineAlerts: true,
  });

  const [displaySettings, setDisplaySettings] = useState({
    theme: 'dark',
    speedUnit: 'km/h',
    temperatureUnit: 'C',
  });

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/');
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  const handleLogout = () => {
    logout();
    router.push('/');
  };

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

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-lg ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Account Settings */}
      {activeTab === 'account' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>View and manage your account details</CardDescription>
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
                <Input value={user.company} readOnly className="mt-1 bg-muted" />
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Role</label>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="default">{user.role.toUpperCase()}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {user.role === 'admin' && 'Full system access'}
                    {user.role === 'manager' && 'Management and reporting access'}
                    {user.role === 'operator' && 'Operation and tracking access'}
                    {user.role === 'viewer' && 'View-only access'}
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
                Logging out will end your current session
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

      {/* Notification Settings */}
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
                <div key={setting.id} className="flex items-start justify-between rounded-lg border border-border p-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-0.5 text-primary">{setting.icon}</div>
                    <div>
                      <p className="font-medium text-foreground">{setting.label}</p>
                      <p className="text-xs text-muted-foreground">{setting.description}</p>
                    </div>
                  </div>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={notificationSettings[setting.id as keyof typeof notificationSettings]}
                      onChange={(e) =>
                        setNotificationSettings({
                          ...notificationSettings,
                          [setting.id]: e.target.checked,
                        })
                      }
                      className="rounded border-border"
                    />
                  </label>
                </div>
              ))}
            </CardContent>
          </Card>

          <Button className="w-full">Save Notification Settings</Button>
        </div>
      )}

      {/* Display Settings */}
      {activeTab === 'display' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Display Preferences</CardTitle>
              <CardDescription>Customize how the dashboard looks and behaves</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Theme</label>
                <select
                  value={displaySettings.theme}
                  onChange={(e) =>
                    setDisplaySettings({ ...displaySettings, theme: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground"
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="auto">Auto (System)</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-foreground">Speed Unit</label>
                <select
                  value={displaySettings.speedUnit}
                  onChange={(e) =>
                    setDisplaySettings({ ...displaySettings, speedUnit: e.target.value })
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
                    setDisplaySettings({ ...displaySettings, temperatureUnit: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground"
                >
                  <option value="C">Celsius (°C)</option>
                  <option value="F">Fahrenheit (°F)</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Button className="w-full">Save Display Settings</Button>
        </div>
      )}

      {/* Security Settings */}
      {activeTab === 'security' && (
        <div className="space-y-4">
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>Manage your account security</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Your account is currently using demo authentication. To enable full security features, please
                  set up two-factor authentication.
                </AlertDescription>
              </Alert>

              <div className="rounded-lg border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">Password</h3>
                <p className="text-sm text-muted-foreground mb-3">Last changed 3 months ago</p>
                <Button variant="outline">Change Password</Button>
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">Two-Factor Authentication</h3>
                <p className="text-sm text-muted-foreground mb-3">Add an extra layer of security to your account</p>
                <Button variant="outline">Enable 2FA</Button>
              </div>

              <div className="rounded-lg border border-border p-4">
                <h3 className="font-semibold text-foreground mb-2">Active Sessions</h3>
                <p className="text-sm text-muted-foreground mb-3">Current device: Browser on {new Date().toLocaleDateString()}</p>
                <Button variant="outline">View All Sessions</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
