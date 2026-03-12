'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole, AuthContextType } from '@/types';
import { mockUsers } from './mockData';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_CREDENTIALS = {
  'admin@fleettrack.com': 'admin123',
  'manager@fleettrack.com': 'manager123',
  'operator@fleettrack.com': 'operator123',
  'viewer@fleettrack.com': 'viewer123',
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize from localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (error) {
        console.error('Failed to parse saved user:', error);
      }
    }
    setIsLoading(false);
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check credentials
      const credentialKey = Object.keys(DEMO_CREDENTIALS).find(
        (key) => key === email && DEMO_CREDENTIALS[key as keyof typeof DEMO_CREDENTIALS] === password
      );

      if (credentialKey) {
        const userKey = email.split('@')[0] as keyof typeof mockUsers;
        const userData = mockUsers[userKey];

        if (userData) {
          setUser(userData);
          localStorage.setItem('currentUser', JSON.stringify(userData));
          return;
        }
      }

      throw new Error('Invalid credentials');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('currentUser');
  };

  const checkPermission = (requiredRole: UserRole): boolean => {
    if (!user) return false;

    const roleHierarchy: Record<UserRole, number> = {
      admin: 4,
      manager: 3,
      operator: 2,
      viewer: 1,
    };

    return roleHierarchy[user.role] >= roleHierarchy[requiredRole];
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, checkPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
