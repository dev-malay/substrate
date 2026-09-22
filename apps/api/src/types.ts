export type Role = "user" | "assistant" | "system";


export type Session = {
  id: string;
  createdAt: string;
};

export type Message = {
  id: string;
  sessionId: string;
  role: Role;
  content: string;
  createdAt: string;
};
