import {
  createAgentSession,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";

let session: AgentSession | null = null;

/**
 * Initialize (or reuse) a pi coding agent session.
 * Uses default discovery for skills, extensions, tools, context files.
 */
export async function getOrCreateSession(): Promise<AgentSession> {
  if (session) return session;

  console.log("[PiSession] Creating new agent session...");
  const result = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
  });
  session = result.session;
  console.log("[PiSession] Session created");
  return session;
}

/**
 * Send a prompt to pi and collect the full response text.
 */
export async function prompt(text: string): Promise<string> {
  const s = await getOrCreateSession();

  let responseText = "";

  // Subscribe to collect text deltas
  const unsubscribe = s.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      responseText += event.assistantMessageEvent.delta;
    }
  });

  try {
    await s.prompt(text);
    return responseText.trim();
  } finally {
    unsubscribe();
  }
}

/**
 * Dispose the current session.
 */
export function dispose(): void {
  if (session) {
    session.dispose();
    session = null;
    console.log("[PiSession] Session disposed");
  }
}
