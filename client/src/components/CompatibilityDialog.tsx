import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Heart, MapPin, Search, Loader2 } from "lucide-react";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

interface PersonDetails {
  name: string;
  birthDate: string;
  birthTime: string;
  timezone: string;
  locationName: string;
  locationQuery: string;
  latitude: string;
  longitude: string;
  locationResults: LocationResult[];
  isSearching: boolean;
  showResults: boolean;
}

function emptyPerson(): PersonDetails {
  return {
    name: "",
    birthDate: "",
    birthTime: "",
    timezone: "",
    locationName: "",
    locationQuery: "",
    latitude: "",
    longitude: "",
    locationResults: [],
    isSearching: false,
    showResults: false,
  };
}

function formatDateForApi(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function isPersonValid(p: PersonDetails): boolean {
  return !!(p.name && p.birthDate && p.birthTime && p.timezone && p.locationName);
}

export function CompatibilityDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();

  const [male, setMale] = useState<PersonDetails>(emptyPerson());
  const [female, setFemale] = useState<PersonDetails>(emptyPerson());
  const [isCalculating, setIsCalculating] = useState(false);
  const [matchResult, setMatchResult] = useState<any>(null);

  const maleSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const femaleSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maleResultsRef = useRef<HTMLDivElement>(null);
  const femaleResultsRef = useRef<HTMLDivElement>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setMale(emptyPerson());
      setFemale(emptyPerson());
      setIsCalculating(false);
      setMatchResult(null);
    }
  }, [open]);

  // Debounced location search for male
  useEffect(() => {
    if (maleSearchTimeout.current) clearTimeout(maleSearchTimeout.current);
    if (male.locationQuery.length < 2) {
      setMale((prev) => ({ ...prev, locationResults: [], showResults: false }));
      return;
    }
    maleSearchTimeout.current = setTimeout(async () => {
      setMale((prev) => ({ ...prev, isSearching: true }));
      try {
        const res = await fetch(
          `${API_BASE}/api/vedastro/search-location?q=${encodeURIComponent(male.locationQuery)}`
        );
        const data = await res.json();
        const results = Array.isArray(data) ? data : [];
        setMale((prev) => ({ ...prev, locationResults: results, showResults: results.length > 0, isSearching: false }));
      } catch {
        setMale((prev) => ({ ...prev, locationResults: [], isSearching: false }));
      }
    }, 500);
    return () => { if (maleSearchTimeout.current) clearTimeout(maleSearchTimeout.current); };
  }, [male.locationQuery]);

  // Debounced location search for female
  useEffect(() => {
    if (femaleSearchTimeout.current) clearTimeout(femaleSearchTimeout.current);
    if (female.locationQuery.length < 2) {
      setFemale((prev) => ({ ...prev, locationResults: [], showResults: false }));
      return;
    }
    femaleSearchTimeout.current = setTimeout(async () => {
      setFemale((prev) => ({ ...prev, isSearching: true }));
      try {
        const res = await fetch(
          `${API_BASE}/api/vedastro/search-location?q=${encodeURIComponent(female.locationQuery)}`
        );
        const data = await res.json();
        const results = Array.isArray(data) ? data : [];
        setFemale((prev) => ({ ...prev, locationResults: results, showResults: results.length > 0, isSearching: false }));
      } catch {
        setFemale((prev) => ({ ...prev, locationResults: [], isSearching: false }));
      }
    }, 500);
    return () => { if (femaleSearchTimeout.current) clearTimeout(femaleSearchTimeout.current); };
  }, [female.locationQuery]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (maleResultsRef.current && !maleResultsRef.current.contains(e.target as Node)) {
        setMale((prev) => ({ ...prev, showResults: false }));
      }
      if (femaleResultsRef.current && !femaleResultsRef.current.contains(e.target as Node)) {
        setFemale((prev) => ({ ...prev, showResults: false }));
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function fetchTimezone(
    lat: string,
    lng: string,
    date: string,
    time: string,
    setter: typeof setMale
  ) {
    if (!date || !time) return;
    const dateFormatted = formatDateForApi(date);
    try {
      const res = await fetch(
        `${API_BASE}/api/vedastro/timezone?lat=${lat}&lng=${lng}&date=${dateFormatted}&time=${time}`
      );
      const tzData = await res.json();
      if (tzData) {
        const tz = typeof tzData === "string" ? tzData : tzData.timezone || tzData.Timezone || "";
        if (tz) {
          setter((prev) => ({ ...prev, timezone: tz }));
        }
      }
    } catch {
      // Timezone fetch failed silently; user can still proceed
    }
  }

  function selectLocation(
    loc: LocationResult,
    person: PersonDetails,
    setter: typeof setMale
  ) {
    const locName = loc.Name || loc.name || "Unknown";
    const lat = String(loc.Latitude ?? loc.latitude ?? 0);
    const lng = String(loc.Longitude ?? loc.longitude ?? 0);

    setter((prev) => ({
      ...prev,
      locationName: locName,
      latitude: lat,
      longitude: lng,
      locationQuery: locName,
      showResults: false,
    }));

    fetchTimezone(lat, lng, person.birthDate, person.birthTime, setter);
  }

  async function handleCalculate() {
    if (!isPersonValid(male) || !isPersonValid(female)) {
      toast({
        title: "Missing details",
        description: "Please fill in all birth details for both partners.",
        variant: "destructive",
      });
      return;
    }

    setIsCalculating(true);
    setMatchResult(null);

    try {
      const res = await apiRequest("POST", "/api/vedastro/match", {
        male: {
          birthTime: male.birthTime,
          birthDate: formatDateForApi(male.birthDate),
          timezone: male.timezone,
          locationName: male.locationName,
        },
        female: {
          birthTime: female.birthTime,
          birthDate: formatDateForApi(female.birthDate),
          timezone: female.timezone,
          locationName: female.locationName,
        },
      });
      const data = await res.json();
      setMatchResult(data);
      toast({
        title: "Compatibility calculated",
        description: "Kundali matching results are ready.",
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e.message || "Failed to calculate compatibility.",
        variant: "destructive",
      });
    } finally {
      setIsCalculating(false);
    }
  }

  function updatePerson(setter: typeof setMale, field: keyof PersonDetails, value: string) {
    setter((prev) => {
      const updated = { ...prev, [field]: value };
      if (field === "locationQuery" && !value) {
        updated.locationName = "";
        updated.latitude = "";
        updated.longitude = "";
        updated.timezone = "";
      }
      return updated;
    });
  }

  function renderPersonForm(
    label: string,
    person: PersonDetails,
    setter: typeof setMale,
    resultsRef: typeof maleResultsRef,
    prefix: string
  ) {
    return (
      <div className="space-y-3 flex-1 min-w-0">
        <h3 className="text-sm font-semibold">{label}</h3>

        <div>
          <Label htmlFor={`${prefix}-name`} className="text-xs">Name</Label>
          <Input
            id={`${prefix}-name`}
            placeholder="Full name"
            value={person.name}
            onChange={(e) => updatePerson(setter, "name", e.target.value)}
            className="mt-1"
            data-testid={`input-${prefix}-name`}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`${prefix}-date`} className="text-xs">Birth Date</Label>
            <Input
              id={`${prefix}-date`}
              type="date"
              value={person.birthDate}
              onChange={(e) => {
                updatePerson(setter, "birthDate", e.target.value);
                if (person.latitude && person.longitude && person.birthTime) {
                  fetchTimezone(person.latitude, person.longitude, e.target.value, person.birthTime, setter);
                }
              }}
              className="mt-1"
              data-testid={`input-${prefix}-date`}
            />
          </div>
          <div>
            <Label htmlFor={`${prefix}-time`} className="text-xs">Birth Time</Label>
            <Input
              id={`${prefix}-time`}
              type="time"
              value={person.birthTime}
              onChange={(e) => {
                updatePerson(setter, "birthTime", e.target.value);
                if (person.latitude && person.longitude && person.birthDate) {
                  fetchTimezone(person.latitude, person.longitude, person.birthDate, e.target.value, setter);
                }
              }}
              className="mt-1"
              data-testid={`input-${prefix}-time`}
            />
          </div>
        </div>

        {/* Location search */}
        <div className="relative" ref={resultsRef}>
          <Label htmlFor={`${prefix}-location`} className="text-xs">Birth Place</Label>
          <div className="relative mt-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id={`${prefix}-location`}
              placeholder="Search city..."
              value={person.locationQuery}
              onChange={(e) => updatePerson(setter, "locationQuery", e.target.value)}
              className="pl-9 pr-8"
              data-testid={`input-${prefix}-location`}
            />
            {person.isSearching && (
              <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {person.showResults && person.locationResults.length > 0 && (
            <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
              {person.locationResults.slice(0, 8).map((loc, idx) => {
                const locName = loc.Name || loc.name || "Unknown";
                const lat = loc.Latitude ?? loc.latitude ?? 0;
                const lng = loc.Longitude ?? loc.longitude ?? 0;
                return (
                  <button
                    key={`${locName}-${idx}`}
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
                    onClick={() => selectLocation(loc, person, setter)}
                    data-testid={`${prefix}-location-result-${idx}`}
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

          {person.locationName && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <MapPin className="h-3 w-3" />
              <span>
                {person.locationName}
                {person.timezone && ` — TZ: ${person.timezone}`}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderMatchResults() {
    if (!matchResult) return null;

    // Extract relevant data from the match result
    const report = matchResult.report || matchResult.Report || matchResult;
    const kutas = report.KutaScore || report.kutaScore || report.score || null;
    const details = report.Details || report.details || report.predictions || report.Predictions || [];
    const summary = report.Summary || report.summary || report.description || "";

    // Try to extract a numeric score
    let totalScore: number | null = null;
    let maxScore: number | null = null;
    if (kutas && typeof kutas === "object") {
      totalScore = kutas.Total ?? kutas.total ?? null;
      maxScore = kutas.Max ?? kutas.max ?? 36;
    } else if (typeof kutas === "number") {
      totalScore = kutas;
      maxScore = 36;
    }

    function getScoreBadgeVariant(score: number, max: number): "default" | "secondary" | "destructive" | "outline" {
      const pct = (score / max) * 100;
      if (pct >= 60) return "default";
      if (pct >= 40) return "secondary";
      return "destructive";
    }

    function renderValue(val: any): string {
      if (val === null || val === undefined) return "—";
      if (typeof val === "boolean") return val ? "Yes" : "No";
      if (typeof val === "object") return JSON.stringify(val, null, 2);
      return String(val);
    }

    // Normalize details into an array of sections
    const sections: { name: string; value: any; description?: string }[] = [];
    if (Array.isArray(details)) {
      details.forEach((item: any) => {
        sections.push({
          name: item.Name || item.name || item.kuta || "Section",
          value: item.Score ?? item.score ?? item.Value ?? item.value ?? item.Result ?? item.result ?? "—",
          description: item.Description || item.description || item.Info || item.info || "",
        });
      });
    } else if (typeof details === "object" && details !== null) {
      Object.entries(details).forEach(([key, val]: [string, any]) => {
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
          sections.push({
            name: key,
            value: val.Score ?? val.score ?? val.Value ?? val.value ?? "—",
            description: val.Description ?? val.description ?? "",
          });
        } else {
          sections.push({ name: key, value: val });
        }
      });
    }

    // If no structured sections, render the whole result as key-value pairs
    if (sections.length === 0 && typeof report === "object") {
      Object.entries(report).forEach(([key, val]) => {
        if (key === "KutaScore" || key === "kutaScore" || key === "score") return;
        if (key === "Summary" || key === "summary" || key === "description") return;
        sections.push({ name: key, value: val });
      });
    }

    return (
      <div className="mt-4 rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-pink-500" />
          <h3 className="text-base font-semibold">Compatibility Results</h3>
          {totalScore !== null && maxScore !== null && (
            <Badge
              variant={getScoreBadgeVariant(totalScore, maxScore)}
              className="ml-auto text-sm"
              data-testid="badge-total-score"
            >
              {totalScore} / {maxScore}
            </Badge>
          )}
        </div>

        {summary && (
          <p className="text-sm text-muted-foreground">{String(summary)}</p>
        )}

        {totalScore !== null && maxScore !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Overall Score</span>
              <span>{Math.round((totalScore / maxScore) * 100)}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all bg-gradient-to-r from-pink-500 to-rose-500"
                style={{ width: `${Math.min(100, (totalScore / maxScore) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {sections.length > 0 && (
          <ScrollArea className="max-h-64" data-testid="match-results-scroll">
            <div className="space-y-3">
              {sections.map((section, idx) => (
                <div key={`${section.name}-${idx}`} className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{section.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {typeof section.value === "object"
                        ? ""
                        : renderValue(section.value)}
                    </span>
                  </div>
                  {section.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{String(section.description)}</p>
                  )}
                  {typeof section.value === "object" && section.value !== null && (
                    <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-words">
                      {JSON.stringify(section.value, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Fallback: render raw JSON if nothing else matched */}
        {sections.length === 0 && !summary && (
          <ScrollArea className="max-h-64">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
              {JSON.stringify(matchResult, null, 2)}
            </pre>
          </ScrollArea>
        )}
      </div>
    );
  }

  const canCalculate = isPersonValid(male) && isPersonValid(female) && !isCalculating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-pink-500" />
            Kundali Matching / Compatibility Analysis
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <p className="text-xs text-muted-foreground">
            Enter birth details for both partners to calculate Vedic compatibility (Ashtakoot Guna Milan).
          </p>

          {/* Two partner forms side by side */}
          <div className="flex flex-col sm:flex-row gap-4">
            {renderPersonForm("Male Partner", male, setMale, maleResultsRef, "male")}
            <div className="hidden sm:block w-px bg-border" />
            {renderPersonForm("Female Partner", female, setFemale, femaleResultsRef, "female")}
          </div>

          <Button
            onClick={handleCalculate}
            disabled={!canCalculate}
            className="w-full"
            data-testid="button-calculate-compatibility"
          >
            {isCalculating ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Calculating...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Heart className="h-4 w-4" />
                Calculate Compatibility
              </span>
            )}
          </Button>

          {renderMatchResults()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
