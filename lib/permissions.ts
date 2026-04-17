export const permissions = {
  dashboard: ['ADMIN', 'USER'],
  map: ['ADMIN', 'USER'],
  trips: ['ADMIN', 'USER'],
  alerts: ['ADMIN', 'USER'],
  geofences: ['ADMIN'],
  devices: ['ADMIN'],
  customers: ['ADMIN'],
  settings: ['ADMIN', 'USER'],
} as const;