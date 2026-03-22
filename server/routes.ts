import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  insertBirthProfileSchema,
  insertConversationSchema,
} from "@shared/schema";

// VedAstro API base URL
const VEDASTRO_API = "https://vedastroapi.azurewebsites.net/api";

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

  // Fetch multiple data points in parallel
  const endpoints = [
    { key: "allPlanetData", url: `Calculate/AllPlanetData/PlanetName/All/${timeLocStr}` },
    { key: "allHouseData", url: `Calculate/AllHouseData/HouseName/All/${timeLocStr}` },
    { key: "horoscopePredictions", url: `Calculate/HoroscopePredictions/${timeLocStr}` },
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

// Format astro data for LLM context
function formatAstroContext(data: Record<string, any>): string {
  let context = "## Vedic Astrology Chart Data\n\n";

  if (data.allPlanetData) {
    context += "### Planetary Positions\n";
    try {
      const payload = data.allPlanetData?.Payload || data.allPlanetData;
      if (typeof payload === "object") {
        context += JSON.stringify(payload, null, 2).substring(0, 3000);
      }
    } catch { context += "(data available)\n"; }
    context += "\n\n";
  }

  if (data.allHouseData) {
    context += "### House Data\n";
    try {
      const payload = data.allHouseData?.Payload || data.allHouseData;
      if (typeof payload === "object") {
        context += JSON.stringify(payload, null, 2).substring(0, 2000);
      }
    } catch { context += "(data available)\n"; }
    context += "\n\n";
  }

  if (data.horoscopePredictions) {
    context += "### Horoscope Predictions\n";
    try {
      const payload = data.horoscopePredictions?.Payload || data.horoscopePredictions;
      if (typeof payload === "object") {
        context += JSON.stringify(payload, null, 2).substring(0, 3000);
      }
    } catch { context += "(data available)\n"; }
    context += "\n\n";
  }

  return context;
}

// Build system prompt for the LLM
function buildSystemPrompt(astroContext: string, ragContext: string): string {
  return `You are JyotishGPT, an expert Vedic Astrologer AI assistant. You provide insightful, compassionate, and accurate Vedic astrology readings and guidance.

## Your Expertise
- Deep knowledge of Vedic astrology (Jyotish Shastra)
- Planetary positions, houses, signs, nakshatras, dashas
- Yogas, doshas, and their effects
- Muhurta (auspicious timing)
- Compatibility analysis (Kundali matching)
- Remedial measures (gemstones, mantras, pujas)

## Reasoning Approach
When answering questions:
1. First analyze the chart data available
2. Identify relevant planetary positions and house placements
3. Look for yogas, aspects, and conjunctions
4. Consider dasha periods and transits
5. Provide interpretations with classical references
6. Suggest remedies when appropriate

## Response Style
- Be warm, compassionate, and encouraging
- Use proper Vedic astrology terminology with explanations
- Reference classical texts when possible (Brihat Parashara Hora Shastra, Phaladeepika, etc.)
- Always clarify that astrology provides guidance, not deterministic predictions
- Format responses with clear sections using markdown

${astroContext ? `## Birth Chart Data Available\n${astroContext}` : "## No birth data provided yet\nAsk the user to provide their birth details (date, time, place) to generate a chart."}

${ragContext ? `## Reference Knowledge from Uploaded Books\n${ragContext}` : ""}

Remember: Analyze the birth chart data thoroughly and provide detailed, personalized insights. Use chain-of-thought reasoning to explain your analysis step by step.`;
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
          model: "claude_sonnet_4_6",
          max_tokens: 1024,
          system: `You are a Vedic astrology reasoning engine. Given the user's question and available chart data, think through the analysis step by step. Be concise but thorough. Focus on:
1. Which planetary positions are relevant
2. What yogas or aspects apply
3. What dasha periods might be active
4. Classical text references

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
      } catch (e) {
        console.error("Reasoning step error:", e);
        reasoning = "Direct analysis mode.";
      }

      // Step 2: Stream the main response
      let fullResponse = "";
      try {
        const stream = client.messages.stream({
          model: "claude_sonnet_4_6",
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
        console.error("Streaming error:", e);
        fullResponse = "I apologize, but I encountered an issue generating the response. Please try again.";
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
