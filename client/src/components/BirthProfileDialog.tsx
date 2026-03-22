import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { BirthProfile } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProfileCreated: (profile: BirthProfile) => void;
}

const COMMON_TIMEZONES = [
  { label: "IST (UTC+5:30)", value: "+05:30" },
  { label: "GMT (UTC+0:00)", value: "+00:00" },
  { label: "EST (UTC-5:00)", value: "-05:00" },
  { label: "CST (UTC-6:00)", value: "-06:00" },
  { label: "PST (UTC-8:00)", value: "-08:00" },
  { label: "CET (UTC+1:00)", value: "+01:00" },
  { label: "JST (UTC+9:00)", value: "+09:00" },
  { label: "AEST (UTC+10:00)", value: "+10:00" },
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
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="location-name" className="text-xs">Birth Place</Label>
            <Input
              id="location-name"
              placeholder="e.g. Mumbai, India"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              className="mt-1"
              data-testid="input-location-name"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="longitude" className="text-xs">Longitude</Label>
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
              <Label htmlFor="latitude" className="text-xs">Latitude</Label>
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

          <p className="text-xs text-muted-foreground">
            Tip: Look up coordinates for your birth city on Google Maps. Right-click a location to copy lat/long.
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
