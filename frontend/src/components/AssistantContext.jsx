import { createContext, useCallback, useContext, useState } from "react";
import { getActiveAnalyst, setActiveAnalyst } from "../services/workspaceApi.js";

export const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content:
    "CyberTrace AI Investigation Assistant is connected and grounded in live workspace telemetry. Select a case scope, attach raw logs or artifact snippets if needed, and ask a forensic question or run Structured Triage.",
};

const AssistantContext = createContext(null);

export function AssistantProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [extraContext, setExtraContext] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [autoSendRequest, setAutoSendRequest] = useState(null);
  const [activeTab, setActiveTab] = useState("chat");
  const [activeAnalyst, setAnalystState] = useState(() => getActiveAnalyst());

  // Shared session state across Drawer and /assistant Workbench
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [triageMode, setTriageMode] = useState("case");
  const [triageInput, setTriageInput] = useState("");
  const [triageResult, setTriageResult] = useState(null);

  const openAssistant = useCallback((options = {}) => {
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
  }, []);

  const closeAssistant = useCallback(() => {
    setIsOpen(false);
  }, []);

  const clearAutoSend = useCallback(() => {
    setAutoSendRequest(null);
  }, []);

  const switchAnalyst = useCallback((name) => {
    setActiveAnalyst(name);
    setAnalystState(name);
  }, []);

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
        switchAnalyst,
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
