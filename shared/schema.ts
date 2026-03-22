import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Birth profiles for astrology calculations
export const birthProfiles = sqliteTable("birth_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  visitorId: text("visitor_id").notNull(),
  name: text("name").notNull(),
  birthDate: text("birth_date").notNull(), // DD/MM/YYYY
  birthTime: text("birth_time").notNull(), // HH:MM
  timezone: text("timezone").notNull(), // e.g. +05:30
  locationName: text("location_name").notNull(),
  longitude: text("longitude").notNull(),
  latitude: text("latitude").notNull(),
});

export const insertBirthProfileSchema = createInsertSchema(birthProfiles).omit({ id: true });
export type InsertBirthProfile = z.infer<typeof insertBirthProfileSchema>;
export type BirthProfile = typeof birthProfiles.$inferSelect;

// Conversations
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  visitorId: text("visitor_id").notNull(),
  title: text("title").notNull().default("New Conversation"),
  profileId: integer("profile_id"),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

// Messages
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant" | "system"
  content: text("content").notNull(),
  reasoning: text("reasoning"), // chain-of-thought
  astroData: text("astro_data"), // JSON of VedAstro results used
  ragContext: text("rag_context"), // JSON of RAG references used
  timestamp: text("timestamp").notNull(),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// RAG documents (uploaded books metadata)
export const ragDocuments = sqliteTable("rag_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  visitorId: text("visitor_id").notNull(),
  filename: text("filename").notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
});

export const insertRagDocumentSchema = createInsertSchema(ragDocuments).omit({ id: true });
export type InsertRagDocument = z.infer<typeof insertRagDocumentSchema>;
export type RagDocument = typeof ragDocuments.$inferSelect;

// RAG chunks for vector-like search (simple BM25 with SQLite FTS)
export const ragChunks = sqliteTable("rag_chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  documentId: integer("document_id").notNull(),
  content: text("content").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
});

export const insertRagChunkSchema = createInsertSchema(ragChunks).omit({ id: true });
export type InsertRagChunk = z.infer<typeof insertRagChunkSchema>;
export type RagChunk = typeof ragChunks.$inferSelect;
