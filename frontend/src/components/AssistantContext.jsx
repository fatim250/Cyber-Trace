import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAuth } from "./AuthContext.jsx";

export const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content:
    "CyberTrace AI Investigation Assistant is ready and grounded in your organization's live cases, evidence hashes, and timeline telemetry. Select a case scope, attach raw logs if needed, and ask a forensic question or run Structured Triage.",
};

function makeThread(caseId = "", title = "New investigation thread") {
  const now = Date.now();
  return {
    id: `th-${now}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    caseId,
    messages: [WELCOME_MESSAGE],
    updatedAt: now,
  };
}

function readStoredThreads(storageKey) {
  if (!storageKey) return [makeThread()];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [makeThread()];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter(
        (t) => t && typeof t.id === "string" && Array.isArray(t.messages) && t.messages.length > 0,
      );
    }
  } catch {
    // Ignore storage read errors
  }
  return [makeThread()];
}

const AssistantContext = createContext(null);

export function AssistantProvider({ children }) {
  const { profile } = useAuth();
  const storageKey = profile
    ? `cybertrace.aiThreads.${profile.organizationId}.${profile.uid}`
    : null;

  const [isOpen, setIsOpen] = useState(false);
  const [threads, setThreads] = useState(() => [makeThread()]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [caseId, setCaseIdState] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [autoSendRequest, setAutoSendRequest] = useState(null);
  const [activeTab, setActiveTab] = useState("chat");

  const [triageMode, setTriageMode] = useState("case");
  const [triageInput, setTriageInput] = useState("");
  const [triageResult, setTriageResult] = useState(null);

  // Hydrate user/org-scoped saved threads whenever authenticated profile changes
  useEffect(() => {
    const loaded = readStoredThreads(storageKey);
    const safeThreads = loaded.length > 0 ? loaded : [makeThread()];
    setThreads(safeThreads);
    setActiveThreadId(safeThreads[0].id);
    setCaseIdState(safeThreads[0].caseId || "");
  }, [storageKey]);

  // Persist threads to localStorage
  useEffect(() => {
    if (!storageKey || threads.length === 0) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(threads.slice(0, 25)));
    } catch {
      // Ignore storage quota errors
    }
  }, [storageKey, threads]);

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || threads[0] || makeThread(),
    [threads, activeThreadId],
  );

  const messages = activeThread.messages;

  const setCaseId = useCallback(
    (nextCaseId) => {
      setCaseIdState(nextCaseId);
      setThreads((prev) =>
        prev.map((t) => (t.id === activeThread.id ? { ...t, caseId: nextCaseId } : t)),
      );
    },
    [activeThread.id],
  );

  const setMessages = useCallback(
    (updater) => {
      setThreads((prev) =>
        prev.map((thread) => {
          if (thread.id !== activeThread.id) return thread;
          const nextMessages =
            typeof updater === "function" ? updater(thread.messages) : updater;
          const firstUserMsg = nextMessages.find((m) => m.role === "user" && m.content?.trim());
          const nextTitle =
            thread.title === "New investigation thread" && firstUserMsg
              ? firstUserMsg.content.trim().slice(0, 52)
              : thread.title;
          return {
            ...thread,
            title: nextTitle,
            messages: nextMessages,
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [activeThread.id],
  );

  const createNewThread = useCallback((initialCaseId = caseId) => {
    const fresh = makeThread(initialCaseId);
    setThreads((prev) => [fresh, ...prev].slice(0, 25));
    setActiveThreadId(fresh.id);
    setCaseIdState(initialCaseId);
    return fresh;
  }, [caseId]);

  const selectThread = useCallback(
    (threadId) => {
      const target = threads.find((t) => t.id === threadId);
      if (!target) return;
      setActiveThreadId(target.id);
      setCaseIdState(target.caseId || "");
    },
    [threads],
  );

  const deleteThread = useCallback(
    (threadId) => {
      setThreads((prev) => {
        const remaining = prev.filter((t) => t.id !== threadId);
        if (remaining.length === 0) {
          const fresh = makeThread(caseId);
          setActiveThreadId(fresh.id);
          return [fresh];
        }
        if (threadId === activeThread.id) {
          setActiveThreadId(remaining[0].id);
          setCaseIdState(remaining[0].caseId || "");
        }
        return remaining;
      });
    },
    [activeThread.id, caseId],
  );

  const openAssistant = useCallback(
    (options = {}) => {
      if (options.caseId !== undefined) setCaseId(options.caseId);
      if (options.extraContext !== undefined) setExtraContext(options.extraContext);
      if (options.tab) setActiveTab(options.tab);
      else if (options.prompt) setActiveTab("chat");

      if (options.prompt) {
        if (options.autoSend === false) {
          setDraftPrompt(options.prompt);
        } else {
          setAutoSendRequest({
            id: Date.now() + Math.random(),
            prompt: options.prompt,
            caseId: options.caseId,
            extraContext: options.extraContext,
          });
        }
      }
      setIsOpen(true);
    },
    [setCaseId],
  );

  const closeAssistant = useCallback(() => {
    setIsOpen(false);
  }, []);

  const clearAutoSend = useCallback(() => {
    setAutoSendRequest(null);
  }, []);

  const activeAnalyst = profile?.displayName || "Investigator";

  return (
    <AssistantContext.Provider
      value={{
        isOpen,
        caseId,
        setCaseId,
        extraContext,
        setExtraContext,
        draftPrompt,
        setDraftPrompt,
        autoSendRequest,
        clearAutoSend,
        activeTab,
        setActiveTab,
        openAssistant,
        closeAssistant,
        activeAnalyst,
        threads,
        activeThreadId: activeThread.id,
        createNewThread,
        selectThread,
        deleteThread,
        messages,
        setMessages,
        triageMode,
        setTriageMode,
        triageInput,
        setTriageInput,
        triageResult,
        setTriageResult,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error("useAssistant must be used inside AssistantProvider");
  }
  return ctx;
}
