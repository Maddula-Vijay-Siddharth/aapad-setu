"use client";

import React, { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { Incident } from "@/lib/types";

if (typeof window !== "undefined") {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

function getTierColor(tier: string): string {
  switch (tier) {
    case "Critical":
      return "#dc2626";
    case "High":
      return "#ea580c";
    case "Moderate":
      return "#d97706";
    case "Low":
      return "#2563eb";
    default:
      return "#6b7280";
  }
}

function MapController({
  selectedIncident,
}: {
  selectedIncident: Incident | null;
}) {
  const map = useMap();
  const prevId = useRef<string | null>(null);

  useEffect(() => {
    if (
      selectedIncident &&
      selectedIncident.coordinates &&
      selectedIncident.id !== prevId.current
    ) {
      prevId.current = selectedIncident.id;
      map.flyTo(
        [selectedIncident.coordinates.lat, selectedIncident.coordinates.lng],
        15,
        { animate: true, duration: 1.2 }
      );
    }
  }, [selectedIncident, map]);

  return null;
}

function BoundsUpdater({ incidents }: { incidents: Incident[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    const valid = incidents.filter(
      (i) => i && i.coordinates && typeof i.coordinates.lat === "number" && !isNaN(i.coordinates.lat) && typeof i.coordinates.lng === "number" && !isNaN(i.coordinates.lng)
    );
    if (valid.length > 0 && !fitted.current) {
      const bounds = L.latLngBounds(
        valid.map((i) => [i.coordinates.lat, i.coordinates.lng])
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fitted.current = true;
    }
  }, [incidents, map]);

  return null;
}

function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

export default function LeafletMap({
  incidents,
  selectedIncident,
  onSelectIncident,
}: {
  incidents: Incident[];
  selectedIncident: Incident | null;
  onSelectIncident?: (incident: Incident) => void;
}) {
  const defaultCenter: [number, number] = [17.4344, 78.5013];
  const validIncidents = incidents.filter(
    (i) => i && i.coordinates && typeof i.coordinates.lat === "number" && !isNaN(i.coordinates.lat) && typeof i.coordinates.lng === "number" && !isNaN(i.coordinates.lng)
  );

  return (
    <MapContainer
      center={defaultCenter}
      zoom={12}
      className="w-full h-full z-0"
      zoomControl={false}
      style={{ background: "#f1f5f9" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />

      {validIncidents.map((incident) => {
        const color = getTierColor(incident.priorityTier);
        const isCritical = incident.priorityTier === "Critical";
        const isSelected = selectedIncident?.id === incident.id;

        return (
          <React.Fragment key={incident.id}>
            {isCritical && (
              <CircleMarker
                center={[
                  incident.coordinates.lat,
                  incident.coordinates.lng,
                ]}
                radius={16}
                pathOptions={{
                  color: color,
                  fillColor: color,
                  fillOpacity: 0.18,
                  weight: 1.5,
                  opacity: 0.5,
                }}
              />
            )}

            {isSelected && (
              <CircleMarker
                center={[
                  incident.coordinates.lat,
                  incident.coordinates.lng,
                ]}
                radius={15}
                pathOptions={{
                  color: "#2563eb",
                  fillColor: "transparent",
                  fillOpacity: 0,
                  weight: 2.5,
                  dashArray: "4 4",
                }}
              />
            )}

            <CircleMarker
              center={[
                incident.coordinates.lat,
                incident.coordinates.lng,
              ]}
              radius={isCritical ? 10 : 8}
              pathOptions={{
                color: isSelected ? "#2563eb" : "#ffffff",
                fillColor: color,
                fillOpacity: 0.9,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{
                click: () => {
                  if (onSelectIncident) {
                    onSelectIncident(incident);
                  }
                },
              }}
            >
              <Popup>
                <div className="text-xs font-sans p-0.5 min-w-[190px]">
                  <div className="font-bold text-slate-900 text-sm mb-0.5">
                    {incident.locationName}
                  </div>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="font-bold text-[11px]" style={{ color }}>
                      [{incident.priorityTier}]
                    </span>
                    <span className="text-slate-500 text-[11px]">
                      Score: {incident.urgencyScore}/100
                    </span>
                  </div>
                  <div className="text-slate-600 text-[11px] mb-0.5">
                    👥 {incident.peopleCount} person(s) &middot; {incident.status}
                  </div>
                  <div className="text-blue-700 font-medium text-[11px] mb-1">
                    🎯 {incident.recommendedDispatch}
                  </div>
                  {incident.caller?.name && (
                    <div className="text-slate-500 text-[10px] mb-1">
                      Caller: {incident.caller.name} {incident.caller.phone ? `(${incident.caller.phone})` : ""}
                    </div>
                  )}
                  {onSelectIncident && (
                    <button
                      type="button"
                      onClick={() => onSelectIncident(incident)}
                      className="w-full text-center text-[10px] bg-slate-900 hover:bg-slate-800 text-white font-medium py-1 px-2 rounded shadow-xs cursor-pointer"
                    >
                      Select Incident &rarr;
                    </button>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          </React.Fragment>
        );
      })}

      <MapController selectedIncident={selectedIncident} />
      <BoundsUpdater incidents={incidents} />
      <MapResizer />
    </MapContainer>
  );
}
