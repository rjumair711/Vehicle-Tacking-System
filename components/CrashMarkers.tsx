'use client';

import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import type { Alert } from '@/types';

// A red warning triangle with "!" and a pulsing ring, drawn where a crash
// was recorded.
const crashIcon = L.divIcon({
  html: `
    <div class="crash-marker">
      <span class="crash-marker-pulse"></span>
      <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true">
        <path d="M17 2 L32 28 L2 28 Z" fill="#dc2626" stroke="#ffffff"
          stroke-width="2.5" stroke-linejoin="round" />
        <rect x="15.5" y="10" width="3" height="10" rx="1.5" fill="#ffffff" />
        <circle cx="17" cy="23.8" r="1.8" fill="#ffffff" />
      </svg>
    </div>
  `,
  className: '',
  iconSize: [34, 30],
  iconAnchor: [17, 28],
  popupAnchor: [0, -26],
});

// One marker per crash alert that has a recorded position.
export default function CrashMarkers({ alerts }: { alerts: Alert[] }) {
  return (
    <>
      {alerts
        .filter((alert) => alert.type === 'crash' && alert.location)
        .map((alert) => (
          <Marker
            key={alert.id}
            position={[alert.location!.lat, alert.location!.lng]}
            icon={crashIcon}
            zIndexOffset={1000}
          >
            <Popup>
              <div className="space-y-1">
                <div className="font-semibold text-red-600">Crash detected</div>
                <div className="text-xs font-medium">
                  {alert.trackerName ?? alert.trackerId}
                </div>
                <div className="text-xs">{alert.timestamp.toLocaleString()}</div>
                {alert.speed != null && (
                  <div className="text-xs">Speed: {alert.speed.toFixed(0)} km/h</div>
                )}
                <div className="text-xs">
                  {alert.location!.lat.toFixed(5)}, {alert.location!.lng.toFixed(5)}
                </div>
                <div className="text-xs">
                  {alert.isResolved ? 'Resolved' : 'Not resolved yet'}
                </div>
                <a href="/dashboard/alerts" className="text-xs font-semibold underline">
                  Open alerts
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
    </>
  );
}
