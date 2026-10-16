"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { Geofence } from "@/types";
import { midpoint, selfIntersects, type LatLng } from "@/lib/polygon";

type Point = LatLng;

interface GeofenceMapProps {
  /** Saved zones, drawn for reference. */
  geofences: Geofence[];
  /** Corners of the zone being drawn or edited. Leave undefined for a view-only map. */
  drawing?: Point[];
  /** True once the outline is finished: clicks on the map no longer add corners. */
  closed?: boolean;
  drawingColor?: string;
  /** Called once per edit (add, move, insert, delete, finish) with the new shape. */
  onDrawingChange?: (points: Point[], closed: boolean) => void;
  /** Where to centre when there is nothing to show yet (e.g. the tracker's position). */
  fallbackCenter?: Point;
}

const CROSSING_COLOR = "#ef4444";
const LONG_PRESS_MS = 600;

// Re-measures the map whenever its box changes size, e.g. while a sheet's
// open animation is still running, so it never keeps grey tiles.
function FixMapSize() {
  const map = useMap();

  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

// Fits the map once to what is already there: the zone being edited, else
// the saved zones, else the fallback position.
function InitialView({
  geofences,
  drawing,
  fallbackCenter,
}: Pick<GeofenceMapProps, "geofences" | "drawing" | "fallbackCenter">) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;

    const points =
      drawing && drawing.length > 0 ? drawing : geofences.flatMap((g) => g.points);

    if (points.length > 0) {
      done.current = true;
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), {
        padding: [40, 40],
        maxZoom: 16,
      });
    } else if (fallbackCenter) {
      done.current = true;
      map.setView([fallbackCenter.lat, fallbackCenter.lng], 14);
    }
  }, [map, geofences, drawing, fallbackCenter]);

  return null;
}

// A round handle; the transparent box around the dot is the touch target.
function handleIcon(color: string, dot: number, opacity = 1) {
  const box = dot + 14;
  return L.divIcon({
    className: "",
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html:
      `<div style="display:flex;align-items:center;justify-content:center;width:${box}px;height:${box}px;cursor:grab">` +
      `<div style="width:${dot}px;height:${dot}px;border-radius:50%;background:${color};opacity:${opacity};` +
      `border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.6)"></div></div>`,
  });
}

/** A handle being dragged: a corner (moved in place) or an edge midpoint (a corner being inserted). */
type Drag = { index: number; insert: boolean; pos: Point; anchor: [number, number] };

interface ShapeEditorProps {
  points: Point[];
  closed: boolean;
  color: string;
  onChange: (points: Point[], closed: boolean) => void;
}

function ShapeEditor({ points, closed, color, onChange }: ShapeEditorProps) {
  const map = useMap();
  const [drag, setDrag] = useState<Drag | null>(null);
  const lastDragEnd = useRef(0);
  // The corner placed by the last map click: a double-click on empty map
  // lands its second half on that new corner, which must not delete it.
  const lastAdded = useRef({ index: -1, at: 0 });

  // Leaflet handlers live longer than one render; they read the current shape here.
  const latest = useRef({ points, closed, onChange });
  latest.current = { points, closed, onChange };

  // Stable icon objects: a new icon mid-drag would replace the element being dragged.
  const icons = useMemo(
    () => ({
      corner: handleIcon(color, 14),
      finish: handleIcon(color, 20),
      edge: handleIcon(color, 10, 0.55),
    }),
    [color]
  );

  // The shape as shown, including a drag in progress (committed on drag end).
  const shown = useMemo(() => {
    if (!drag) return points;
    if (drag.insert) return [...points.slice(0, drag.index), drag.pos, ...points.slice(drag.index)];
    return points.map((p, i) => (i === drag.index ? drag.pos : p));
  }, [points, drag]);

  // Empty-map clicks add a corner only while a new outline is being drawn.
  useMapEvents({
    click: (event) => {
      const { points, closed, onChange } = latest.current;
      if (closed || Date.now() - lastDragEnd.current < 400) return;

      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      const last = points[points.length - 1];
      if (last && last.lat === point.lat && last.lng === point.lng) return; // double-click
      lastAdded.current = { index: points.length, at: Date.now() };
      onChange([...points, point], false);
    },
  });

  const removeCorner = (index: number) => {
    const { points, closed, onChange } = latest.current;
    if (closed && points.length <= 3) return; // a zone keeps at least 3 corners
    onChange(points.filter((_, i) => i !== index), closed);
  };

  const dragHandlers = (index: number, insert: boolean) => ({
    dragstart: (e: L.LeafletEvent) => {
      map.dragging.disable();
      const ll = (e.target as L.Marker).getLatLng();
      setDrag({ index, insert, pos: { lat: ll.lat, lng: ll.lng }, anchor: [ll.lat, ll.lng] });
    },
    drag: (e: L.LeafletEvent) => {
      const ll = (e.target as L.Marker).getLatLng();
      setDrag((d) => d && { ...d, pos: { lat: ll.lat, lng: ll.lng } });
    },
    dragend: (e: L.LeafletEvent) => {
      map.dragging.enable();
      lastDragEnd.current = Date.now();
      const ll = (e.target as L.Marker).getLatLng();
      const pos = { lat: ll.lat, lng: ll.lng };
      const { points, closed, onChange } = latest.current;

      setDrag(null);
      onChange(
        insert
          ? [...points.slice(0, index), pos, ...points.slice(index)]
          : points.map((p, i) => (i === index ? pos : p)),
        closed
      );
    },
  });

  // Touch: a long press on a corner deletes it. Android also fires a native
  // contextmenu for the same press, so each press deletes at most once.
  const press = useRef({ timer: 0, handled: false, x: 0, y: 0 });
  const corners = useRef<(L.Marker | null)[]>([]);

  const deleteOnce = (index: number) => {
    window.clearTimeout(press.current.timer);
    if (press.current.handled) return;
    press.current.handled = true;
    window.setTimeout(() => (press.current.handled = false), 400);
    removeCorner(index);
  };

  useEffect(() => {
    const container = map.getContainer();
    const cornerAt = (target: EventTarget | null) =>
      corners.current.findIndex((m) => !!m && !!m.getElement()?.contains(target as Node));

    const onStart = (t: TouchEvent) => {
      const index = cornerAt(t.target);
      window.clearTimeout(press.current.timer);
      if (index < 0 || t.touches.length !== 1) return;
      press.current.handled = false;
      press.current.x = t.touches[0].clientX;
      press.current.y = t.touches[0].clientY;
      press.current.timer = window.setTimeout(() => deleteOnce(index), LONG_PRESS_MS);
    };
    const onMove = (t: TouchEvent) => {
      const dx = t.touches[0].clientX - press.current.x;
      const dy = t.touches[0].clientY - press.current.y;
      if (dx * dx + dy * dy > 100) window.clearTimeout(press.current.timer); // it's a drag
    };
    const onEnd = () => window.clearTimeout(press.current.timer);

    container.addEventListener("touchstart", onStart, { passive: true });
    container.addEventListener("touchmove", onMove, { passive: true });
    container.addEventListener("touchend", onEnd);
    return () => {
      container.removeEventListener("touchstart", onStart);
      container.removeEventListener("touchmove", onMove);
      container.removeEventListener("touchend", onEnd);
    };
  }, [map]);

  const cornerDeleteHandlers = (index: number) => ({
    contextmenu: (e: L.LeafletMouseEvent) => {
      L.DomEvent.preventDefault(e.originalEvent);
      deleteOnce(index);
    },
    dblclick: (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e.originalEvent);
      const added = lastAdded.current;
      if (added.index === index && Date.now() - added.at < 600) return;
      removeCorner(index);
    },
  });

  const crossing = selfIntersects(shown);
  const lineColor = crossing ? CROSSING_COLOR : color;
  const n = points.length;
  // Corner positions for the edge handles: live while a corner is dragged.
  const base = drag && !drag.insert ? shown : points;

  return (
    <>
      {shown.length >= 3 ? (
        <Polygon
          positions={shown.map((p) => [p.lat, p.lng])}
          pathOptions={{
            color: lineColor,
            weight: 3,
            fillOpacity: closed ? 0.25 : 0.1,
            dashArray: closed ? undefined : "6 6",
            interactive: false,
          }}
        />
      ) : shown.length === 2 ? (
        <Polyline
          positions={shown.map((p) => [p.lat, p.lng])}
          pathOptions={{ color: lineColor, weight: 3, interactive: false }}
        />
      ) : null}

      {/* Edge handles: drag or click one to insert a corner between its two neighbours. */}
      {closed &&
        n >= 3 &&
        points.map((_, i) => {
          const m = midpoint(base[i], base[(i + 1) % n]);
          const position: [number, number] =
            drag && drag.insert && drag.index === i + 1 ? drag.anchor : [m.lat, m.lng];
          return (
            <Marker
              key={`edge-${i}`}
              position={position}
              icon={icons.edge}
              draggable
              eventHandlers={{
                ...dragHandlers(i + 1, true),
                click: () => {
                  const { points, closed, onChange } = latest.current;
                  const m = midpoint(points[i], points[(i + 1) % points.length]);
                  onChange([...points.slice(0, i + 1), m, ...points.slice(i + 1)], closed);
                },
              }}
            />
          );
        })}

      {/* Corners: drag to move; right-click, double-click or long-press to delete. */}
      {points.map((p, i) => {
        // larger while clicking it would finish the outline (the hint below the map says so)
        const finishes = !closed && i === 0 && n >= 3;
        const moving = drag && !drag.insert && drag.index === i;
        return (
          <Marker
            key={`corner-${i}`}
            ref={(marker) => {
              corners.current[i] = marker;
            }}
            position={moving && drag ? drag.anchor : [p.lat, p.lng]}
            icon={finishes ? icons.finish : icons.corner}
            draggable
            zIndexOffset={1000}
            eventHandlers={{
              ...dragHandlers(i, false),
              ...cornerDeleteHandlers(i),
              click: () => {
                // clicking the first corner finishes a new outline
                const { points, closed, onChange } = latest.current;
                if (!closed && i === 0 && points.length >= 3) onChange(points, true);
              },
            }}
          />
        );
      })}
    </>
  );
}

export function GeofenceMap({
  geofences,
  drawing,
  closed = false,
  drawingColor = "#3b82f6",
  onDrawingChange,
  fallbackCenter,
}: GeofenceMapProps) {
  const center: [number, number] = [33.6844, 73.0479]; // Islamabad default
  const isDrawing = drawing !== undefined && onDrawingChange !== undefined;

  return (
    <div className="h-full w-full">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom
        doubleClickZoom={!isDrawing}
        className="h-full w-full"
      >
        <FixMapSize />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <InitialView geofences={geofences} drawing={drawing} fallbackCenter={fallbackCenter} />

        {geofences.map((geofence) => (
          <Polygon
            key={geofence.id}
            positions={geofence.points.map((p) => [p.lat, p.lng])}
            pathOptions={{
              color: geofence.color,
              weight: 2,
              fillOpacity: isDrawing ? 0.08 : 0.2,
              // let clicks through to the map while a zone is drawn
              interactive: !isDrawing,
            }}
          >
            {!isDrawing && <Tooltip sticky>{geofence.name}</Tooltip>}
          </Polygon>
        ))}

        {isDrawing && (
          <ShapeEditor
            points={drawing}
            closed={closed}
            color={drawingColor}
            onChange={onDrawingChange}
          />
        )}
      </MapContainer>
    </div>
  );
}
