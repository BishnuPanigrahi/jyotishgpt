import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { Anthropic } from "@anthropic-ai/sdk";
import multer from "multer";
import pdfParse from "pdf-parse";
import {
  insertBirthProfileSchema,
  insertConversationSchema,
} from "@shared/schema";

// Multer config for file uploads (in-memory, 20MB limit)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// VedAstro API base URL (api.vedastro.org is the primary, reliable endpoint)
const VEDASTRO_API = "https://api.vedastro.org/api";

// Anthropic model — use env var or default to claude-sonnet-4-6
const LLM_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";

function getVisitorId(req: Request): string {
  return req.headers["x-visitor-id"] as string || "default-visitor";
}

// Simple in-memory cache for VedAstro API responses
// Birth chart data is immutable (same birth = same chart), so we cache aggressively.
// Transit data is cached for 1 hour (planetary transits don't change that fast).
const vedAstroCache = new Map<string, { data: any; timestamp: number }>();
const NATAL_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours for natal data
const TRANSIT_CACHE_TTL = 60 * 60 * 1000;     // 1 hour for transit data

function getCached(key: string, ttl: number): any | null {
  const entry = vedAstroCache.get(key);
  if (entry && Date.now() - entry.timestamp < ttl) {
    return entry.data;
  }
  vedAstroCache.delete(key);
  return null;
}

function setCache(key: string, data: any): void {
  vedAstroCache.set(key, { data, timestamp: Date.now() });
  // Prevent unbounded growth — evict oldest entries if cache gets too large
  if (vedAstroCache.size > 200) {
    const oldest = vedAstroCache.keys().next().value;
    if (oldest) vedAstroCache.delete(oldest);
  }
}

// Helper: build time+location URL segment for VedAstro API
function buildTimeLocStr(
  time: string,    // "HH:MM"
  date: string,    // "DD/MM/YYYY"
  timezone: string,// "+05:30"
  locationName: string
): string {
  const dateParts = date.split("/");
  const dd = dateParts[0];
  const mm = dateParts[1];
  const yyyy = dateParts[2];
  const loc = encodeURIComponent(locationName.replace(/\s+/g, ""));
  return `Location/${loc}/Time/${time}/${dd}/${mm}/${yyyy}/${timezone}`;
}

// Helper: get current time formatted for VedAstro transit calls
function getCurrentTimeForTransit(locationName: string, timezone: string): string {
  const now = new Date();
  // Convert to timezone offset hours/minutes
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getUTCFullYear());
  const loc = encodeURIComponent(locationName.replace(/\s+/g, ""));
  return `Location/${loc}/Time/${hh}:${min}/${dd}/${mm}/${yyyy}/+00:00`;
}

// Fetch astro data from VedAstro Open API
// URL format: /api/Calculate/{Method}/Location/{City}/Time/{HH:MM}/{DD}/{MM}/{YYYY}/{timezone}
// Includes: natal chart, divisional charts (vargas), transit positions, Shadbala, Ashtakavarga, Dasha, Panchanga
async function fetchVedAstroData(
  birthTime: string, // "HH:MM"
  birthDate: string, // "DD/MM/YYYY"
  timezone: string,  // "+05:30"
  locationName: string,
  longitude: string,
  latitude: string
): Promise<Record<string, any>> {
  const timeLocStr = buildTimeLocStr(birthTime, birthDate, timezone, locationName);
  const transitTimeLocStr = getCurrentTimeForTransit(locationName, timezone);

  const results: Record<string, any> = {};

  // Comprehensive VedAstro API endpoints — maps to C# Calculate library
  // Source: https://github.com/VedAstro/VedAstro/tree/master/Library/Logic/Calculate
  const endpoints = [
    // ===== NATAL CHART (D1 — Rashi) =====
    // Core planetary data: positions, signs, nakshatras, conjunctions, aspects,
    // retrograde status, combustion, exaltation, debilitation, and more
    { key: "allPlanetData", url: `Calculate/AllPlanetData/PlanetName/All/${timeLocStr}` },
    { key: "allHouseData", url: `Calculate/AllHouseData/HouseName/All/${timeLocStr}` },
    { key: "horoscopePredictions", url: `Calculate/HoroscopePredictions/${timeLocStr}` },

    // ===== SHADBALA — Planetary & House Strength (Core.cs) =====
    { key: "allPlanetStrength", url: `Calculate/AllPlanetStrength/${timeLocStr}` },
    { key: "allPlanetOrderedByStrength", url: `Calculate/AllPlanetOrderedByStrength/${timeLocStr}` },

    // ===== ASHTAKAVARGA (Ashtakavarga.cs) =====
    { key: "sarvashtakavarga", url: `Calculate/SarvashtakavargaChart/${timeLocStr}` },
    { key: "bhinnashtakavarga", url: `Calculate/BhinnashtakavargaChart/${timeLocStr}` },

    // ===== VIMSHOTTARI DASHA (VimshottariDasa.cs) =====
    { key: "dasaForNow", url: `Calculate/DasaForNow/${timeLocStr}/Levels/3` },

    // ===== PANCHANGA (Core.cs) =====
    { key: "nithyaYoga", url: `Calculate/NithyaYoga/${timeLocStr}` },
    { key: "karana", url: `Calculate/Karana/${timeLocStr}` },
    { key: "lunarDay", url: `Calculate/LunarDay/${timeLocStr}` },

    // ===== DIVISIONAL CHARTS / VARGAS (Vargas.cs) =====
    { key: "navamsha", url: `Calculate/AllPlanetNavamshaSign/${timeLocStr}` },        // D9 — Marriage, dharma, spiritual life
    { key: "drekkana", url: `Calculate/AllPlanetDrekkanaSign/${timeLocStr}` },        // D3 — Siblings, courage, valour
    { key: "dashamsha", url: `Calculate/AllPlanetDashamamshaSign/${timeLocStr}` },    // D10 — Career, profession, public life
    { key: "saptamsha", url: `Calculate/AllPlanetSaptamshaSign/${timeLocStr}` },      // D7 — Children, progeny
    { key: "hora", url: `Calculate/AllPlanetHoraSign/${timeLocStr}` },                // D2 — Wealth, finances

    // ===== TRANSIT / GOCHARA — Current planetary positions =====
    // Uses current time to show where planets are NOW relative to birth chart
    { key: "transitPlanetData", url: `Calculate/AllPlanetData/PlanetName/All/${transitTimeLocStr}` },
  ];

  // Cache key prefix for this birth profile
  const cachePrefix = `${locationName}|${birthTime}|${birthDate}|${timezone}`;

  // Check cache for each endpoint first
  const uncachedEndpoints: typeof endpoints = [];
  for (const ep of endpoints) {
    const isTransit = ep.key === 'transitPlanetData';
    const ttl = isTransit ? TRANSIT_CACHE_TTL : NATAL_CACHE_TTL;
    const cacheKey = isTransit ? `transit|${locationName}` : `${cachePrefix}|${ep.key}`;
    const cached = getCached(cacheKey, ttl);
    if (cached) {
      results[ep.key] = cached;
    } else {
      uncachedEndpoints.push(ep);
    }
  }

  if (uncachedEndpoints.length > 0) {
    console.log(`VedAstro: ${endpoints.length - uncachedEndpoints.length} cached, ${uncachedEndpoints.length} to fetch`);

    // Fetch uncached endpoints with rate-limit-aware batching
    // VedAstro free tier: 5 calls/min. Batch in groups of 4 with 62s delay.
    const batchSize = 4;
    for (let i = 0; i < uncachedEndpoints.length; i += batchSize) {
      const batch = uncachedEndpoints.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async (ep) => {
          try {
            const url = `${VEDASTRO_API}/${ep.url}`;
            console.log(`VedAstro API [batch ${Math.floor(i / batchSize) + 1}]: ${ep.key}`);
            const resp = await fetch(url, { signal: AbortSignal.timeout(25000) });
            if (resp.ok) {
              const data = await resp.json();
              if (data?.Status === "Pass") {
                results[ep.key] = data;
                // Cache the result
                const isTransit = ep.key === 'transitPlanetData';
                const cacheKey = isTransit ? `transit|${locationName}` : `${cachePrefix}|${ep.key}`;
                setCache(cacheKey, data);
              } else {
                const msg = typeof data?.Payload === 'string' ? data.Payload.substring(0, 80) : '';
                console.error(`VedAstro API ${ep.key}: ${data?.Status} ${msg}`);
              }
            } else {
              console.error(`VedAstro API ${ep.key} returned HTTP ${resp.status}`);
            }
          } catch (e: any) {
            console.error(`VedAstro API error for ${ep.key}:`, e?.message || e);
          }
        })
      );
      // Wait between batches to respect rate limit
      if (i + batchSize < uncachedEndpoints.length) {
        console.log(`VedAstro: Waiting 62s for rate limit reset before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 62000));
      }
    }
  } else {
    console.log(`VedAstro: All ${endpoints.length} endpoints served from cache`);
  }

  console.log(`VedAstro: Final data available: ${Object.keys(results).join(', ')}`);
  if (Object.keys(results).length < endpoints.length) {
    const missing = endpoints.filter(ep => !results[ep.key]).map(ep => ep.key);
    console.log(`VedAstro: Missing: ${missing.join(', ')}`);
  }

  return results;
}

// Extract key planetary status info (retrograde, combust, exalted, debilitated) from AllPlanetData
function extractPlanetaryStatus(allPlanetData: any): string {
  try {
    const payload = allPlanetData?.Payload?.AllPlanetData;
    if (!payload) return "";

    const planets = Array.isArray(payload) ? payload : [payload];
    const statusLines: string[] = [];

    for (const entry of planets) {
      // Each entry is { "Sun": {...}, "Moon": {...} } etc.
      for (const [planetName, data] of Object.entries(entry)) {
        const d = data as Record<string, any>;
        const flags: string[] = [];

        if (d.IsPlanetRetrograde === "True") flags.push("RETROGRADE");
        if (d.IsPlanetCombust === "True") flags.push("COMBUST");
        if (d.IsPlanetExalted === "True") flags.push("EXALTED");
        if (d.IsPlanetDebilitated === "True") flags.push("DEBILITATED");
        if (d.IsPlanetAfflicted === "True") flags.push("AFFLICTED");
        if (d.IsPlanetBenefic === "True") flags.push("Benefic");
        if (d.IsPlanetBenefic === "False") flags.push("Malefic");

        // Aspects received
        const aspectsReceived: string[] = [];
        if (d.AllMaleficPlanetsAspecting?.length) aspectsReceived.push(`Malefic aspects from: ${d.AllMaleficPlanetsAspecting.join(", ")}`);
        if (d.BeneficPlanetsAspectingPlanet?.length) aspectsReceived.push(`Benefic aspects from: ${d.BeneficPlanetsAspectingPlanet.join(", ")}`);

        // Houses aspected and owned
        const housesAspected = d.HousesInAspect || "";
        const housesOwned = d.HousesOwnedByPlanet || "";
        const houseOccupied = d.HousePlanetOccupiesBasedOnSign || "";

        if (flags.length > 0 || aspectsReceived.length > 0) {
          let line = `- **${planetName}**: ${flags.join(", ")}`;
          if (houseOccupied) line += ` | In: ${houseOccupied}`;
          if (housesOwned) line += ` | Owns: ${housesOwned}`;
          if (housesAspected) line += ` | Aspects: ${housesAspected}`;
          if (aspectsReceived.length > 0) line += ` | ${aspectsReceived.join("; ")}`;
          statusLines.push(line);
        }
      }
    }

    return statusLines.length > 0 ? statusLines.join("\n") : "";
  } catch {
    return "";
  }
}

// Extract transit comparison: current planet signs vs natal signs
function extractTransitSummary(transitData: any, natalData: any): string {
  try {
    const transitPayload = transitData?.Payload?.AllPlanetData;
    const natalPayload = natalData?.Payload?.AllPlanetData;
    if (!transitPayload || !natalPayload) return "";

    const transitPlanets = Array.isArray(transitPayload) ? transitPayload : [transitPayload];
    const natalPlanets = Array.isArray(natalPayload) ? natalPayload : [natalPayload];

    const lines: string[] = [];
    const now = new Date();
    lines.push(`Transit date: ${now.toISOString().split("T")[0]}\n`);

    for (const tEntry of transitPlanets) {
      for (const [planetName, tData] of Object.entries(tEntry)) {
        const td = tData as Record<string, any>;
        const transitSign = td.PlanetSignName || td.PlanetRasiSign?.Name || "unknown";
        const transitHouse = td.HousePlanetOccupiesBasedOnSign || "";
        const isRetro = td.IsPlanetRetrograde === "True" ? " (R)" : "";

        // Find natal sign for comparison
        let natalSign = "";
        for (const nEntry of natalPlanets) {
          if (nEntry[planetName]) {
            const nd = nEntry[planetName] as Record<string, any>;
            natalSign = nd.PlanetSignName || nd.PlanetRasiSign?.Name || "";
            break;
          }
        }

        let line = `- **${planetName}${isRetro}**: Currently in ${transitSign}`;
        if (transitHouse) line += ` (transit ${transitHouse})`;
        if (natalSign && natalSign !== transitSign) line += ` | Natal: ${natalSign}`;
        lines.push(line);
      }
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}

// Format astro data for LLM context — includes ALL VedAstro Calculate library data:
// natal, divisional charts, transit, aspects, retrogrades, combustion, Shadbala, Ashtakavarga, Dasha, Panchanga
function formatAstroContext(data: Record<string, any>): string {
  let context = "## Vedic Astrology Chart Data (from VedAstro Calculate Library)\n\n";

  // Helper to safely extract payload and stringify
  function addSection(key: string, title: string, maxLen: number) {
    if (!data[key]) return;
    context += `### ${title}\n`;
    try {
      const payload = data[key]?.Payload || data[key];
      if (typeof payload === "object") {
        context += JSON.stringify(payload, null, 2).substring(0, maxLen);
      }
    } catch { context += "(data available)\n"; }
    context += "\n\n";
  }

  // ==================== NATAL CHART (D1) ====================
  addSection("allPlanetData", "Planetary Positions (Rashi, Degrees, Nakshatra, Conjunctions, Aspects)", 5000);
  addSection("allHouseData", "House Data (Bhavas — Lords, Occupants, Sign)", 3000);

  // ==================== PLANETARY STATUS ====================
  // Extracted from AllPlanetData: retrogrades, combustion, exaltation, debilitation, aspects
  const planetaryStatus = extractPlanetaryStatus(data.allPlanetData);
  if (planetaryStatus) {
    context += `### Planetary Status (Retrograde, Combust, Exalted, Debilitated, Aspects)\n${planetaryStatus}\n\n`;
  }

  // ==================== SHADBALA ====================
  addSection("allPlanetStrength", "Shadbala — Planetary Strength Values", 2000);
  addSection("allPlanetOrderedByStrength", "Planets Ordered by Strength (Strongest to Weakest)", 1000);

  // ==================== ASHTAKAVARGA ====================
  addSection("sarvashtakavarga", "Sarvashtakavarga Chart (Total Benefic Points per Sign)", 2000);
  addSection("bhinnashtakavarga", "Bhinnashtakavarga Chart (Individual Planet Bindus)", 2000);

  // ==================== VIMSHOTTARI DASHA ====================
  addSection("dasaForNow", "Current Vimshottari Dasha Period (Mahadasha > Antardasha > Pratyantardasha)", 2000);

  // ==================== DIVISIONAL CHARTS (VARGAS) ====================
  addSection("navamsha", "Navamsha (D9) — Dharma, Marriage, Spiritual Life", 2000);
  addSection("drekkana", "Drekkana (D3) — Siblings, Courage, Valour", 1500);
  addSection("dashamsha", "Dashamsha (D10) — Career, Profession, Public Life", 1500);
  addSection("saptamsha", "Saptamsha (D7) — Children, Progeny", 1500);
  addSection("hora", "Hora (D2) — Wealth, Finances", 1000);

  // ==================== TRANSIT / GOCHARA ====================
  const transitSummary = extractTransitSummary(data.transitPlanetData, data.allPlanetData);
  if (transitSummary) {
    context += `### Current Transit Positions (Gochara)\n${transitSummary}\n\n`;
  }
  // Also include raw transit data for deeper analysis
  addSection("transitPlanetData", "Transit — Full Current Planetary Data (for Gochara analysis)", 3000);

  // ==================== HOROSCOPE PREDICTIONS ====================
  addSection("horoscopePredictions", "Horoscope Predictions (Classical Rule-Based)", 4000);

  // ==================== PANCHANGA ====================
  addSection("nithyaYoga", "Nithya Yoga (Birth Yoga)", 500);
  addSection("karana", "Karana (Half Lunar Day)", 500);
  addSection("lunarDay", "Lunar Day (Tithi)", 500);

  return context;
}

// Build system prompt for the LLM
function buildSystemPrompt(astroContext: string, ragContext: string): string {
  return `You are JyotishGPT, an expert Vedic Astrologer AI assistant powered by the VedAstro calculation engine. You provide insightful, compassionate, and accurate Vedic astrology readings and guidance.

## Your Expertise
- Deep knowledge of Vedic astrology (Jyotish Shastra)
- Planetary positions, houses, signs, nakshatras, dashas
- Shadbala (six-fold strength) analysis for each planet
- Ashtakavarga — Sarvashtakavarga and Bhinnashtakavarga point analysis
- Vimshottari Dasha — current Mahadasha, Antardasha, and Pratyantardasha periods
- Yogas, doshas, and their effects
- Planetary aspects (graha drishti) — which planets aspect which houses/planets
- Retrograde (Vakri) planets and their significance
- Combustion (Asta) — planets too close to the Sun
- Exaltation (Uchcha) and Debilitation (Neecha) status
- Panchanga: Tithi, Nakshatra, Yoga, Karana, Vara
- Transit/Gochara — current planetary positions relative to natal chart
- Divisional charts (Vargas): D1 (Rashi), D2 (Hora), D3 (Drekkana), D7 (Saptamsha), D9 (Navamsha), D10 (Dashamsha)
- Muhurta (auspicious timing)
- Compatibility analysis (Kundali matching)
- Remedial measures (gemstones, mantras, pujas)

## Data Available from VedAstro Calculate Library
You have access to comprehensive chart data computed by VedAstro's C# calculation engine:

### Natal Chart (D1 — Rashi)
- **Planetary Positions**: Sign, degree, nakshatra, pada for all 9 planets + nodes
- **House Data**: All 12 bhavas with lords and occupants
- **Planetary Status**: Retrograde, combust, exalted, debilitated, afflicted flags for each planet
- **Aspects**: Which planets aspect which houses, malefic/benefic aspects received by each planet
- **Conjunctions**: Benefic, malefic, friend, enemy conjunctions for each planet

### Strength Analysis
- **Shadbala**: Numerical strength values showing which planets are strongest/weakest
- **Ashtakavarga**: Sarvashtakavarga (total points per sign) and Bhinnashtakavarga (individual planet bindus)

### Timing
- **Vimshottari Dasha**: Current Mahadasha > Antardasha > Pratyantardasha with dates
- **Transit/Gochara**: Current real-time planetary positions — which signs planets are transiting NOW, compared to natal positions. Use this for timing predictions and current period analysis.

### Divisional Charts (Vargas)
- **Navamsha (D9)**: Marriage, dharma, spiritual life — planet signs in the 9th divisional chart
- **Dashamsha (D10)**: Career, profession, public life
- **Drekkana (D3)**: Siblings, courage, valour
- **Saptamsha (D7)**: Children, progeny
- **Hora (D2)**: Wealth, finances

### Panchanga & Predictions
- **Panchanga**: Tithi, Nithya Yoga, Karana at time of birth
- **Horoscope Predictions**: Pre-computed prediction texts from classical rules

## Reasoning Approach
When answering questions:
1. First analyze the natal chart — planetary positions, strengths, and house placements
2. Check **Planetary Status** — identify retrograde, combust, exalted, or debilitated planets
3. Review **Aspects** — which planets receive benefic/malefic aspects, which houses are aspected
4. Check **Shadbala** to quantify strong and weak planets
5. Examine **Ashtakavarga** points for sign-level benefic/malefic assessment
6. Consider the current **Vimshottari Dasha** period and its lord's natal condition
7. Analyze **Transit/Gochara** — where are planets NOW vs. natal positions? Which natal houses are being transited?
8. Check relevant **Divisional Charts** (D9 for marriage questions, D10 for career, D7 for children, D2 for wealth)
9. Look for yogas and apply classical rules
10. Provide interpretations with classical references and suggest remedies

## Response Style
- Be warm, compassionate, and encouraging
- Use proper Vedic astrology terminology with explanations
- Reference classical texts when possible (Brihat Parashara Hora Shastra, Phaladeepika, Jataka Parijata, etc.)
- Quote specific Shadbala strength values and Ashtakavarga bindu counts to support your analysis
- Mention retrograde/combust status when analyzing a planet
- Always reference the current Dasha period AND current transits when discussing timing
- Use divisional charts to go deeper on specific life areas (D9 for marriage, D10 for career)
- Always clarify that astrology provides guidance, not deterministic predictions
- Format responses with clear sections using markdown

${astroContext ? `## Birth Chart Data Available\n${astroContext}` : "## No birth data provided yet\nAsk the user to provide their birth details (date, time, place) to generate a chart."}

${ragContext ? `## Reference Knowledge from Uploaded Books\n${ragContext}` : ""}

Remember: Analyze ALL available chart data thoroughly — natal positions, planetary status (retrograde/combust/aspects), Shadbala, Ashtakavarga, Dasha, transits, and divisional charts — to provide detailed, personalized, and data-backed insights. Use chain-of-thought reasoning to explain your analysis step by step.`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ====== BIRTH PROFILES ======
  app.post("/api/profiles", async (req: Request, res: Response) => {
    try {
      const visitorId = getVisitorId(req);
      const parsed = insertBirthProfileSchema.parse({ ...req.body, visitorId });
      const profile = await storage.createBirthProfile(parsed);
      res.json(profile);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/profiles", async (req: Request, res: Response) => {
    const visitorId = getVisitorId(req);
    const profiles = await storage.getBirthProfiles(visitorId);
    res.json(profiles);
  });

  // ====== CONVERSATIONS ======
  app.post("/api/conversations", async (req: Request, res: Response) => {
    try {
      const visitorId = getVisitorId(req);
      const conv = await storage.createConversation({
        visitorId,
        title: req.body.title || "New Conversation",
        profileId: req.body.profileId || null,
      });
      res.json(conv);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/conversations", async (req: Request, res: Response) => {
    const visitorId = getVisitorId(req);
    const convs = await storage.getConversations(visitorId);
    res.json(convs);
  });

  app.delete("/api/conversations/:id", async (req: Request, res: Response) => {
    await storage.deleteConversation(Number(req.params.id));
    res.json({ deleted: true });
  });

  // ====== MESSAGES ======
  app.get("/api/conversations/:id/messages", async (req: Request, res: Response) => {
    const msgs = await storage.getMessages(Number(req.params.id));
    res.json(msgs);
  });

  // ====== CHAT (Main endpoint with streaming) ======
  app.post("/api/chat", async (req: Request, res: Response) => {
    try {
      const { conversationId, message, profileId } = req.body;

      if (!conversationId || !message) {
        return res.status(400).json({ error: "conversationId and message required" });
      }

      // Save user message
      const userMsg = await storage.addMessage({
        conversationId,
        role: "user",
        content: message,
        reasoning: null,
        astroData: null,
        ragContext: null,
        timestamp: new Date().toISOString(),
      });

      // Get conversation history for memory
      const history = await storage.getMessages(conversationId);

      // Get astro data if profile is set
      let astroContext = "";
      let astroDataJson = null;
      if (profileId) {
        const profile = await storage.getBirthProfile(profileId);
        if (profile) {
          try {
            const astroData = await fetchVedAstroData(
              profile.birthTime,
              profile.birthDate,
              profile.timezone,
              profile.locationName,
              profile.longitude,
              profile.latitude
            );
            astroContext = formatAstroContext(astroData);
            astroDataJson = JSON.stringify(astroData);
          } catch (e) {
            console.error("VedAstro fetch error:", e);
          }
        }
      }

      // RAG search
      let ragContext = "";
      let ragContextJson = null;
      try {
        const ragResults = await storage.searchRagChunks(message, 5);
        if (ragResults.length > 0) {
          ragContext = ragResults.map((r, i) => `[Reference ${i + 1}]: ${r.content}`).join("\n\n");
          ragContextJson = JSON.stringify(ragResults.map(r => ({ id: r.id, chunk: r.content.substring(0, 200) })));
        }
      } catch (e) {
        console.error("RAG search error:", e);
      }

      // Build messages for LLM
      const systemPrompt = buildSystemPrompt(astroContext, ragContext);

      // Build conversation messages (last 20 for context window)
      const recentHistory = history.slice(-20);
      const llmMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const h of recentHistory) {
        if (h.role === "user" || h.role === "assistant") {
          llmMessages.push({ role: h.role as "user" | "assistant", content: h.content });
        }
      }

      // Add current message
      llmMessages.push({ role: "user", content: message });

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // First send a "thinking" event with chain-of-thought reasoning request
      const client = new Anthropic();

      // Step 1: Get reasoning
      let reasoning = "";
      try {
        const thinkingResponse = await client.messages.create({
          model: LLM_MODEL,
          max_tokens: 1024,
          system: `You are a Vedic astrology reasoning engine powered by VedAstro calculations. Given the user's question and available chart data, think through the analysis step by step. Be concise but thorough. Focus on:
1. Which planetary positions are relevant and their Shadbala strength values
2. Planetary status: check for retrograde (Vakri), combust (Asta), exalted (Uchcha), debilitated (Neecha) planets
3. Aspects: which planets receive benefic/malefic aspects, and which houses are aspected
4. Ashtakavarga bindu counts for the relevant signs/houses
5. Current Vimshottari Dasha period and its lord's natal condition
6. Transit/Gochara: where are planets NOW vs natal? Which natal houses are being transited by benefics/malefics?
7. Divisional charts: D9 (Navamsha) for marriage/dharma, D10 (Dashamsha) for career, D7 for children, D2 for wealth
8. What yogas apply based on planetary combinations
9. Panchanga factors (Tithi, Yoga, Karana) if relevant
10. Classical text references (BPHS, Phaladeepika, Jataka Parijata)

${astroContext}
${ragContext ? `\nReference material:\n${ragContext}` : ""}`,
          messages: [{ role: "user", content: message }],
        });

        reasoning = thinkingResponse.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");

        // Send reasoning as SSE event
        res.write(`data: ${JSON.stringify({ type: "reasoning", content: reasoning })}\n\n`);
      } catch (e: any) {
        console.error("Reasoning step error:", e?.message || e);
        reasoning = "Direct analysis mode.";
        // If API key is missing or invalid, surface the error immediately
        if (e?.status === 401 || e?.message?.includes("API key") || e?.message?.includes("authentication")) {
          res.write(`data: ${JSON.stringify({ type: "content", content: "Error: Anthropic API key is missing or invalid. Please set the ANTHROPIC_API_KEY environment variable with a valid key from https://console.anthropic.com/" })}\n\n`);
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
          return;
        }
      }

      // Step 2: Stream the main response
      let fullResponse = "";
      try {
        const stream = client.messages.stream({
          model: LLM_MODEL,
          max_tokens: 2048,
          system: systemPrompt + `\n\n## Your Internal Reasoning\n${reasoning}`,
          messages: llmMessages,
        });

        for await (const event of stream) {
          if (event.type === "content_block_delta" && (event.delta as any).type === "text_delta") {
            const text = (event.delta as any).text;
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ type: "content", content: text })}\n\n`);
          }
        }
      } catch (e: any) {
        console.error("Streaming error:", e?.message || e);
        const errMsg = e?.status === 401
          ? "Error: Invalid Anthropic API key. Please check your ANTHROPIC_API_KEY."
          : e?.status === 429
          ? "Error: Rate limit reached. Please wait a moment and try again."
          : `I apologize, but I encountered an issue: ${e?.message || "Unknown error"}. Please try again.`;
        fullResponse = errMsg;
        res.write(`data: ${JSON.stringify({ type: "content", content: fullResponse })}\n\n`);
      }

      // Save assistant message
      await storage.addMessage({
        conversationId,
        role: "assistant",
        content: fullResponse,
        reasoning,
        astroData: astroDataJson,
        ragContext: ragContextJson,
        timestamp: new Date().toISOString(),
      });

      // Auto-title conversation if it's the first exchange
      if (history.length <= 1) {
        const titleSnippet = message.substring(0, 50) + (message.length > 50 ? "..." : "");
        await storage.updateConversationTitle(conversationId, titleSnippet);
      }

      // End stream
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (e: any) {
      console.error("Chat error:", e);
      if (!res.headersSent) {
        res.status(400).json({ error: e.message });
      }
    }
  });

  // ====== RAG DOCUMENT UPLOAD ======
  app.post("/api/rag/upload", async (req: Request, res: Response) => {
    try {
      const visitorId = getVisitorId(req);
      const { filename, content } = req.body;

      if (!filename || !content) {
        return res.status(400).json({ error: "filename and content required" });
      }

      // Chunk the content (simple paragraph-based chunking)
      const chunks = chunkText(content, 500, 50);

      // Save document metadata
      const doc = await storage.addRagDocument({
        visitorId,
        filename,
        chunkCount: chunks.length,
      });

      // Save chunks
      await storage.addRagChunks(
        chunks.map((text, idx) => ({
          documentId: doc.id,
          content: text,
          chunkIndex: idx,
        }))
      );

      res.json({ id: doc.id, filename, chunkCount: chunks.length });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ====== RAG FILE UPLOAD (PDF, TXT, MD) ======
  app.post("/api/rag/upload-file", upload.single("file"), async (req: Request, res: Response) => {
    try {
      const visitorId = getVisitorId(req);
      const file = (req as any).file;

      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const filename = file.originalname;
      let textContent = "";

      // Extract text based on file type
      const ext = filename.toLowerCase().split(".").pop();
      if (ext === "pdf") {
        try {
          const pdfData = await pdfParse(file.buffer);
          textContent = pdfData.text;
          console.log(`PDF parsed: ${filename} — ${pdfData.numpages} pages, ${textContent.length} chars`);
        } catch (pdfErr: any) {
          return res.status(400).json({ error: `Failed to parse PDF: ${pdfErr.message}` });
        }
      } else {
        // Plain text files (.txt, .md, .csv)
        textContent = file.buffer.toString("utf-8");
      }

      if (!textContent.trim()) {
        return res.status(400).json({ error: "No text content could be extracted from the file" });
      }

      // Chunk the content
      const chunks = chunkText(textContent, 500, 50);

      // Save document metadata
      const doc = await storage.addRagDocument({
        visitorId,
        filename,
        chunkCount: chunks.length,
      });

      // Save chunks
      await storage.addRagChunks(
        chunks.map((text, idx) => ({
          documentId: doc.id,
          content: text,
          chunkIndex: idx,
        }))
      );

      res.json({ id: doc.id, filename, chunkCount: chunks.length, charCount: textContent.length });
    } catch (e: any) {
      console.error("File upload error:", e);
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/rag/documents", async (req: Request, res: Response) => {
    const visitorId = getVisitorId(req);
    const docs = await storage.getRagDocuments(visitorId);
    res.json(docs);
  });

  // ====== VEDASTRO DIRECT CALCULATION ======
  app.post("/api/vedastro/calculate", async (req: Request, res: Response) => {
    try {
      const { birthDate, birthTime, timezone, locationName, longitude, latitude } = req.body;
      const data = await fetchVedAstroData(
        birthTime,
        birthDate,
        timezone,
        locationName,
        longitude,
        latitude
      );
      res.json(data);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ====== VEDASTRO LOCATION SEARCH ======
  // Auto-resolve birth place to coordinates using VedAstro's SearchLocation API
  app.get("/api/vedastro/search-location", async (req: Request, res: Response) => {
    try {
      const address = req.query.q as string;
      if (!address || address.length < 2) {
        return res.json([]);
      }
      // SearchLocation uses the api.vedastro.org endpoint (different from calculation API)
      const url = `https://api.vedastro.org/api/Calculate/SearchLocation/address/${encodeURIComponent(address)}`;
      console.log(`VedAstro SearchLocation: ${url}`);
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        return res.json([]);
      }
      const data = await resp.json();
      // VedAstro returns locations in Payload.SearchLocation
      const locations = data?.Payload?.SearchLocation || data?.Payload || [];
      res.json(Array.isArray(locations) ? locations : []);
    } catch (e: any) {
      console.error("SearchLocation error:", e);
      res.json([]);
    }
  });

  // ====== VEDASTRO TIMEZONE LOOKUP ======
  app.get("/api/vedastro/timezone", async (req: Request, res: Response) => {
    try {
      const { lat, lng, date, time } = req.query;
      if (!lat || !lng) {
        return res.status(400).json({ error: "lat and lng required" });
      }
      const locationStr = `Location/Unknown/Coordinates/${lat},${lng}`;
      const timeStr = time && date ? `Time/${time}/${date}/+00:00` : `Time/12:00/01/01/2000/+00:00`;
      const url = `https://api.vedastro.org/api/Calculate/GeoLocationToTimezone/${locationStr}/${timeStr}`;
      console.log(`VedAstro Timezone: ${url}`);
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        return res.json({ timezone: "+00:00" });
      }
      const data = await resp.json();
      res.json(data?.Payload || data);
    } catch (e: any) {
      console.error("Timezone lookup error:", e);
      res.json({ timezone: "+00:00" });
    }
  });

  return httpServer;
}

// Simple text chunking with overlap
function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const sentence of sentences) {
    if (currentLen + sentence.length > chunkSize && current.length > 0) {
      chunks.push(current.join(" "));
      // Keep overlap
      const overlapSentences: string[] = [];
      let overlapLen = 0;
      for (let i = current.length - 1; i >= 0 && overlapLen < overlap; i--) {
        overlapSentences.unshift(current[i]);
        overlapLen += current[i].length;
      }
      current = overlapSentences;
      currentLen = overlapLen;
    }
    current.push(sentence);
    currentLen += sentence.length;
  }

  if (current.length > 0) {
    chunks.push(current.join(" "));
  }

  return chunks;
}
