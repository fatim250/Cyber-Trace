import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const PRIMARY_MODEL = "gemini-4-hydrogen";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";

const SYSTEM_INSTRUCTION = `You are the CyberTrace AI Investigation Assistant supporting digital forensics (DFIR), incident response (IR), and SOC engineering teams.

Operating rules:
1. Ground all answers in the provided CyberTrace workspace data and any logs or artifacts supplied by the engineer.
2. Clearly separate observed/recorded facts (case records, verified SHA-256 checks, logged events) from analytical hypotheses or recommended next steps.
3. Never invent case numbers, IP addresses, SHA-256 hashes, timestamps, or log lines not present in the context or user input.
4. Provide concise, actionable technical guidance structured with clear headings or bullet points (triage priorities, containment checks, forensic acquisition/verification steps, IOC pivots, and handoff notes).
5. Defensive security posture only: help engineers trace, investigate, verify integrity, contain, and document incidents.
6. Identity: You are the CyberTrace AI Investigation Assistant assisting the active human analyst. Never claim to be the human analyst.`;

function resolveApiKey() {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.AI_assistan?.trim() ||
    process.env.AI_ASSISTANT?.trim() ||
    process.env.AI_ASSISTANT_API_KEY?.trim() ||
    ""
  );
}

export function getAssistantStatus() {
  return {
    configured: Boolean(resolveApiKey()),
    model: PRIMARY_MODEL,
  };
}

function getClient() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    const err = new Error(
      "AI Investigation Assistant key is not configured on the server. Add GEMINI_API_KEY in Settings > Secrets.",
    );
    err.statusCode = 503;
    err.code = "ai_not_configured";
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function extractReadableMessage(raw) {
  let current = typeof raw === "string" ? raw.trim() : "AI assistant request failed.";
  for (let depth = 0; depth < 3; depth++) {
    if (!current.startsWith("{")) break;
    try {
      const parsed = JSON.parse(current);
      if (parsed?.error?.message) {
        current = String(parsed.error.message).trim();
        continue;
      }
      if (parsed?.message) {
        current = String(parsed.message).trim();
        continue;
      }
      break;
    } catch {
      break;
    }
  }
  return current;
}

async function withRetryAndFallback(fn, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(PRIMARY_MODEL);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || error?.statusCode);
      if (status && status < 500 && status !== 429) {
        throw error;
      }
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 450 * (i + 1)));
      }
    }
  }

  const finalStatus = Number(lastError?.status || lastError?.statusCode);
  if (finalStatus === 429 || finalStatus === 503 || finalStatus === 504 || finalStatus === 500) {
    return fn(FALLBACK_MODEL);
  }
  throw lastError;
}

export function formatGeminiError(error) {
  const status = Number(error?.status || error?.statusCode) || 500;
  const readable = extractReadableMessage(error?.message);

  if (error?.code === "ai_not_configured") {
    return { status: 503, code: "ai_not_configured", message: readable };
  }
  if (status === 400 || status === 403 || readable.includes("API_KEY") || readable.includes("PERMISSION_DENIED")) {
    return {
      status,
      code: "ai_auth_error",
      message: "Gemini API key was rejected or invalid. Please verify your API key in Settings > Secrets.",
    };
  }
  if (status === 404 || readable.includes("NOT_FOUND")) {
    return {
      status: 404,
      code: "ai_model_not_found",
      message: `Requested Gemini model was not found or is unavailable for this key.`,
    };
  }
  if (status === 429 || readable.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      code: "ai_rate_limited",
      message: "Gemini API quota or rate limit exceeded. Please retry shortly or check your quota in Settings > Secrets.",
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: status === 503 ? "ai_temporarily_unavailable" : "ai_error",
    message: readable,
  };
}

export async function streamAssistantChat({ messages, contextText, actor }) {
  const ai = getClient();
  const normalizedContents = messages
    .filter((msg) => msg && typeof msg.content === "string" && msg.content.trim())
    .map((msg) => ({
      role: msg.role === "assistant" || msg.role === "model" ? "model" : "user",
      parts: [{ text: msg.content.trim() }],
    }));

  if (normalizedContents.length === 0) {
    const err = new Error("At least one user message is required.");
    err.statusCode = 422;
    throw err;
  }

  const systemInstruction = `${SYSTEM_INSTRUCTION}

Active CyberTrace Analyst: ${actor || "DFIR Engineer"}
Current Workspace / Case Context (JSON):
${contextText}`;

  return withRetryAndFallback((model) =>
    ai.models.generateContentStream({
      model,
      contents: normalizedContents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    }),
  );
}

export async function analyzeWithAssistant({ mode, input, contextText, actor }) {
  const ai = getClient();

  const prompt =
    mode === "logs"
      ? `Analyze the following raw security/forensic logs or artifact excerpt for a cyber engineer. Extract any observable IOCs, summarize what occurred, assess severity, map relevant defensive/MITRE concepts if evident, and provide concrete next investigation steps.\n\nArtifact/Log Input:\n${input}`
      : `Provide a structured forensic triage and action brief for the active CyberTrace investigation context. Identify evidence integrity gaps, key IOCs, timeline priorities, and immediate next steps for the team.\n\nEngineer Focus Note:\n${input || "Full case triage and next investigation actions."}`;

  const response = await withRetryAndFallback((model) =>
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: `${SYSTEM_INSTRUCTION}\n\nActive Analyst: ${actor || "DFIR Engineer"}\nWorkspace Context:\n${contextText}`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: "Concise technical summary grounded strictly in supplied data.",
            },
            severityAssessment: {
              type: Type.STRING,
              description: "One of LOW, MEDIUM, HIGH, or CRITICAL with a brief justification.",
            },
            suspectedTechniques: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Relevant defensive threat patterns or MITRE ATT&CK techniques observed.",
            },
            extractedIocs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "ip, domain, hash, user, or host" },
                  value: { type: Type.STRING },
                  context: { type: Type.STRING },
                },
                required: ["type", "value", "context"],
              },
            },
            recommendedNextSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Prioritized next forensic, verification, or containment actions.",
            },
          },
          required: [
            "summary",
            "severityAssessment",
            "suspectedTechniques",
            "extractedIocs",
            "recommendedNextSteps",
          ],
        },
      },
    }),
  );

  const rawText = (response.text ?? "{}").trim();
  return JSON.parse(rawText);
}
