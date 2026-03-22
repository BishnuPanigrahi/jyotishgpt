import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  insertBirthProfileSchema,
  insertConversationSchema,
} from "@shared/schema";

// VedAstro API base URL (api.vedastro.org is the primary, reliable endpoint)
const VEDASTRO_API = "https://api.vedastro.org/api";

// Anthropic model — use env var or default to claude-sonnet-4-6
const LLM_MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";

function getVisitorId(req: Request): string {
  return req.headers["x-visitor-id"] as string || "default-visitor";
}

// Fetch astro data from VedAstro Open API
// URL format: /api/Calculate/{Method}/Location/{City}/Time/{HH:MM}/{DD}/{MM}/{YYYY}/{timezone}
async function fetchVedAstroData(
  birthTime: string, // "HH:MM"
  birthDate: string, // "DD/MM/YYYY"
  timezone: string,  // "+05:30"
  locationName: string,
  longitude: string,
  latitude: string
): Promise<Record<string, any>> {
  // Parse time and date for URL construction
  const time = birthTime; // HH:MM
  const dateParts = birthDate.split("/"); // DD/MM/YYYY
  const dd = dateParts[0];
  const mm = dateParts[1];
  const yyyy = dateParts[2];
  const tz = timezone; // e.g. +05:30

  // Location name cleaned for URL
  const loc = encodeURIComponent(locationName.replace(/\s+/g, ""));

  const timeLocStr = `Location/${loc}/Time/${time}/${dd}/${mm}/${yyyy}/${tz}`;

  const results: Record<string, any> = {};

  // Comprehensive VedAstro API endpoints — maps to C# Calculate library
  // Source: https://github.com/VedAstro/VedAstro/tree/master/Library/Logic/Calculate
  const endpoints = [
    // === Core planetary & house data (Core.cs) ===
    { key: "allPlanetData", url: `Calculate/AllPlanetData/PlanetName/All/${timeLocStr}` },
    { key: "allHouseData", url: `Calculate/AllHouseData/HouseName/All/${timeLocStr}` },
    { key: "horoscopePredictions", url: `Calculate/HoroscopePredictions/${timeLocStr}` },

    // === Shadbala — planetary & house strength (Core.cs) ===
    { key: "allPlanetStrength", url: `Calculate/AllPlanetStrength/${timeLocStr}` },
    { key: "allPlanetOrderedByStrength", url: `Calculate/AllPlanetOrderedByStrength/${timeLocStr}` },

    // === Ashtakavarga (Ashtakavarga.cs) ===
    { key: "sarvashtakavarga", url: `Calculate/SarvashtakavargaChart/${timeLocStr}` },
    { key: "bhinnashtakavarga", url: `Calculate/BhinnashtakavargaChart/${timeLocStr}` },

    // === Vimshottari Dasha — current period (VimshottariDasa.cs) ===
    { key: "dasaForNow", url: `Calculate/DasaForNow/${timeLocStr}/Levels/3` },

    // === Yoga & day quality (Core.cs) ===
    { key: "nithyaYoga", url: `Calculate/NithyaYoga/${timeLocStr}` },
    { key: "karana", url: `Calculate/Karana/${timeLocStr}` },
    { key: "lunarDay", url: `Calculate/LunarDay/${timeLocStr}` },
  ];

  await Promise.allSettled(
    endpoints.map(async (ep) => {
      try {
        const url = `${VEDASTRO_API}/${ep.url}`;
        console.log(`VedAstro API call: ${url}`);
        const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (resp.ok) {
          const data = await resp.json();
          results[ep.key] = data;
        } else {
          console.error(`VedAstro API ${ep.key} returned ${resp.status}`);
        }
      } catch (e) {
        console.error(`VedAstro API error for ${ep.key}:`, e);
      }
    })
  );

  return results;
}

// Format astro data for LLM context — includes all VedAstro Calculate library data
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

  // Core chart data
  addSection("allPlanetData", "Planetary Positions (Rashi, Degrees, Nakshatra)", 4000);
  addSection("allHouseData", "House Data (Bhavas)", 3000);
  addSection("horoscopePredictions", "Horoscope Predictions", 4000);

  // Shadbala — planetary strength analysis (from Core.cs)
  addSection("allPlanetStrength", "Shadbala — Planetary Strength Values", 2000);
  addSection("allPlanetOrderedByStrength", "Planets Ordered by Strength (Strongest to Weakest)", 1000);

  // Ashtakavarga (from Ashtakavarga.cs)
  addSection("sarvashtakavarga", "Sarvashtakavarga Chart (Total Benefic Points per Sign)", 2000);
  addSection("bhinnashtakavarga", "Bhinnashtakavarga Chart (Individual Planet Bindus)", 2000);

  // Vimshottari Dasha (from VimshottariDasa.cs)
  addSection("dasaForNow", "Current Vimshottari Dasha Period (Mahadasha > Antardasha > Pratyantardasha)", 2000);

  // Panchanga elements (from Core.cs)
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
- Panchanga: Tithi, Nakshatra, Yoga, Karana, Vara
- Muhurta (auspicious timing)
- Divisional charts (Vargas): D1 through D60
- Compatibility analysis (Kundali matching)
- Remedial measures (gemstones, mantras, pujas)

## Data Available from VedAstro Calculate Library
You have access to comprehensive chart data computed by VedAstro's C# calculation engine:
- **Planetary Positions**: Sign, degree, nakshatra, pada for all 9 planets + nodes
- **House Data**: All 12 bhavas with lords and occupants
- **Shadbala**: Numerical strength values showing which planets are strongest/weakest
- **Ashtakavarga**: Sarvashtakavarga (total points per sign) and Bhinnashtakavarga (individual planet bindus)
- **Vimshottari Dasha**: Current Mahadasha > Antardasha > Pratyantardasha with dates
- **Panchanga**: Tithi, Nithya Yoga, Karana at time of birth
- **Horoscope Predictions**: Pre-computed prediction texts from classical rules

## Reasoning Approach
When answering questions:
1. First analyze the chart data — planetary positions, strengths, and house placements
2. Check Shadbala to identify strong and weak planets
3. Examine Ashtakavarga points for sign-level benefic/malefic assessment
4. Consider the current Vimshottari Dasha period and its lord
5. Look for yogas, aspects, and conjunctions
6. Provide interpretations with classical references
7. Suggest remedies when appropriate

## Response Style
- Be warm, compassionate, and encouraging
- Use proper Vedic astrology terminology with explanations
- Reference classical texts when possible (Brihat Parashara Hora Shastra, Phaladeepika, Jataka Parijata, etc.)
- Quote specific Shadbala strength values and Ashtakavarga bindu counts to support your analysis
- Always mention the current Dasha period and its effects when relevant
- Always clarify that astrology provides guidance, not deterministic predictions
- Format responses with clear sections using markdown

${astroContext ? `## Birth Chart Data Available\n${astroContext}` : "## No birth data provided yet\nAsk the user to provide their birth details (date, time, place) to generate a chart."}

${ragContext ? `## Reference Knowledge from Uploaded Books\n${ragContext}` : ""}

Remember: Analyze ALL available chart data thoroughly — Shadbala, Ashtakavarga, Dasha, and Panchanga — to provide detailed, personalized, and data-backed insights. Use chain-of-thought reasoning to explain your analysis step by step.`;
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
2. Ashtakavarga bindu counts for the relevant signs/houses
3. Current Vimshottari Dasha period and its lord's condition
4. What yogas or aspects apply
5. Panchanga factors (Tithi, Yoga, Karana) if relevant
6. Classical text references (BPHS, Phaladeepika, Jataka Parijata)

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
