import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Search, Loader2 } from "lucide-react";
import type { BirthProfile } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileCreated: (profile: BirthProfile) => void;
}

interface LocationResult {
  Name?: string;
  name?: string;
  Latitude?: number;
  latitude?: number;
  Longitude?: number;
  longitude?: number;
  [key: string]: any;
}

const COMMON_TIMEZONES = [
  { label: "IST (UTC+5:30)", value: "+05:30" },
  { label: "GMT (UTC+0:00)", value: "+00:00" },
  { label: "BST (UTC+1:00)", value: "+01:00" },
  { label: "EST (UTC-5:00)", value: "-05:00" },
  { label: "CST (UTC-6:00)", value: "-06:00" },
  { label: "MST (UTC-7:00)", value: "-07:00" },
  { label: "PST (UTC-8:00)", value: "-08:00" },
  { label: "CET (UTC+1:00)", value: "+01:00" },
  { label: "EET (UTC+2:00)", value: "+02:00" },
  { label: "MSK (UTC+3:00)", value: "+03:00" },
  { label: "GST (UTC+4:00)", value: "+04:00" },
  { label: "PKT (UTC+5:00)", value: "+05:00" },
  { label: "BDT (UTC+6:00)", value: "+06:00" },
  { label: "ICT (UTC+7:00)", value: "+07:00" },
  { label: "CST (UTC+8:00)", value: "+08:00" },
  { label: "JST (UTC+9:00)", value: "+09:00" },
  { label: "AEST (UTC+10:00)", value: "+10:00" },
  { label: "NZST (UTC+12:00)", value: "+12:00" },
];

export function BirthProfileDialog({ open, onOpenChange, onProfileCreated }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthTime, setBirthTime] = useState("");
  const [timezone, setTimezone] = useState("+05:30");
  const [locationName, setLocationName] = useState("");
  const [longitude, setLongitude] = useState("");
  const [latitude, setLatitude] = useState("");

  // Location search state
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Debounced location search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    if (locationQuery.length < 2) {
      setLocationResults([]);
      setShowResults(false);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await apiRequest("GET", `/api/vedastro/search-location?q=${encodeURIComponent(locationQuery)}`);
        const data = await res.json();
        const results = Array.isArray(data) ? data : [];
        setLocationResults(results);
        setShowResults(results.length > 0);
      } catch {
        setLocationResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [locationQuery]);

  // Close results dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectLocation(loc: LocationResult) {
    const locName = loc.Name || loc.name || "Unknown";
    const lat = loc.Latitude ?? loc.latitude ?? 0;
    const lng = loc.Longitude ?? loc.longitude ?? 0;
    
    setLocationName(locName);
    setLatitude(String(lat));
    setLongitude(String(lng));
    setLocationQuery(locName);
    setShowResults(false);
  }

  const createProfile = useMutation({
    mutationFn: async () => {
      // Convert date from YYYY-MM-DD to DD/MM/YYYY
      const [y, m, d] = birthDate.split("-");
      const formattedDate = `${d}/${m}/${y}`;

      const res = await apiRequest("POST", "/api/profiles", {
        name,
        birthDate: formattedDate,
        birthTime,
        timezone,
        locationName,
        longitude,
        latitude,
      });
      return res.json();
    },
    onSuccess: (data: BirthProfile) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profiles"] });
      onProfileCreated(data);
      onOpenChange(false);
      toast({ title: "Birth profile created", description: `Profile "${name}" saved successfully.` });
      // Reset
      setName("");
      setBirthDate("");
      setBirthTime("");
      setLocationName("");
      setLocationQuery("");
      setLongitude("");
      setLatitude("");
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const isValid = name && birthDate && birthTime && timezone && locationName && longitude && latitude;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Birth Profile</DialogTitle>
          <DialogDescription>
            Enter birth details for accurate Vedic astrology calculations via VedAstro.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label htmlFor="profile-name" className="text-xs">Profile Name</Label>
            <Input
              id="profile-name"
              placeholder="e.g. My Chart"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              data-testid="input-profile-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="birth-date" className="text-xs">Birth Date</Label>
              <Input
                id="birth-date"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="mt-1"
                data-testid="input-birth-date"
              />
            </div>
            <div>
              <Label htmlFor="birth-time" className="text-xs">Birth Time</Label>
              <Input
                id="birth-time"
                type="time"
                value={birthTime}
                onChange={(e) => setBirthTime(e.target.value)}
                className="mt-1"
                data-testid="input-birth-time"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="timezone" className="text-xs">Timezone</Label>
            <select
              id="timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full mt-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
              data-testid="select-timezone"
            >
              {COMMON_TIMEZONES.map(tz => (
                <option key={tz.value + tz.label} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>

          {/* Location search with auto-complete */}
          <div className="relative" ref={resultsRef}>
            <Label htmlFor="location-search" className="text-xs">Birth Place</Label>
            <div className="relative mt-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="location-search"
                placeholder="Search city... e.g. Mumbai"
                value={locationQuery}
                onChange={(e) => {
                  setLocationQuery(e.target.value);
                  if (!e.target.value) {
                    setLocationName("");
                    setLatitude("");
                    setLongitude("");
                  }
                }}
                className="pl-9 pr-8"
                data-testid="input-location-search"
              />
              {isSearching && (
                <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {/* Search results dropdown */}
            {showResults && locationResults.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {locationResults.slice(0, 8).map((loc, idx) => {
                  const locName = loc.Name || loc.name || "Unknown";
                  const lat = loc.Latitude ?? loc.latitude ?? 0;
                  const lng = loc.Longitude ?? loc.longitude ?? 0;
                  return (
                    <button
                      key={`${locName}-${idx}`}
                      type="button"
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                      onClick={() => selectLocation(loc)}
                      data-testid={`location-result-${idx}`}
                    >
                      <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <span className="block truncate">{locName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {Number(lat).toFixed(2)}°, {Number(lng).toFixed(2)}°
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Show selected location info */}
            {locationName && latitude && longitude && (
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <MapPin className="h-3 w-3" />
                <span>{locationName} — {Number(latitude).toFixed(4)}°, {Number(longitude).toFixed(4)}°</span>
              </div>
            )}
          </div>

          {/* Manual coordinate override */}
          {!locationName && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="longitude" className="text-xs">Longitude (manual)</Label>
                <Input
                  id="longitude"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 72.88"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  className="mt-1"
                  data-testid="input-longitude"
                />
              </div>
              <div>
                <Label htmlFor="latitude" className="text-xs">Latitude (manual)</Label>
                <Input
                  id="latitude"
                  type="number"
                  step="0.01"
                  placeholder="e.g. 19.08"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  className="mt-1"
                  data-testid="input-latitude"
                />
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Type a city name to auto-search locations via VedAstro. Coordinates are filled automatically.
          </p>

          <Button
            onClick={() => createProfile.mutate()}
            disabled={!isValid || createProfile.isPending}
            className="w-full"
            data-testid="button-save-profile"
          >
            {createProfile.isPending ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
