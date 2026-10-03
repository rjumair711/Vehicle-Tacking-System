export const permissions = {
  dashboard: ['ADMIN', 'USER'],
  map: ['ADMIN', 'USER', 'VIEWER'],
  trips: ['ADMIN', 'USER'],
  alerts: ['ADMIN', 'USER'],
  geofences: ['ADMIN', 'USER'],
  sharing: ['ADMIN', 'USER'],
  devices: ['ADMIN'],
  customers: ['ADMIN'],
  firmware: ['ADMIN'],
  settings: ['ADMIN', 'USER', 'VIEWER'],
} as const;