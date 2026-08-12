'use client';

import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
  MessageFooter,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  MessageScrollerProvider,
} from "@/components/ui/message-scroller";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  MessageSquare,
  Paperclip,
  FileText,
  Download,
  User as UserIcon,
  Mic,
  Square,
  Loader2,
  Send,
  Sparkles,
  X,
  ShieldCheck,
  Zap,
  BrainCircuit
} from "lucide-react";
import { toast } from "sonner";
import { getStoredUser, type AuthUser } from '@/lib/auth-api';
import { ThemeToggle } from '@/components/theme-provider';
import { simulateMessage, blobToBase64, SimulateApiError, type SimulateReply, getStoredAiProvider, setStoredAiProvider, type AiProvider, AI_PROVIDER_KEY } from '@/lib/simulate-api';
import { cn } from "@/lib/utils";

type DeliveryStatus = 'sending' | 'sent' | 'error';

interface BaseMsg {
  id: string;
  timestamp: string;
}

type ChatMsg =
  | (BaseMsg & { sender: 'user'; kind: 'text'; text: string; status: DeliveryStatus })
  | (BaseMsg & {
    sender: 'user';
    kind: 'upload';
    filename: string;
    mimeType: string;
    previewUrl?: string;
    downloadUrl?: string;
    status: DeliveryStatus;
  })
  | (BaseMsg & { sender: 'user'; kind: 'voice'; audioUrl: string; durationSec: number; status: DeliveryStatus })
  | (BaseMsg & { sender: 'assistant'; kind: 'text'; text: string })
  | (BaseMsg & { sender: 'assistant'; kind: 'transcript'; text: string })
  | (BaseMsg & { sender: 'assistant'; kind: 'error'; text: string })
  | (BaseMsg & { sender: 'assistant'; kind: 'voice'; audioUrl: string; durationSec: number })
  | (BaseMsg & {
    sender: 'assistant';
    kind: 'document';
    filename: string;
    mimeType: string;
    caption: string;
    downloadUrl: string;
  });

const SUPPORTED_UPLOAD_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/heic';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ChatSimulator() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [composerValue, setComposerValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  // OpenAI is the default — always falls back to 'openai' if localStorage is empty
  const [aiProvider, setAiProvider] = useState<AiProvider>('openai');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-resize textarea on composerValue change
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, [composerValue]);


  useEffect(() => {
    setMounted(true);
    // Restore persisted provider preference — default is always 'openai'
    setAiProvider(getStoredAiProvider());
    const user = getStoredUser();
    if (!user) {
      router.push('/login');
      return;
    }
    setCurrentUser(user);
    setWhatsappNumber(user.whatsappNumber);

    // Sync AI provider from localStorage across tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === AI_PROVIDER_KEY) {
        setAiProvider(getStoredAiProvider());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [router]);

  function handleSetAiProvider(provider: AiProvider) {
    setAiProvider(provider);
    setStoredAiProvider(provider);
    toast.success(`AI provider switched to ${provider === 'openai' ? 'OpenAI GPT-4o Mini' : 'AI Gateway (DeepSeek)'}`);
  }

  // Restore stored chat history when whatsappNumber changes
  useEffect(() => {
    if (typeof window === 'undefined' || !whatsappNumber) return;

    // 1. Try to load from localStorage cache first for fast initial load
    let loaded = false;
    const raw = localStorage.getItem(`magic-vault-chat-${whatsappNumber}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
          loaded = true;
        }
      } catch {
        // ignore parse error
      }
    }
    if (!loaded) {
      setMessages([]);
    }

    // 2. Fetch fresh chat history from Convex database
    fetch(`/api/simulate/chat?whatsappNumber=${encodeURIComponent(whatsappNumber)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setMessages(json.data);
          // Update cache
          localStorage.setItem(`magic-vault-chat-${whatsappNumber}`, JSON.stringify(json.data));
        }
      })
      .catch((err) => {
        console.error("Failed to load chat history from Convex", err);
      });
  }, [whatsappNumber]);

  // Save chat history to local cache when messages update
  useEffect(() => {
    if (typeof window === 'undefined' || !whatsappNumber) return;
    if (messages.length > 0) {
      localStorage.setItem(`magic-vault-chat-${whatsappNumber}`, JSON.stringify(messages));
    }
  }, [messages, whatsappNumber]);

  async function clearChatHistory() {
    setMessages([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`magic-vault-chat-${whatsappNumber}`);
    }

    try {
      const res = await fetch(`/api/simulate/chat?whatsappNumber=${encodeURIComponent(whatsappNumber)}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        toast.info(`Chat history cleared for ${whatsappNumber}`);
      } else {
        toast.error(json.error?.message || "Failed to clear chat history from database");
      }
    } catch (err) {
      console.error("Failed to clear chat from database", err);
      toast.error("Failed to clear chat history from database");
    }
  }

  function nextId(): string {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `local-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  function addMessage(msg: ChatMsg) {
    setMessages((prev) => [...prev, msg]);
  }

  // Delivery status updates
  function updateStatus(id: string, status: DeliveryStatus) {
    setMessages((prev) => prev.map((m) => (m.id === id && 'status' in m ? { ...m, status } : m)));
  }

  function appendReplies(replies: SimulateReply[]) {
    for (const reply of replies) {
      if (reply.type === 'text') {
        addMessage({ id: nextId(), sender: 'assistant', kind: 'text', text: reply.text, timestamp: new Date().toISOString() });
      } else if (reply.type === 'voice') {
        addMessage({
          id: nextId(),
          sender: 'assistant',
          kind: 'voice',
          audioUrl: reply.audioUrl,
          durationSec: reply.durationSec,
          timestamp: new Date().toISOString(),
        });
      } else {
        addMessage({
          id: nextId(),
          sender: 'assistant',
          kind: 'document',
          filename: reply.filename,
          mimeType: reply.mimeType,
          caption: reply.caption,
          downloadUrl: reply.downloadUrl,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  function reportError(id: string | null, error: unknown) {
    if (id) updateStatus(id, 'error');
    const message = error instanceof SimulateApiError ? error.message : 'Could not reach the Magic Vault backend.';
    toast.error(message);
    addMessage({ id: nextId(), sender: 'assistant', kind: 'error', text: message, timestamp: new Date().toISOString() });
  }

  async function handleSubmitText() {
    const text = composerValue.trim();
    if (!text) return;
    const id = nextId();
    addMessage({ id, sender: 'user', kind: 'text', text, timestamp: new Date().toISOString(), status: 'sending' });
    setComposerValue('');
    setIsAiLoading(true);
    try {
      const data = await simulateMessage({ kind: 'text', whatsappNumber, text, aiProvider });
      updateStatus(id, 'sent');
      appendReplies(data.replies);
    } catch (error) {
      reportError(id, error);
    } finally {
      setIsAiLoading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
    const id = nextId();
    addMessage({
      id,
      sender: 'user',
      kind: 'upload',
      filename: file.name,
      mimeType: file.type,
      previewUrl,
      timestamp: new Date().toISOString(),
      status: 'sending',
    });

    setIsAiLoading(true);
    try {
      const base64 = await blobToBase64(file);
      const data = await simulateMessage({
        kind: 'upload',
        whatsappNumber,
        file: { base64, mimeType: file.type, filename: file.name },
        aiProvider,
      });
      updateStatus(id, 'sent');
      appendReplies(data.replies);
    } catch (error) {
      reportError(id, error);
    } finally {
      setIsAiLoading(false);
    }
  }

  async function sendVoice(blob: Blob, durationSec: number) {
    const audioUrl = URL.createObjectURL(blob);
    const id = nextId();
    addMessage({
      id,
      sender: 'user',
      kind: 'voice',
      audioUrl,
      durationSec,
      timestamp: new Date().toISOString(),
      status: 'sending',
    });

    setIsAiLoading(true);
    try {
      const base64 = await blobToBase64(blob);
      const data = await simulateMessage({
        kind: 'voice',
        whatsappNumber,
        audio: { base64, mimeType: blob.type || 'audio/webm' },
        aiProvider,
      });
      updateStatus(id, 'sent');
      if (data.inbound.transcript) {
        addMessage({
          id: nextId(),
          sender: 'assistant',
          kind: 'transcript',
          text: data.inbound.transcript,
          timestamp: new Date().toISOString(),
        });
      }
      appendReplies(data.replies);
    } catch (error) {
      reportError(id, error);
    } finally {
      setIsAiLoading(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recordChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const durationSec = Math.round((Date.now() - recordStartRef.current) / 1000);
        const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        void sendVoice(blob, durationSec);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setRecordSeconds(0);
      setIsRecording(true);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds(Math.round((Date.now() - recordStartRef.current) / 1000));
      }, 250);
    } catch {
      toast.error('Microphone access denied or unavailable in this browser.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
  }



  function getStatusIcon(status: DeliveryStatus) {
    if (status === 'error') return <span className="text-red-500 text-xs">⚠️</span>;
    return null;
  }

  function renderMessage(msg: ChatMsg) {
    const isUser = msg.sender === 'user';
    const align = isUser ? 'end' : 'start';

    return (
      <Message key={msg.id} align={align} className="px-2 md:px-4 py-1">
        <MessageAvatar>
          <Avatar className="size-8">
            <AvatarFallback className={isUser ? "bg-primary text-primary-foreground text-xs" : "bg-emerald-500 text-white text-xs"}>
              {isUser ? <UserIcon className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </AvatarFallback>
          </Avatar>
        </MessageAvatar>
        <MessageContent>
          <MessageHeader className={`flex items-center gap-1.5 mb-0.5 ${isUser ? 'self-end' : 'self-start'}`}>
            <span className="font-semibold text-xs text-foreground">
              {isUser ? 'You' : 'Magic Vault'}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {formatTime(msg.timestamp)}
            </span>
          </MessageHeader>

          {/* Render Bubble Contents depending on message kind */}
          <div className={`flex flex-col gap-2 w-full max-w-[85%] ${isUser ? 'items-end self-end' : 'items-start self-start'}`}>
            {/* User - Text */}
            {isUser && msg.kind === 'text' && (
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-none px-4 py-2.5 text-sm shadow-sm break-words self-end">
                {msg.text}
              </div>
            )}

            {/* User - File Upload */}
            {isUser && msg.kind === 'upload' && (
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-none p-2 shadow-sm break-words self-end">
                {msg.mimeType?.startsWith('image/') && (msg.previewUrl || msg.downloadUrl) ? (
                  <div
                    className="cursor-zoom-in hover:opacity-90 transition-opacity"
                    onClick={() => setLightboxImage({ src: msg.previewUrl || msg.downloadUrl || '', alt: msg.filename })}
                  >
                    <LoadingImage
                      src={msg.previewUrl || msg.downloadUrl || ''}
                      alt={msg.filename}
                      className="rounded-lg object-cover max-w-full h-auto max-h-48"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1 bg-primary-foreground/10 rounded-lg">
                    <FileText className="h-5 w-5 shrink-0" />
                    <span className="text-xs break-all line-clamp-1">{msg.filename}</span>
                  </div>
                )}
              </div>
            )}

            {/* User - Voice message */}
            {isUser && msg.kind === 'voice' && (
              <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-none p-3 shadow-sm self-end">
                <div className="flex items-center gap-2 mb-1.5">
                  <Mic className="h-4 w-4 text-primary-foreground/75" />
                  <span className="text-xs font-medium">Voice message · {msg.durationSec}s</span>
                </div>
                <audio controls src={msg.audioUrl} className="h-8 max-w-[220px]" />
              </div>
            )}

            {/* Assistant - Voice note */}
            {!isUser && msg.kind === 'voice' && (
              <div className="bg-muted text-muted-foreground rounded-2xl rounded-tl-none p-3 shadow-sm self-start">
                <div className="flex items-center gap-2 mb-1.5 text-foreground">
                  <Mic className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs font-medium">Voice note · {msg.durationSec}s</span>
                </div>
                <audio controls src={msg.audioUrl} className="h-8 max-w-[220px]" />
              </div>
            )}

            {/* Assistant - Text, transcript, or error */}
            {!isUser && (msg.kind === 'text' || msg.kind === 'transcript' || msg.kind === 'error') && (() => {
              if (msg.kind === 'text') {
                // 1. Check for JSON structured details from backend
                const struct = parseStructuredDetails(msg.text);
                if (struct.isStructured) {
                  return (
                    <div className="bg-card border border-border/85 rounded-2xl rounded-tl-none p-4 shadow-sm w-full max-w-[325px] self-start flex flex-col gap-3 animate-fade-in">
                      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs border-b border-border pb-2">
                        <ShieldCheck className="h-4.5 w-4.5 shrink-0 text-emerald-500" />
                        <span>{struct.title}</span>
                      </div>

                      {struct.intro && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{struct.intro}</p>
                      )}

                      <div className="grid grid-cols-1 gap-2 bg-muted/20 p-3 rounded-xl border border-border/40">
                        {struct.fields.map((pair: { key: string; value: string }, idx: number) => {
                          const cleanKey = pair.key.replace(/\*\*/g, '').trim();
                          const cleanValue = pair.value.replace(/\*\*/g, '').trim();
                          return (
                            <div key={idx} className="flex flex-col gap-0.5 border-b border-border/20 last:border-0 pb-1.5 last:pb-0">
                              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">{cleanKey}</span>
                              <span className="text-xs font-semibold text-foreground break-all">{cleanValue}</span>
                            </div>
                          );
                        })}
                      </div>

                      {struct.outro && (
                        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/30 pt-2">{struct.outro}</p>
                      )}
                    </div>
                  );
                }

                // 2. Check for JSON document analysis from backend
                const analysis = parseDocumentAnalysis(msg.text);
                if (analysis.isAnalysis) {
                  return (
                    <div className="bg-card border border-border/85 rounded-2xl rounded-tl-none p-4 shadow-sm w-full max-w-[325px] self-start flex flex-col gap-3 animate-fade-in">
                      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs border-b border-border pb-2">
                        <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />
                        <span>Document Analysis Complete</span>
                      </div>

                      {analysis.filename && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">File Name</span>
                          <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1.5 rounded-lg border border-border/30">
                            <FileText className="h-4 w-4 shrink-0 text-emerald-500" />
                            <span className="text-xs font-semibold text-foreground truncate">{analysis.filename}</span>
                          </div>
                        </div>
                      )}

                      {analysis.category && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Category</span>
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 px-2.5 py-1 bg-emerald-500/10 rounded-md w-fit">{analysis.category}</span>
                        </div>
                      )}

                      {analysis.summary && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Analysis Summary</span>
                          <p className="text-xs text-muted-foreground leading-relaxed bg-muted/20 p-2.5 rounded-lg border border-border/20">{analysis.summary}</p>
                        </div>
                      )}
                    </div>
                  );
                }

                // 3. Fallback to legacy markdown parsing for older message history
                if (msg.text.startsWith('🤖 Document Analysis Complete!')) {
                  const legacyAnalysis = parseAnalysisText(msg.text);
                  return (
                    <div className="bg-card border border-border/85 rounded-2xl rounded-tl-none p-4 shadow-sm w-full max-w-[325px] self-start flex flex-col gap-3 animate-fade-in">
                      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs border-b border-border pb-2">
                        <Sparkles className="h-4 w-4 shrink-0 animate-pulse" />
                        <span>Document Analysis Complete</span>
                      </div>

                      {legacyAnalysis.filename && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">File Name</span>
                          <div className="flex items-center gap-1.5 bg-muted/40 px-2 py-1.5 rounded-lg border border-border/30">
                            <FileText className="h-4 w-4 shrink-0 text-emerald-500" />
                            <span className="text-xs font-semibold text-foreground truncate">{legacyAnalysis.filename}</span>
                          </div>
                        </div>
                      )}

                      {legacyAnalysis.category && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Category</span>
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 px-2.5 py-1 bg-emerald-500/10 rounded-md w-fit">{legacyAnalysis.category}</span>
                        </div>
                      )}

                      {legacyAnalysis.summary && (
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Analysis Summary</span>
                          <p className="text-xs text-muted-foreground leading-relaxed bg-muted/20 p-2.5 rounded-lg border border-border/20">{legacyAnalysis.summary}</p>
                        </div>
                      )}
                    </div>
                  );
                }

                const legacyDetails = parseDocumentDetails(msg.text);
                if (legacyDetails.isDetails) {
                  return (
                    <div className="bg-card border border-border/85 rounded-2xl rounded-tl-none p-4 shadow-sm w-full max-w-[325px] self-start flex flex-col gap-3 animate-fade-in">
                      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs border-b border-border pb-2">
                        <ShieldCheck className="h-4.5 w-4.5 shrink-0 text-emerald-500" />
                        <span>{legacyDetails.headerTitle}</span>
                      </div>

                      {legacyDetails.introText && (
                        <p className="text-xs text-muted-foreground leading-relaxed">{legacyDetails.introText}</p>
                      )}

                      <div className="grid grid-cols-1 gap-2 bg-muted/20 p-3 rounded-xl border border-border/40">
                        {legacyDetails.kvPairs.map((pair, idx) => {
                          const cleanKey = pair.key.replace(/\*\*/g, '').trim();
                          const cleanValue = pair.value.replace(/\*\*/g, '').trim();
                          return (
                            <div key={idx} className="flex flex-col gap-0.5 border-b border-border/20 last:border-0 pb-1.5 last:pb-0">
                              <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">{cleanKey}</span>
                              <span className="text-xs font-semibold text-foreground break-all">{cleanValue}</span>
                            </div>
                          );
                        })}
                      </div>

                      {legacyDetails.outroText && (
                        <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/30 pt-2">{legacyDetails.outroText}</p>
                      )}
                    </div>
                  );
                }
              }

              // Standard message bubble rendering
              return (
                <div className={`rounded-2xl rounded-tl-none px-4 py-2.5 text-sm shadow-sm break-words self-start ${msg.kind === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400' : 'bg-muted text-foreground'
                  }`}>
                  <div className="flex items-start gap-2 justify-between">
                    <div className="flex-1">
                      {msg.kind === 'transcript' ? (
                        <span className="italic text-muted-foreground">🎙️ Transcribed: &ldquo;{msg.text}&rdquo;</span>
                      ) : (
                        <span>{renderMarkdownText(msg.text || '')}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Assistant - Document Card */}
            {!isUser && msg.kind === 'document' && (
              <Card className="self-start overflow-hidden w-full max-w-[290px] border border-border/80 shadow-sm bg-card">
                <CardHeader className="p-3 pb-2 flex flex-col gap-2">
                  {msg.mimeType.startsWith('image/') ? (
                    <div
                      className="cursor-zoom-in hover:opacity-90 transition-opacity"
                      onClick={() => setLightboxImage({ src: msg.downloadUrl, alt: msg.filename })}
                    >
                      <LoadingImage
                        src={msg.downloadUrl}
                        alt={msg.filename}
                        className="rounded-md object-cover max-w-full h-auto max-h-40 mb-1"
                      />
                    </div>
                  ) : (
                    <div className="flex items-start gap-2.5">
                      <div className="h-9 w-9 shrink-0 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs font-semibold text-foreground line-clamp-1 break-all">
                          {msg.filename}
                        </h4>
                        {msg.caption && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                            {msg.caption}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="p-3 pt-0 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs font-medium gap-1.5"
                    onClick={() => window.open(msg.downloadUrl, '_blank')}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          <MessageFooter className={`flex items-center gap-1 mt-1 ${isUser ? 'self-end justify-end' : 'self-start justify-start'}`}>
            {isUser && 'status' in msg && getStatusIcon(msg.status)}
          </MessageFooter>
        </MessageContent>
      </Message>
    );
  }

  if (!mounted || !currentUser) return null;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Main Chat Interface */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-card/10 relative">
        {/* Top Navbar - Responsive */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 z-10 shadow-sm">
          {/* Logo / Chat Recipient */}
          <div className="flex items-center gap-2.5">
            <Avatar className="size-9 bg-emerald-500 text-white flex items-center justify-center font-bold">
              <AvatarFallback className="bg-emerald-500 text-white font-bold">MV</AvatarFallback>
            </Avatar>
            <div>
              <h3 className="font-semibold text-sm leading-tight">Magic Vault</h3>
              <p className="text-[10px] text-emerald-500 font-medium">Connected: {whatsappNumber}</p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-1 md:gap-2">
            {/* AI Provider Selector */}
            <div
              className="hidden sm:flex items-center gap-0.5 bg-muted/60 border border-border/60 rounded-lg p-0.5 h-8"
              title="Select AI provider"
            >
              <button
                onClick={() => handleSetAiProvider('openai')}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-200 ${aiProvider === 'openai'
                  ? 'bg-background text-foreground shadow-sm border border-border/40'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
                title="Use OpenAI GPT-4o Mini (default)"
              >
                <BrainCircuit className="h-3 w-3" />
                <span>OpenAI</span>
              </button>
              <button
                onClick={() => handleSetAiProvider('gateway')}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-all duration-200 ${aiProvider === 'gateway'
                  ? 'bg-background text-foreground shadow-sm border border-border/40'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
                title="Use AI Gateway (DeepSeek)"
              >
                <Zap className={`h-3 w-3 ${aiProvider === 'gateway' ? 'text-amber-500' : ''}`} />
                <span>Gateway</span>
              </button>
            </div>

            <ThemeToggle className="h-8 w-8" />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={() => router.push('/documents')}
              title="Vault Documents"
            >
              <FileText className="h-4 w-4" />
            </Button>
            {currentUser ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => router.push('/profile')}
                title="Profile"
              >
                <UserIcon className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="text-xs h-8 px-2"
                onClick={() => router.push('/login')}
              >
                Sign In
              </Button>
            )}
          </div>
        </header>

        {/* Chat Scroll Viewport */}
        <div className="flex-1 min-h-0 relative bg-muted/10">
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="size-full">
              <MessageScrollerViewport className="py-4">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto">
                    <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 animate-bounce">
                      <MessageSquare className="h-6 w-6" />
                    </div>
                    <h3 className="font-bold text-base mb-1 text-foreground">No messages yet</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Connected as <span className="font-semibold text-foreground">{whatsappNumber}</span>. Send a text message, upload a document, or record a voice note below to interact with your vault.
                    </p>
                  </div>
                ) : (
                  <MessageScrollerContent>
                    {messages.map((msg) => (
                      <MessageScrollerItem key={msg.id} messageId={msg.id} scrollAnchor={false}>
                        {renderMessage(msg)}
                      </MessageScrollerItem>
                    ))}
                    {isAiLoading && (
                      <MessageScrollerItem messageId="ai-loading" scrollAnchor={false}>
                        <Message align="start" className="px-2 md:px-4 py-1 animate-fade-in">
                          <MessageAvatar>
                            <Avatar className="size-8">
                              <AvatarFallback className="bg-emerald-500 text-white text-xs">
                                <Sparkles className="h-4 w-4" />
                              </AvatarFallback>
                            </Avatar>
                          </MessageAvatar>
                          <MessageContent>
                            <MessageHeader className="flex items-center gap-1.5 mb-0.5 self-start">
                              <span className="font-semibold text-xs text-foreground">Magic Vault</span>
                            </MessageHeader>
                            <div className="flex space-x-1 items-center px-4 py-3 bg-muted rounded-2xl rounded-tl-none w-16 justify-center">
                              <div className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                              <div className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                              <div className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full animate-bounce"></div>
                            </div>
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    )}
                  </MessageScrollerContent>
                )}
              </MessageScrollerViewport>
              <MessageScrollerButton direction="end" className="shadow-lg border border-border" />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>

        {/* Composer / Chat Input Section */}
        <footer className="p-3 md:p-4 border-t border-border bg-card shrink-0">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
            {/* Attachments Trigger */}
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 shrink-0 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted"
              onClick={() => fileInputRef.current?.click()}
              title="Attach Document"
            >
              <Paperclip className="h-5 w-5" />
            </Button>

            {/* Input Form Box */}
            <div className="flex-1 relative flex items-center rounded-2xl border border-input bg-muted/30 px-3 py-1.5 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
              {isRecording ? (
                <div className="flex-1 flex items-center justify-between text-xs text-red-500">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                    <span className="font-medium animate-pulse">Recording Audio...</span>
                  </div>
                  <span className="font-mono bg-red-50 dark:bg-red-950/20 px-2 py-0.5 rounded text-[11px] font-semibold">{recordSeconds}s</span>
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={composerValue}
                  onChange={(e) => setComposerValue(e.target.value)}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 resize-none py-1 font-normal placeholder-muted-foreground w-full leading-tight overflow-y-auto"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSubmitText();
                    }
                  }}
                />
              )}
            </div>

            {/* Action Triggers: Recording / Send */}
            <div className="flex items-center gap-1 shrink-0">
              {isRecording ? (
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  onClick={stopRecording}
                  title="Stop and Send"
                >
                  <Square className="h-4.5 w-4.5" />
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted"
                    onClick={startRecording}
                    title="Record voice note"
                  >
                    <Mic className="h-5 w-5" />
                  </Button>
                  <Button
                    onClick={handleSubmitText}
                    size="icon"
                    className="h-10 w-10 rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
                    disabled={!composerValue.trim()}
                    title="Send message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </footer>

        {/* Secret input for file uploads */}
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_UPLOAD_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />

      </main>

      {/* Lightbox / Image Popup Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full flex items-center justify-center">
            <button
              className="absolute top-4 right-4 text-white hover:text-gray-300 bg-black/40 hover:bg-black/60 p-2 rounded-full transition-colors z-10"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxImage(null);
              }}
            >
              <X className="h-6 w-6" />
            </button>
            <img
              src={lightboxImage.src}
              alt={lightboxImage.alt}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl transition-transform duration-200"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingImage({ src, alt, className, onLoadComplete }: { src: string; alt: string; className?: string; onLoadComplete?: () => void }) {
  const [isLoading, setIsLoading] = useState(true);

  return (
    <div className="relative min-h-[120px] w-full flex items-center justify-center bg-muted/20 rounded-md overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40 animate-pulse">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        className={cn(
          className,
          "transition-opacity duration-300",
          isLoading ? "opacity-0 h-0 w-0" : "opacity-100"
        )}
        onLoad={() => {
          setIsLoading(false);
          onLoadComplete?.();
        }}
        onError={() => {
          setIsLoading(false);
          onLoadComplete?.();
        }}
      />
    </div>
  );
}

function parseAnalysisText(text: string) {
  const lines = text.split('\n');
  let filename = '';
  let category = '';
  let summary = '';

  const fileLine = lines.find(l => l.includes('📁') || (l.includes('*') && l.includes('.')));
  if (fileLine) {
    filename = fileLine.replace(/[📁*]/g, '').trim();
  }

  const catLine = lines.find(l => l.toLowerCase().includes('*category:*'));
  if (catLine) {
    category = catLine.replace(/\*Category:\*/i, '').replace(/\*/g, '').trim();
  }

  const sumLine = lines.find(l => l.toLowerCase().includes('*summary:*'));
  if (sumLine) {
    summary = sumLine.replace(/\*Summary:\*/i, '').replace(/\*/g, '').trim();
  }

  return { filename, category, summary };
}

function parseDocumentDetails(text: string) {
  const lines = text.split('\n');
  const introLines: string[] = [];
  const outroLines: string[] = [];
  const kvPairs: Array<{ key: string; value: string }> = [];

  let headerTitle = "Document Details";
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
      const match = trimmed.match(/^[-*]\s*\*\*(.*?):\*\*\s*(.*)$/);
      if (match) {
        inList = true;
        kvPairs.push({
          key: match[1].trim(),
          value: match[2].trim()
        });
        continue;
      }
    }

    if (inList) {
      if (trimmed) {
        outroLines.push(trimmed);
      }
    } else {
      if (trimmed) {
        introLines.push(trimmed);
      }
    }
  }

  const introText = introLines.join(' ');
  const docTypeMatch = introText.match(/about your\s+(.*?)(?:\s+card)?(?:\:|\.|$)/i);
  if (docTypeMatch) {
    headerTitle = `${docTypeMatch[1].trim()} Details`;
    headerTitle = headerTitle.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    if (introText.toLowerCase().includes('card') && !headerTitle.toLowerCase().includes('card')) {
      headerTitle = headerTitle.replace('Details', 'Card Details');
    }
  }

  return {
    isDetails: kvPairs.length > 0,
    headerTitle,
    introText,
    kvPairs,
    outroText: outroLines.join(' ')
  };
}

function parseStructuredDetails(text: string) {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.type === 'structured_details') {
        return {
          isStructured: true,
          title: parsed.title || 'Document Details',
          intro: parsed.intro || '',
          fields: Array.isArray(parsed.fields) ? parsed.fields : [],
          outro: parsed.outro || '',
        };
      }
    }
  } catch {
    // ignore
  }
  return { isStructured: false };
}

function parseDocumentAnalysis(text: string) {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.type === 'document_analysis') {
        return {
          isAnalysis: true,
          filename: parsed.filename || '',
          category: parsed.category || '',
          summary: parsed.summary || '',
        };
      }
    }
  } catch {
    // ignore
  }
  return { isAnalysis: false };
}

function renderMarkdownText(text: string): React.ReactNode {
  // Split text into segments, handling **bold** and *italic*
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.*?)\*\*|\*(.*?)\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      // **bold**
      parts.push(<strong key={match.index} className="font-semibold">{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      // *italic*
      parts.push(<em key={match.index} className="italic">{match[2]}</em>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
