export type NodeId = number;

export type MessagePayload = {
  id: string;
  role: string;
  content: string;
  timestamp: string;
};

export type Entity = {
  name: string;
  entity_type: string;
  attributes: Record<string, string>;
};

export type Relationship = {
  from: string;
  to: string;
  relationship_type: string;
};

export type Visibility = "Shared" | "Private";


export type MemoryCommand =
  | { kind: "AddMessage"; session_id: string; message: MessagePayload }
  | { kind: "AddFact"; session_id: string; fact: string }
  | { kind: "DeleteSession"; session_id: string }
  | {
      kind: "AddKnowledge";
      session_id: string;
      message_id: string;
      entities: Entity[];
      relationships: Relationship[];
    }
  | { kind: "SetSessionVisibility"; session_id: string; visibility: Visibility }
  | { kind: "RegisterSession"; session_id: string; agent_id?: string }
  | { kind: "ApplyFeedback"; session_id: string; memory_id: string; new_score: number }
  | {
      kind: "ApplySummary";
      session_id: string;
      summary_id: string;
      summary_text: string;
      consumed_message_ids: string[];
      model: string;
      prompt_version: string;
    }
  | { kind: "CreateCheckpoint"; session_id: string; name: string; at_index: number }
  | { kind: "NoOp" };

export type LogId = {
  term: number;
  index: number;
};

export type LogEntry = {
  logId: LogId;
  command: MemoryCommand;
};

export type SnapshotMeta = {
  lastLogId: LogId;
  snapshotId: string;
};







