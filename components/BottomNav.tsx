'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MapPin,
  History,
  AlertTriangle,
  Waypoints,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { href: '/dashboard/map', label: 'Map', icon: <MapPin className="h-5 w-5" /> },
  { href: '/dashboard/trips', label: 'Trips', icon: <History className="h-5 w-5" /> },
  { href: '/dashboard/alerts', label: 'Alerts', icon: <AlertTriangle className="h-5 w-5" /> },
  { href: '/dashboard/geofences', label: 'Geo', icon: <Waypoints className="h-5 w-5" /> },
  { href: '/dashboard/settings', label: 'Settings', icon: <Settings className="h-5 w-5" /> },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-around">
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center gap-1 px-4 py-3 text-xs font-medium transition-colors',
              isActive
                ? 'text-sidebar-primary'
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground'
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
