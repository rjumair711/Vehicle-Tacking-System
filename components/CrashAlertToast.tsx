'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { fetchAlerts } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { Toaster } from '@/components/ui/sonner';

// Shows a toast on every dashboard page when the backend pushes a crash alert.
// The alert is looked up through /api/alerts, which gives the vehicle's name
// and leaves crash alerts out when the user switched them off in Settings.
export function CrashAlertToast() {
  const router = useRouter();

  useRealtime(async (event) => {
    if (event.type !== 'alert' || event.alertType !== 'crash') return;

    let vehicle = event.trackerId;
    let location: string | undefined;
    try {
      const at = new Date(event.timestamp).getTime();
      const alert = (await fetchAlerts()).find(
        (a) => a.type === 'crash' && a.trackerId === event.trackerId && a.timestamp.getTime() === at
      );
      if (!alert) return; // crash alerts are switched off for this user
      vehicle = alert.trackerName ?? vehicle;
      if (alert.location) {
        location = `${alert.location.lat.toFixed(5)}, ${alert.location.lng.toFixed(5)}`;
      }
    } catch {
      // The lookup failed: still warn, with what the push itself carries.
    }

    toast.error(`Crash detected: ${vehicle}`, {
      id: `crash-${event.trackerId}-${event.timestamp}`,
      description: [new Date(event.timestamp).toLocaleTimeString(), location].filter(Boolean).join(' · '),
      duration: Infinity,
      action: { label: 'View', onClick: () => router.push('/dashboard/alerts') },
    });
  });

  return <Toaster position="top-right" richColors closeButton />;
}
