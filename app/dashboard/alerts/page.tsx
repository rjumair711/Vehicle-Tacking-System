'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/authContext';
import { LIVE_REFRESH_MS, apiFetch, fetchAlerts, useApiData } from '@/lib/api';
import { useRealtime } from '@/lib/realtime';
import { Alert as AlertType } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertTriangle, CheckCircle, MapPin, Clock } from 'lucide-react';

export default function AlertsPage() {
  const { user, isLoading } = useAuth();
  const { data: alerts, setData: setAlerts, loading, error, refresh } = useApiData<AlertType[]>(fetchAlerts, [], LIVE_REFRESH_MS);
  const [trackerFilter, setTrackerFilter] = useState('all');

  // A new crash or geofence alert shows up at once.
  useRealtime((event) => {
    if (event.type === 'alert') refresh();
  });
  const [actionError, setActionError] = useState('');
  const [selectedAlert, setSelectedAlert] = useState<AlertType | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      window.location.href = "/";
    }
  }, [isLoading, user]);

  if (isLoading || !user) return null;

  const getAlertIcon = (type: AlertType['type']) => {
    switch (type) {
      case 'geofence':
        return <MapPin className="h-5 w-5" />;
      default:
        return <AlertTriangle className="h-5 w-5" />;
    }
  };

  const getPriorityColor = (priority: AlertType['priority']) => {
    switch (priority) {
      case 'critical':
        return 'destructive';
      case 'medium':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  // Trackers that have at least one alert, for the filter.
  const alertTrackers = Array.from(
    new Map(alerts.map((a) => [a.trackerId, a.trackerName ?? a.trackerId])).entries()
  );
  const visibleAlerts =
    trackerFilter === 'all' ? alerts : alerts.filter((a) => a.trackerId === trackerFilter);

  const unresolved = visibleAlerts.filter((a) => !a.isResolved);
  const resolved = visibleAlerts.filter((a) => a.isResolved);

  const handleResolveAlert = async (alertId: string) => {
    try {
      setActionError('');
      await apiFetch(`/api/alerts/${alertId}`, { method: 'PATCH' });

      setAlerts((prev) =>
        prev.map((alert) =>
          alert.id === alertId
            ? {
              ...alert,
              isResolved: true,
              resolvedAt: new Date(),
              resolvedBy: user?.email,
            }
            : alert
        )
      );
    } catch (err: any) {
      setActionError(err?.message || 'Failed to resolve alert');
      refresh();
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Alerts</h1>
        <p className="mt-2 text-muted-foreground">Vehicle incidents and notifications</p>
      </div>

      {(error || actionError) && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error || actionError}
        </div>
      )}

      {!loading && !error && alerts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No alerts. Crash and geofence alerts from your trackers appear here.
        </p>
      )}

      {alertTrackers.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor="trackerFilter" className="text-sm text-muted-foreground">
            Vehicle
          </label>
          <select
            id="trackerFilter"
            value={trackerFilter}
            onChange={(e) => setTrackerFilter(e.target.value)}
            className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
          >
            <option value="all">All vehicles</option>
            {alertTrackers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{unresolved.length}</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Resolved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-foreground">{resolved.length}</p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Critical</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">
              {unresolved.filter((a) => a.priority === 'critical').length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Active Alerts */}
      {unresolved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Unresolved Alerts</h2>
          {unresolved.map((alert) => (
            <button
              key={alert.id}
              onClick={() => {
                setSelectedAlert(alert);
                setIsSheetOpen(true);
              }}
              className="w-full text-left rounded-lg border border-destructive/20 bg-destructive/5 hover:bg-destructive/10 transition-colors p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <div className="mt-0.5 text-destructive">{getAlertIcon(alert.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground">{alert.trackerName}</p>
                      <Badge variant={getPriorityColor(alert.priority)} className="text-xs">
                        {alert.priority.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                    {alert.location && (
                      <p className="text-xs text-muted-foreground mt-1 font-mono">
                        {alert.location.lat.toFixed(4)}, {alert.location.lng.toFixed(4)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="secondary" className="text-xs">
                    {alert.type.toUpperCase()}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    {alert.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Resolved Alerts */}
      {resolved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Resolved Alerts</h2>
          <div className="space-y-2">
            {resolved.map((alert) => (
              <button
                key={alert.id}
                onClick={() => {
                  setSelectedAlert(alert);
                  setIsSheetOpen(true);
                }}
                className="w-full text-left rounded-lg border border-border bg-muted/50 hover:bg-muted transition-colors p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-foreground line-through">{alert.trackerName}</p>
                    <p className="text-xs text-muted-foreground">{alert.message}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    RESOLVED
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Alert Details Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent
          side="bottom"
          className="h-[80vh] max-h-[80vh] sm:max-w-2xl mx-auto overflow-hidden"
        >
          {selectedAlert ? (
            <div className="flex h-full flex-col">
              <SheetHeader className="shrink-0 pr-12">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <SheetTitle className="pr-2">{selectedAlert.trackerName}</SheetTitle>
                    <SheetDescription>{selectedAlert.message}</SheetDescription>
                  </div>

                  <Badge
                    variant={getPriorityColor(selectedAlert.priority)}
                    className="shrink-0"
                  >
                    {selectedAlert.priority.toUpperCase()}
                  </Badge>
                </div>
              </SheetHeader>

              <div className="mt-6 flex-1 overflow-y-auto space-y-4 pb-10 px-4">
                <div className="space-y-4">
                  {/* Alert Type */}
                  <Card className="border-border bg-muted/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Alert Type</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Badge>{selectedAlert.type.toUpperCase()}</Badge>
                    </CardContent>
                  </Card>

                  {/* Time */}
                  <Card className="border-border bg-muted/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Time
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-foreground">
                      {selectedAlert.timestamp.toLocaleString()}
                    </CardContent>
                  </Card>

                  {/* Location */}
                  {selectedAlert.location && (
                    <Card className="border-border bg-muted/50">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          Location
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="text-foreground font-mono text-sm break-words">
                        {selectedAlert.location.lat.toFixed(6)},{" "}
                        {selectedAlert.location.lng.toFixed(6)}
                      </CardContent>
                    </Card>
                  )}

                  {/* Status and Resolution */}
                  {selectedAlert.isResolved ? (
                    <Card className="border-green-500/20 bg-green-500/5">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <CheckCircle className="h-4 w-4 text-green-500" />
                          Resolved
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1 text-sm">
                          <p className="text-foreground">
                            Resolved by:{" "}
                            <span className="font-mono">{selectedAlert.resolvedBy}</span>
                          </p>
                          <p className="text-muted-foreground">
                            {selectedAlert.resolvedAt?.toLocaleString()}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Button
                      onClick={() => {
                        handleResolveAlert(selectedAlert.id);
                        setIsSheetOpen(false);
                      }}
                      className="w-full"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Resolve Alert
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
