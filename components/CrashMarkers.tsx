'use client';

import { useEffect, useRef } from 'react';
import { Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Alert } from '@/types';

// A warning triangle with "!" and a pulsing ring, drawn where an alert was
// recorded: red for a crash, yellow for a geofence alert.
function warningIcon(color: string, mark: string, pulse: string) {
  return L.divIcon({
    html: `
      <div class="crash-marker">
        <span class="crash-marker-pulse" style="background:${pulse}"></span>
        <svg width="24" height="21" viewBox="0 0 34 30" aria-hidden="true">
          <path d="M17 2 L32 28 L2 28 Z" fill="${color}" stroke="#ffffff"
            stroke-width="2.5" stroke-linejoin="round" />
          <rect x="15.5" y="10" width="3" height="10" rx="1.5" fill="${mark}" />
          <circle cx="17" cy="23.8" r="1.8" fill="${mark}" />
        </svg>
      </div>
    `,
    className: '',
    iconSize: [24, 21],
    iconAnchor: [12, 20],
    popupAnchor: [0, -18],
  });
}

const crashIcon = warningIcon('#dc2626', '#ffffff', 'rgba(220, 38, 38, 0.35)');
// Dark "!" on yellow, like a road warning sign: white would not show.
const geofenceIcon = warningIcon('#facc15', '#1f2937', 'rgba(234, 179, 8, 0.4)');

function AlertMarker({ alert, focused }: { alert: Alert; focused: boolean }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const lat = alert.location!.lat;
  const lng = alert.location!.lng;
  const isCrash = alert.type === 'crash';

  // "See on Map": zoom to this alert and open its details.
  useEffect(() => {
    if (!focused) return;
    map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true });
    const timer = setTimeout(() => markerRef.current?.openPopup(), 300);
    return () => clearTimeout(timer);
  }, [focused, lat, lng, map]);

  return (
    <Marker
      ref={markerRef}
      position={[lat, lng]}
      icon={isCrash ? crashIcon : geofenceIcon}
      zIndexOffset={focused ? 2000 : 1000}
    >
      <Popup>
        <div className="space-y-1">
          <div className={`font-semibold ${isCrash ? 'text-red-600' : 'text-yellow-600'}`}>
            {isCrash ? 'Crash detected' : 'Geofence alert'}
          </div>
          <div className="text-xs font-medium">{alert.trackerName ?? alert.trackerId}</div>
          {!isCrash && <div className="text-xs">{alert.message}</div>}
          <div className="text-xs">{alert.timestamp.toLocaleString()}</div>
          {alert.speed != null && (
            <div className="text-xs">Speed: {alert.speed.toFixed(0)} km/h</div>
          )}
          <div className="text-xs">
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </div>
          <div className="text-xs">{alert.isResolved ? 'Resolved' : 'Not resolved yet'}</div>
          <a href="/dashboard/alerts" className="text-xs font-semibold underline">
            Open alerts
          </a>
        </div>
      </Popup>
    </Marker>
  );
}

// One marker per alert that has a recorded position. The alert whose id is
// focusedAlertId is zoomed to and opened.
export default function CrashMarkers({
  alerts,
  focusedAlertId,
}: {
  alerts: Alert[];
  focusedAlertId?: string;
}) {
  return (
    <>
      {alerts
        .filter((alert) => alert.location)
        .map((alert) => (
          <AlertMarker key={alert.id} alert={alert} focused={alert.id === focusedAlertId} />
        ))}
    </>
  );
}
