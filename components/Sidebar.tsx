'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import RoleGuard from '@/components/RoleGuard';
import { permissions } from '@/lib/permissions';

import {
  MapPin,
  History,
  AlertTriangle,
  Waypoints,
  Smartphone,
  Settings,
  LogOut,
  Home,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  key: keyof typeof permissions;
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <Home className="h-5 w-5" />, key: 'dashboard' },
  { href: '/dashboard/map', label: 'Live Map', icon: <MapPin className="h-5 w-5" />, key: 'map' },
  { href: '/dashboard/trips', label: 'Trips', icon: <History className="h-5 w-5" />, key: 'trips' },
  { href: '/dashboard/alerts', label: 'Alerts', icon: <AlertTriangle className="h-5 w-5" />, key: 'alerts' },
  { href: '/dashboard/geofences', label: 'Geofences', icon: <Waypoints className="h-5 w-5" />, key: 'geofences' },
  { href: '/dashboard/customers', label: 'Customers', icon: <Users className="h-5 w-5" />, key: 'customers' },
  { href: '/dashboard/devices', label: 'Devices', icon: <Smartphone className="h-5 w-5" />, key: 'devices' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="border-b border-sidebar-border px-6 py-6">
        <h1 className="font-bold text-sidebar-foreground">FleetTrack Pro</h1>
        <p className="text-xs text-sidebar-accent-foreground">Fleet Management</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === item.href
              : pathname.startsWith(item.href);

          return (
            <RoleGuard
              key={item.href}
              allowedRoles={[...permissions[item.key]]}
            >
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            </RoleGuard>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="space-y-2 border-t border-sidebar-border px-3 py-4">
        <Link
          href="/dashboard/settings"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
            pathname === '/dashboard/settings'
              ? 'bg-sidebar-primary text-sidebar-primary-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
          )}
        >
          <Settings className="h-5 w-5" />
          <span>Settings</span>
        </Link>

        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <LogOut className="h-5 w-5" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}