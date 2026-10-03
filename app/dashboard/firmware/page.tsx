'use client';

import React, { useRef, useState } from 'react';
import AdminPageGuard from '@/components/AdminPageGuard';
import { apiFetch, useApiData } from '@/lib/api';
import { FirmwareRelease } from '@/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Upload } from 'lucide-react';

async function fetchReleases(): Promise<FirmwareRelease[]> {
  const data = await apiFetch('/api/firmware');
  return (data.releases ?? []).map((r: any) => ({ ...r, uploadedAt: new Date(r.uploadedAt) }));
}

export default function FirmwarePage() {
  const { data: releases, loading, error, refresh } = useApiData<FirmwareRelease[]>(fetchReleases, []);

  const fileInput = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [message, setMessage] = useState('');
  const [canForce, setCanForce] = useState(false);

  const upload = async (force: boolean) => {
    const file = fileInput.current?.files?.[0];
    setUploadError('');
    setMessage('');
    setCanForce(false);

    if (!file || !version.trim()) {
      setUploadError('Choose the .bin file and enter its version.');
      return;
    }

    try {
      setIsUploading(true);

      const query = `version=${encodeURIComponent(version.trim())}${force ? '&force=1' : ''}`;
      const data = await apiFetch(`/api/firmware?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });

      setMessage(`Uploaded ${data.filename} (${data.size.toLocaleString()} bytes).`);
      setVersion('');
      if (fileInput.current) fileInput.current.value = '';
      refresh();
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed');
      setCanForce(err?.code === 'VERSION_NOT_IN_IMAGE');
    } finally {
      setIsUploading(false);
    }
  };

  const remove = async (release: FirmwareRelease) => {
    if (!window.confirm(`Delete firmware ${release.version}?`)) return;

    try {
      setUploadError('');
      await apiFetch(`/api/firmware?version=${encodeURIComponent(release.version)}`, {
        method: 'DELETE',
      });
      refresh();
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to delete firmware');
    }
  };

  return (
    <AdminPageGuard>
      <div className="space-y-6 p-4 sm:p-6 max-w-4xl">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Firmware Updates</h1>
          <p className="mt-2 text-muted-foreground">
            Over-the-air (OTA) updates for the trackers
          </p>
        </div>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Upload Firmware</CardTitle>
            <CardDescription>
              Every tracker checks for an update each minute and installs the highest version
              here if it is newer than its own. It installs only while parked, with good
              signal and no unsent records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {uploadError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {uploadError}
              </div>
            )}
            {message && (
              <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-foreground">
                {message}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="firmwareVersion">Firmware Version</Label>
              <Input
                id="firmwareVersion"
                placeholder="e.g. 3.6.3"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Must equal FW_VERSION in the sketch this file was built from, or the tracker
                reinstalls it at every check.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="firmwareFile">Firmware File (.bin)</Label>
              <Input id="firmwareFile" type="file" accept=".bin" ref={fileInput} />
              <p className="text-xs text-muted-foreground">
                Use &lt;sketch&gt;.ino.bin from Sketch → Export Compiled Binary. Not the
                merged, bootloader or partitions file.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => upload(false)} disabled={isUploading}>
                <Upload className="mr-2 h-4 w-4" />
                {isUploading ? 'Uploading...' : 'Upload'}
              </Button>
              {canForce && (
                <Button variant="outline" onClick={() => upload(true)} disabled={isUploading}>
                  Upload anyway
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle>Uploaded Firmware</CardTitle>
            <CardDescription>
              Trackers are offered the highest version in this list
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && <p className="text-sm text-destructive">{error}</p>}

            {!loading && !error && releases.length === 0 && (
              <p className="text-sm text-muted-foreground">No firmware uploaded yet.</p>
            )}

            <div className="space-y-3">
              {releases.map((release, index) => (
                <div
                  key={release.version}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">{release.version}</p>
                      {index === 0 && <Badge>Offered to trackers</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {release.size.toLocaleString()} bytes · uploaded{' '}
                      {release.uploadedAt.toLocaleString()}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      SHA-256 {release.sha256}
                    </p>
                  </div>

                  <Button variant="ghost" size="sm" onClick={() => remove(release)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminPageGuard>
  );
}
