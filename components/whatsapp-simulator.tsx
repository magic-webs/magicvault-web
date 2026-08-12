'use client';

import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Message,
  MessageGroup,
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  MessageSquare,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Download,
  User as UserIcon,
  Trash2,
  Volume2,
  Mic,
  Square,
  Phone,
  LogOut,
  ArrowLeft,
  RefreshCw,
  Loader2,
  Send,
  Sparkles,
  Settings,
  X,
  ShieldCheck,
  ArrowDown,
  Plus
} from "lucide-react";
import { toast } from "sonner";
import { PhoneInput, DEFAULT_COUNTRY_CODE, COUNTRY_CODES, toE164 } from './phone-input';
import { getStoredUser, type AuthUser } from '@/lib/auth-api';
import { ThemeToggle } from '@/components/theme-provider';
import { simulateMessage, blobToBase64, SimulateApiError, type SimulateReply } from '@/lib/simulate-api';

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

export function WhatsAppSimulator() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef(0);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [whatsappNumber, setWhatsappNumber] = useState(toE164(DEFAULT_COUNTRY_CODE, '5550001111'));
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);
  const [localNumber, setLocalNumber] = useState('5550001111');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [composerValue, setComposerValue] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);

  function speakText(text: string) {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    } else {
      toast.error('Text-to-speech is not supported in this browser.');
    }
  }

  useEffect(() => {
    setMounted(true);
    const user = getStoredUser();
    if (user) {
      setCurrentUser(user);
      const match = COUNTRY_CODES.find((c) => user.whatsappNumber.startsWith(c.value));
      if (match) {
        setCountryCode(match.value);
        setLocalNumber(user.whatsappNumber.slice(match.value.length));
        setWhatsappNumber(user.whatsappNumber);
      } else {
        setWhatsappNumber(user.whatsappNumber);
      }
    }
  }, []);

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
    try {
      const data = await simulateMessage({ kind: 'text', whatsappNumber, text });
      updateStatus(id, 'sent');
      appendReplies(data.replies);
    } catch (error) {
      reportError(id, error);
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

    try {
      const base64 = await blobToBase64(file);
      const data = await simulateMessage({
        kind: 'upload',
        whatsappNumber,
        file: { base64, mimeType: file.type, filename: file.name },
      });
      updateStatus(id, 'sent');
      appendReplies(data.replies);
    } catch (error) {
      reportError(id, error);
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

    try {
      const base64 = await blobToBase64(blob);
      const data = await simulateMessage({
        kind: 'voice',
        whatsappNumber,
        audio: { base64, mimeType: blob.type || 'audio/webm' },
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

  function startNewChat() {
    if (!localNumber.trim()) return;
    setWhatsappNumber(toE164(countryCode, localNumber));
    setMessages([]);
  }

  function getStatusIcon(status: DeliveryStatus) {
    if (status === 'sending') return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
    if (status === 'error') return <span className="text-red-500 text-xs">⚠️</span>;
    return <span className="text-emerald-500 text-xs">✓✓</span>;
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
                {msg.previewUrl ? (
                  <img
                    src={msg.previewUrl}
                    alt={msg.filename}
                    className="rounded-lg object-cover max-w-full h-auto max-h-48"
                  />
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
            {!isUser && (msg.kind === 'text' || msg.kind === 'transcript' || msg.kind === 'error') && (
              <div className={`rounded-2xl rounded-tl-none px-4 py-2.5 text-sm shadow-sm break-words self-start ${
                msg.kind === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400' : 'bg-muted text-foreground'
              }`}>
                <div className="flex items-start gap-2 justify-between">
                  <div className="flex-1">
                    {msg.kind === 'transcript' ? (
                      <span className="italic text-muted-foreground">🎙️ Transcribed: &ldquo;{msg.text}&rdquo;</span>
                    ) : (
                      <span>{msg.text}</span>
                    )}
                  </div>
                  {msg.kind === 'text' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => speakText(msg.text)}
                      title="Speak message"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Assistant - Document Card */}
            {!isUser && msg.kind === 'document' && (
              <Card className="self-start overflow-hidden w-full max-w-[290px] border border-border/80 shadow-sm bg-card">
                <CardHeader className="p-3 pb-2 flex flex-col gap-2">
                  {msg.mimeType.startsWith('image/') && (
                    <img
                      src={msg.downloadUrl}
                      alt={msg.filename}
                      className="rounded-md object-cover max-w-full h-auto max-h-40 mb-1"
                    />
                  )}
                  <div className="flex items-start gap-2.5">
                    <div className="h-9 w-9 shrink-0 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      {msg.mimeType.startsWith('image/') ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs font-semibold text-foreground line-clamp-1 break-all">
                        {msg.filename}
                      </h4>
                      <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                        {msg.caption}
                      </p>
                    </div>
                  </div>
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

  if (!mounted) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar - Desktop Layout */}
      <aside className="hidden md:flex flex-col w-[350px] shrink-0 border-r border-border bg-muted/30">
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-emerald-500" />
            <h1 className="font-bold text-base">Magic Vault Simulator</h1>
          </div>
          <ThemeToggle />
        </div>

        {/* Sidebar Scrollable Panel */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <Card className="border-border/60">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-semibold">Simulated User</CardTitle>
              <CardDescription className="text-xs">Configure the phone number for WhatsApp message simulation.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-4">
              <PhoneInput
                countryCode={countryCode}
                onCountryCodeChange={setCountryCode}
                localNumber={localNumber}
                onLocalNumberChange={setLocalNumber}
                isRequired
              />
              <Button onClick={startNewChat} className="w-full gap-1.5 h-9 text-xs">
                <Plus className="h-3.5 w-3.5" /> Start New Chat
              </Button>
            </CardContent>
          </Card>

          {/* Quick Stats or Actions */}
          <div className="space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase px-1">Actions</h2>
            <div className="flex flex-col gap-1.5">
              {messages.length > 0 && (
                <Button variant="outline" onClick={clearChatHistory} className="w-full justify-start text-xs h-9 gap-2">
                  <Trash2 className="h-4 w-4 text-red-500" /> Clear Chat History
                </Button>
              )}
              {currentUser ? (
                <Button variant="outline" onClick={() => router.push('/profile')} className="w-full justify-start text-xs h-9 gap-2">
                  <UserIcon className="h-4 w-4" /> {currentUser.name || 'View Profile'}
                </Button>
              ) : (
                <Button variant="default" onClick={() => router.push('/login')} className="w-full justify-start text-xs h-9 gap-2">
                  <UserIcon className="h-4 w-4" /> Sign In
                </Button>
              )}
              <Button variant="outline" onClick={() => router.push('/documents')} className="w-full justify-start text-xs h-9 gap-2">
                <FileText className="h-4 w-4" /> View Vault Documents
              </Button>
            </div>
          </div>
        </div>

        {/* Sidebar Footer */}
        {currentUser && (
          <div className="p-4 border-t border-border bg-card flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {(currentUser.name || 'U')[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate leading-tight">{currentUser.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">{currentUser.whatsappNumber}</p>
              </div>
            </div>
          </div>
        )}
      </aside>

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
              <p className="text-[10px] text-emerald-500 font-medium">Active Simulation: {whatsappNumber}</p>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-1 md:gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-8 w-8 text-muted-foreground"
              onClick={() => setIsMobileSettingsOpen(true)}
              title="Simulation Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
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
          <MessageScrollerProvider>
            <MessageScroller className="size-full">
              <MessageScrollerViewport className="py-4">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto">
                    <div className="h-12 w-12 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 animate-bounce">
                      <MessageSquare className="h-6 w-6" />
                    </div>
                    <h3 className="font-bold text-base mb-1 text-foreground">No messages yet</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Testing simulation as <span className="font-semibold text-foreground">{whatsappNumber}</span>. Send a text message, upload a document, or record a voice note below to test your vault.
                    </p>
                  </div>
                ) : (
                  <MessageScrollerContent>
                    {messages.map((msg) => (
                      <MessageScrollerItem key={msg.id}>
                        {renderMessage(msg)}
                      </MessageScrollerItem>
                    ))}
                  </MessageScrollerContent>
                )}
              </MessageScrollerViewport>
              <MessageScrollerButton direction="end" className="shadow-lg border border-border" />
            </MessageScroller>
          </MessageScrollerProvider>
        </div>

        {/* Composer / Chat Input Section */}
        <footer className="p-3 md:p-4 border-t border-border bg-card shrink-0">
          <div className="max-w-3xl mx-auto flex items-center gap-2">
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
                  value={composerValue}
                  onChange={(e) => setComposerValue(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 text-sm bg-transparent border-0 focus:outline-none focus:ring-0 resize-none h-6 py-0.5 font-normal placeholder-muted-foreground w-full align-middle leading-tight"
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

        {/* Mobile Settings Drawer/Overlay */}
        {isMobileSettingsOpen && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4">
            <Card className="w-full max-w-sm shadow-xl border-border/80 bg-card">
              <CardHeader className="p-4 flex flex-row items-center justify-between border-b border-border/50">
                <div>
                  <CardTitle className="text-sm font-semibold">Simulation Settings</CardTitle>
                  <CardDescription className="text-[10px]">Change WhatsApp simulated user details.</CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full text-muted-foreground"
                  onClick={() => setIsMobileSettingsOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <PhoneInput
                  countryCode={countryCode}
                  onCountryCodeChange={setCountryCode}
                  localNumber={localNumber}
                  onLocalNumberChange={setLocalNumber}
                  isRequired
                />
                <div className="flex gap-2">
                  {messages.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => { clearChatHistory(); setIsMobileSettingsOpen(false); }} className="flex-1 h-9 text-xs text-red-500 gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" /> Clear History
                    </Button>
                  )}
                  <Button size="sm" onClick={() => { startNewChat(); setIsMobileSettingsOpen(false); }} className="flex-1 h-9 text-xs">
                    Apply & Start
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
