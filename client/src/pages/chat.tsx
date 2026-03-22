import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Send, Plus, MessageSquare, Trash2, User, Bot, ChevronDown, ChevronUp,
  Sparkles, BookOpen, Upload, Moon, Sun, Menu, X,
  Stars, Orbit, Heart
} from "lucide-react";
import { BirthProfileDialog } from "@/components/BirthProfileDialog";
import { RagUploadDialog } from "@/components/RagUploadDialog";
import { CompatibilityDialog } from "@/components/CompatibilityDialog";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import type { Conversation, Message, BirthProfile } from "@shared/schema";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export default function ChatPage() {
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  const [showProfileDialog, setShowProfileDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showMatchDialog, setShowMatchDialog] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDark, setIsDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Queries
  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });

  const { data: profiles = [] } = useQuery<BirthProfile[]>({
    queryKey: ["/api/profiles"],
  });

  const { data: chatMessages = [], refetch: refetchMessages } = useQuery<Message[]>({
    queryKey: ["/api/conversations", activeConversationId, "messages"],
    enabled: !!activeConversationId,
    queryFn: async () => {
      if (!activeConversationId) return [];
      const res = await apiRequest("GET", `/api/conversations/${activeConversationId}/messages`);
      return res.json();
    },
  });

  // Mutations
  const createConversation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/conversations", {
        title: "New Conversation",
        profileId: activeProfileId,
      });
      return res.json();
    },
    onSuccess: (data: Conversation) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      setActiveConversationId(data.id);
    },
  });

  const deleteConversation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/conversations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      if (conversations.length > 1) {
        setActiveConversationId(conversations.find(c => c.id !== activeConversationId)?.id || null);
      } else {
        setActiveConversationId(null);
      }
    },
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages, streamingContent, scrollToBottom]);

  // Stream chat response
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    let convId = activeConversationId;
    if (!convId) {
      const res = await apiRequest("POST", "/api/conversations", {
        title: "New Conversation",
        profileId: activeProfileId,
      });
      const conv = await res.json();
      convId = conv.id;
      setActiveConversationId(conv.id);
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
    }

    const userMessage = input.trim();
    setInput("");
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingReasoning("");

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          message: userMessage,
          profileId: activeProfileId,
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === "reasoning") {
                  setStreamingReasoning(data.content);
                } else if (data.type === "content") {
                  setStreamingContent((prev) => prev + data.content);
                } else if (data.type === "done") {
                  // Refetch messages and conversations
                  await refetchMessages();
                  queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
                }
              } catch {}
            }
          }
        }
      }
    } catch (e) {
      console.error("Chat error:", e);
    } finally {
      setIsStreaming(false);
      setStreamingContent("");
      setStreamingReasoning("");
    }
  }, [input, isStreaming, activeConversationId, activeProfileId, queryClient, refetchMessages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const activeProfile = profiles.find(p => p.id === activeProfileId);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? "w-72" : "w-0"} transition-all duration-300 border-r border-border bg-sidebar flex flex-col overflow-hidden shrink-0`}
      >
        <div className="p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Stars className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm" data-testid="text-app-name">JyotishGPT</span>
          </div>
          <Button
            onClick={() => createConversation.mutate()}
            className="w-full justify-start gap-2"
            variant="outline"
            size="sm"
            data-testid="button-new-conversation"
          >
            <Plus className="w-4 h-4" />
            New Conversation
          </Button>
        </div>

        <ScrollArea className="flex-1 custom-scrollbar">
          <div className="p-2">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                  conv.id === activeConversationId
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground"
                }`}
                onClick={() => setActiveConversationId(conv.id)}
                data-testid={`button-conversation-${conv.id}`}
              >
                <MessageSquare className="w-4 h-4 shrink-0 opacity-60" />
                <span className="truncate flex-1">{conv.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); deleteConversation.mutate(conv.id); }}
                  data-testid={`button-delete-conversation-${conv.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Sidebar footer */}
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => setShowProfileDialog(true)}
            data-testid="button-birth-profile"
          >
            <Orbit className="w-3.5 h-3.5" />
            Birth Profiles ({profiles.length})
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => setShowUploadDialog(true)}
            data-testid="button-upload-books"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Upload Books (RAG)
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => setShowMatchDialog(true)}
            data-testid="button-compatibility"
          >
            <Heart className="w-3.5 h-3.5" />
            Kundali Matching
          </Button>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-card shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="p-1.5"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              data-testid="button-toggle-sidebar"
            >
              {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </Button>
            <div>
              <h1 className="text-sm font-semibold" data-testid="text-page-title">JyotishGPT</h1>
              <p className="text-xs text-muted-foreground">Vedic Astrology AI Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeProfile && (
              <Badge variant="secondary" className="text-xs" data-testid="badge-active-profile">
                <Sparkles className="w-3 h-3 mr-1" />
                {activeProfile.name}
              </Badge>
            )}
            {profiles.length > 0 && (
              <select
                className="text-xs bg-secondary border-none rounded px-2 py-1 text-secondary-foreground"
                value={activeProfileId || ""}
                onChange={(e) => setActiveProfileId(e.target.value ? Number(e.target.value) : null)}
                data-testid="select-profile"
              >
                <option value="">No profile</option>
                {profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1.5"
                  onClick={() => setIsDark(!isDark)}
                  data-testid="button-toggle-theme"
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle theme</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto px-4 py-6">
            {!activeConversationId && chatMessages.length === 0 && !isStreaming && (
              <WelcomeScreen
                onStartChat={() => {
                  if (!activeConversationId) createConversation.mutate();
                }}
                hasProfile={profiles.length > 0}
                onAddProfile={() => setShowProfileDialog(true)}
              />
            )}

            {chatMessages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                showReasoning={showReasoning}
                onToggleReasoning={() => setShowReasoning(!showReasoning)}
              />
            ))}

            {/* Streaming message */}
            {isStreaming && (
              <div className="mb-6">
                {streamingReasoning && (
                  <div className="mb-2 ml-10">
                    <button
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
                      onClick={() => setShowReasoning(!showReasoning)}
                      data-testid="button-toggle-streaming-reasoning"
                    >
                      <Sparkles className="w-3 h-3" />
                      Chain of Thought
                      {showReasoning ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                    {showReasoning && (
                      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 border border-border/50">
                        {streamingReasoning}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 text-sm leading-relaxed chat-markdown">
                    <MarkdownContent content={streamingContent} />
                    {streamingContent.length === 0 && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <div className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                        <span className="text-xs">Analyzing the stars...</span>
                      </div>
                    )}
                    {streamingContent.length > 0 && <span className="typing-cursor" />}
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="border-t border-border bg-card p-4 shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={activeProfileId
                  ? "Ask about your birth chart, planets, dashas, yogas..."
                  : "Ask a Vedic astrology question, or set a birth profile first..."
                }
                className="min-h-[44px] max-h-[160px] resize-none text-sm"
                rows={1}
                data-testid="input-chat-message"
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || isStreaming}
                size="sm"
                className="h-[44px] px-4"
                data-testid="button-send-message"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Vedic astrology provides guidance, not deterministic predictions. Results based on classical Jyotish principles.
            </p>
          </div>
        </div>
        <PerplexityAttribution />
      </main>

      {/* Dialogs */}
      <BirthProfileDialog
        open={showProfileDialog}
        onOpenChange={setShowProfileDialog}
        onProfileCreated={(profile) => setActiveProfileId(profile.id)}
      />
      <RagUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
      />
      <CompatibilityDialog
        open={showMatchDialog}
        onOpenChange={setShowMatchDialog}
      />
    </div>
  );
}

// Chat message component
function ChatMessage({
  message,
  showReasoning,
  onToggleReasoning,
}: {
  message: Message;
  showReasoning: boolean;
  onToggleReasoning: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className="mb-6" data-testid={`message-${message.id}`}>
      {!isUser && message.reasoning && (
        <div className="mb-2 ml-10">
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
            onClick={onToggleReasoning}
            data-testid={`button-toggle-reasoning-${message.id}`}
          >
            <Sparkles className="w-3 h-3" />
            Chain of Thought
            {showReasoning ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showReasoning && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 border border-border/50">
              {message.reasoning}
            </div>
          )}
        </div>
      )}
      <div className="flex gap-3">
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            isUser ? "bg-secondary" : "bg-primary/10"
          }`}
        >
          {isUser ? <User className="w-4 h-4 text-secondary-foreground" /> : <Bot className="w-4 h-4 text-primary" />}
        </div>
        <div className={`flex-1 text-sm leading-relaxed ${isUser ? "" : "chat-markdown"}`}>
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>
      </div>
      {!isUser && message.ragContext && (
        <div className="ml-10 mt-1">
          <Badge variant="outline" className="text-xs gap-1">
            <BookOpen className="w-3 h-3" />
            RAG references used
          </Badge>
        </div>
      )}
    </div>
  );
}

// Simple markdown renderer
function MarkdownContent({ content }: { content: string }) {
  // Simple markdown to HTML conversion
  const html = content
    .replace(/### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/# (.*?)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/^\- (.*?)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.*?)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  return <div dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}

// Welcome screen
function WelcomeScreen({
  onStartChat,
  hasProfile,
  onAddProfile,
}: {
  onStartChat: () => void;
  hasProfile: boolean;
  onAddProfile: () => void;
}) {
  const suggestions = [
    "What are the main yogas in my birth chart?",
    "Tell me about my Moon sign and its effects",
    "What does my current dasha period indicate?",
    "What career paths does my chart suggest?",
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
        <Stars className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold mb-2" data-testid="text-welcome-title">
        Welcome to JyotishGPT
      </h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Your AI Vedic Astrology assistant powered by classical Jyotish wisdom,
        VedAstro calculations, and chain-of-thought reasoning.
      </p>

      {!hasProfile && (
        <Button
          variant="outline"
          className="mb-6 gap-2"
          onClick={onAddProfile}
          data-testid="button-add-first-profile"
        >
          <Orbit className="w-4 h-4" />
          Add Your Birth Details First
        </Button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
        {suggestions.map((s, i) => (
          <button
            key={i}
            className="text-left text-xs p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
            onClick={onStartChat}
            data-testid={`button-suggestion-${i}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
