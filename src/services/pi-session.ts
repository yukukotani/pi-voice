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

export interface PromptOptions {
  /** Called each time a text block completes (text_end event). */
  onTextEnd?: (segment: string) => void | Promise<void>;
}

/**
 * Send a prompt to pi.
 * `onTextEnd` is called for each completed text segment so callers can
 * start TTS incrementally without waiting for the full response.
 */
export async function prompt(
  text: string,
  options?: PromptOptions,
): Promise<void> {
  const s = await getOrCreateSession();

  const unsubscribe = s.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_end"
    ) {
      const content = event.assistantMessageEvent.content.trim();
      if (content.length > 0) {
        console.log(`[PiSession] Response: ${content}`);
        options?.onTextEnd?.(content);
      }
    }
  });

  try {
    await s.prompt(text);
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
