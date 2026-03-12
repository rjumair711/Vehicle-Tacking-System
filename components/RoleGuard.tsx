'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { UserRole } from '@/types';
import { useEffect } from 'react';

interface RoleGuardProps {
  children: React.ReactNode;
  requiredRole?: UserRole | UserRole[];
}

export function RoleGuard({ children, requiredRole = 'viewer' }: RoleGuardProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    if (!user) {
      router.push('/');
      return;
    }

    if (requiredRole) {
      const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      const roleHierarchy: Record<UserRole, number> = {
        viewer: 1,
        operator: 2,
        manager: 3,
        admin: 4,
      };

      const hasAccess = roles.some((role) => roleHierarchy[user.role] >= roleHierarchy[role]);

      if (!hasAccess) {
        router.push('/dashboard');
      }
    }
  }, [user, isLoading, router, requiredRole]);

  if (isLoading || !user) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
