export type Role = "user" | "assistant" | "system";

export type EmbeddingStatus = "pending" | "processing" | "completed" | "failed";

export type Session = {
  id: string;
  createdAt: string;
  agentId?: string;
};

export type Message = {
  id: string;
  sessionId: string;
  role: Role;
  content: string;
  timestamp: string;
  embeddingStatus?: EmbeddingStatus;
};

export type CreateSessionBody = {
  agent_id?: string;
};

export type AddMessageBody = {
  id?: string;
  role?: string;
  content?: string;
  timestamp?: string;
};

export type SearchBody = {
  query?: string;
  top_k?: number;
};

export type SearchResult = {
  memory_id: string;
  text: string;
  score: number;
};

export type ContextResult = {
  context: string;
  query_id: string;
};

export type CoreMemoryBody = {
  fact?: string;
};
