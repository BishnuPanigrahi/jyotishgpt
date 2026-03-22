import {
  type BirthProfile, type InsertBirthProfile, birthProfiles,
  type Conversation, type InsertConversation, conversations,
  type Message, type InsertMessage, messages,
  type RagDocument, type InsertRagDocument, ragDocuments,
  type RagChunk, type InsertRagChunk, ragChunks,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Initialize tables and FTS
function initializeDatabase() {
  // Create tables via raw SQL to ensure they exist before FTS setup
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS birth_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      name TEXT NOT NULL,
      birth_date TEXT NOT NULL,
      birth_time TEXT NOT NULL,
      timezone TEXT NOT NULL,
      location_name TEXT NOT NULL,
      longitude TEXT NOT NULL,
      latitude TEXT NOT NULL
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      profile_id INTEGER
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      astro_data TEXT,
      rag_context TEXT,
      timestamp TEXT NOT NULL
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL
    );
  `);

  // Now create FTS5 table
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
      content,
      content_rowid='id',
      content='rag_chunks'
    );
  `);

  // Triggers to keep FTS in sync
  try {
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content) VALUES('delete', old.id, old.content);
      END;
    `);
  } catch (e) {
    // Triggers may already exist
  }
}

initializeDatabase();

export interface IStorage {
  createBirthProfile(profile: InsertBirthProfile): Promise<BirthProfile>;
  getBirthProfiles(visitorId: string): Promise<BirthProfile[]>;
  getBirthProfile(id: number): Promise<BirthProfile | undefined>;
  createConversation(conv: InsertConversation): Promise<Conversation>;
  getConversations(visitorId: string): Promise<Conversation[]>;
  getConversation(id: number): Promise<Conversation | undefined>;
  updateConversationTitle(id: number, title: string): Promise<void>;
  deleteConversation(id: number): Promise<void>;
  addMessage(msg: InsertMessage): Promise<Message>;
  getMessages(conversationId: number): Promise<Message[]>;
  addRagDocument(doc: InsertRagDocument): Promise<RagDocument>;
  getRagDocuments(visitorId: string): Promise<RagDocument[]>;
  addRagChunks(chunks: InsertRagChunk[]): Promise<void>;
  searchRagChunks(query: string, limit?: number): Promise<RagChunk[]>;
}

export class DatabaseStorage implements IStorage {
  async createBirthProfile(profile: InsertBirthProfile): Promise<BirthProfile> {
    return db.insert(birthProfiles).values(profile).returning().get();
  }
  async getBirthProfiles(visitorId: string): Promise<BirthProfile[]> {
    return db.select().from(birthProfiles).where(eq(birthProfiles.visitorId, visitorId)).all();
  }
  async getBirthProfile(id: number): Promise<BirthProfile | undefined> {
    return db.select().from(birthProfiles).where(eq(birthProfiles.id, id)).get();
  }

  async createConversation(conv: InsertConversation): Promise<Conversation> {
    return db.insert(conversations).values(conv).returning().get();
  }
  async getConversations(visitorId: string): Promise<Conversation[]> {
    return db.select().from(conversations)
      .where(eq(conversations.visitorId, visitorId))
      .orderBy(desc(conversations.id))
      .all();
  }
  async getConversation(id: number): Promise<Conversation | undefined> {
    return db.select().from(conversations).where(eq(conversations.id, id)).get();
  }
  async updateConversationTitle(id: number, title: string): Promise<void> {
    db.update(conversations).set({ title }).where(eq(conversations.id, id)).run();
  }
  async deleteConversation(id: number): Promise<void> {
    db.delete(messages).where(eq(messages.conversationId, id)).run();
    db.delete(conversations).where(eq(conversations.id, id)).run();
  }

  async addMessage(msg: InsertMessage): Promise<Message> {
    return db.insert(messages).values(msg).returning().get();
  }
  async getMessages(conversationId: number): Promise<Message[]> {
    return db.select().from(messages)
      .where(eq(messages.conversationId, conversationId))
      .all();
  }

  async addRagDocument(doc: InsertRagDocument): Promise<RagDocument> {
    return db.insert(ragDocuments).values(doc).returning().get();
  }
  async getRagDocuments(visitorId: string): Promise<RagDocument[]> {
    return db.select().from(ragDocuments)
      .where(eq(ragDocuments.visitorId, visitorId))
      .all();
  }
  async addRagChunks(chunks: InsertRagChunk[]): Promise<void> {
    for (const chunk of chunks) {
      db.insert(ragChunks).values(chunk).run();
    }
  }
  searchRagChunks(query: string, limit = 5): Promise<RagChunk[]> {
    const terms = query.split(/\s+/).filter(t => t.length > 2).map(t => `"${t}"`).join(" OR ");
    if (!terms) return Promise.resolve([]);
    try {
      const rows = sqlite.prepare(`
        SELECT rc.id, rc.document_id as documentId, rc.content, rc.chunk_index as chunkIndex
        FROM rag_chunks_fts fts
        JOIN rag_chunks rc ON rc.id = fts.rowid
        WHERE rag_chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(terms, limit) as RagChunk[];
      return Promise.resolve(rows);
    } catch {
      return Promise.resolve([]);
    }
  }
}

export const storage = new DatabaseStorage();
