import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LogEntry, MemoryCommand } from "./types.js";

export class LogStore {
  private db: Database;

  constructor(path: string) {
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {}
    this.db = new Database(path, { create: true });
    this.db.run(
      "CREATE TABLE IF NOT EXISTS entries (idx INTEGER PRIMARY KEY, term INTEGER NOT NULL, data TEXT NOT NULL)",
    );
    this.db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

  }

  append(term: number, command: MemoryCommand): number {
    const last = this.lastIndex();
    const index = last + 1;
    this.db.run("INSERT INTO entries (idx, term, data) VALUES (?, ?, ?)", [
      index,
      term,
      JSON.stringify(command),
    ]);
    return index;
  }


  get(index: number): LogEntry | undefined {
    const row = this.db
      .query("SELECT idx, term, data FROM entries WHERE idx = ?")
      .get(index) as { idx: number; term: number; data: string } | null;
    if (!row) return undefined;
    return {
      logId: { term: row.term, index: row.idx },
      command: JSON.parse(row.data) as MemoryCommand
    };
  }

  entriesIn(after: number, upTo: number): LogEntry[] {
    const rows = this.db
      .query("SELECT idx, term, data FROM entries WHERE idx > ? AND idx <= ? ORDER BY idx ASC")
      .all(after, upTo) as Array<{ idx: number; term: number; data: string }>;
    return rows.map((row) => ({
      logId: { term: row.term, index: row.idx },
      command: JSON.parse(row.data) as MemoryCommand
    }))
  }

  lastIndex(): number {
    const row = this.db.query("SELECT MAX(idx) AS m FROM entries").get() as {
      m: number | null;
    }; return row.m || 0;
  }

  lastTerm(): number {
    const row = this.db
      .query("SELECT term FROM entries ORDER BY idx DESC LIMIT 1")
      .get() as { term: number } | null;
    return row ? row.term : 0;
  }

  saveVote(term: number, votedFor: number | null) {
    this.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('vote', ?)", [
      JSON.stringify({ term, votedFor }),
    ]);
  }

  loadVote(): { term: number; votedFor: number | null } {
    const row = this.db.query("SELECT value FROM meta WHERE key = 'vote'").get() as {
      value: string;
    } | null;
    if (!row) return { term: 0, votedFor: null };
    return JSON.parse(row.value) as { term: number; votedFor: number | null };
  }

  saveCommitted(index: number) {
    this.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('committed', ?)", [
      String(index),
    ]);
  }

  loadCommitted(): number {
    const row = this.db.query("SELECT value FROM meta WHERE key = 'committed'").get() as {
      value: string;
    } | null;
    return row ? Number(row.value) : 0;
  }

  purge(upTo: number, floor: number) {
    const capped = Math.min(upTo, Math.max(0, floor - 1));
    if (capped <= 0) return;
    this.db.run("DELETE FROM entries WHERE idx <= ?", [capped]);
  }
  
}


