'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';  // Import usePathname to track the current path
import { useAuth } from '@/lib/authContext';
import {
  MapPin,
  History,
  AlertTriangle,
  Waypoints,
  Smartphone,
  Settings,
  LogOut,
  Home,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  requiredRole?: 'admin' | 'manager' | 'operator' | 'viewer';
}

const navItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <Home className="h-5 w-5" /> },
  { href: '/dashboard/map', label: 'Live Map', icon: <MapPin className="h-5 w-5" /> },
  { href: '/dashboard/trips', label: 'Trips', icon: <History className="h-5 w-5" /> },
  { href: '/dashboard/alerts', label: 'Alerts', icon: <AlertTriangle className="h-5 w-5" /> },
  { href: '/dashboard/geofences', label: 'Geofences', icon: <Waypoints className="h-5 w-5" /> },
  {
    href: '/dashboard/devices',
    label: 'Devices',
    icon: <Smartphone className="h-5 w-5" />,
    requiredRole: 'admin',
  },
];

export function Sidebar() {
  const pathname = usePathname(); // Track the current route
  const { user, logout } = useAuth();

  const visibleItems = navItems.filter((item) => {
    if (!item.requiredRole) return true;
    return user?.role === 'admin' || user?.role === 'manager';
  });

  return (
    <div className="flex h-full flex-col">
      {/* Logo Section */}
      <div className="border-b border-sidebar-border px-6 py-6">
        <h1 className="font-bold text-sidebar-foreground">FleetTrack Pro</h1>
        <p className="text-xs text-sidebar-accent-foreground">Fleet Management</p>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
{visibleItems.map((item) => {
  // Fix: Use exact match for the base Dashboard, startsWith for others
  const isActive = item.href === '/dashboard' 
    ? pathname === item.href 
    : pathname.startsWith(item.href);

  return (
    <Link
      key={item.href}
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
  );
})}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-sidebar-border space-y-2 px-3 py-4">
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