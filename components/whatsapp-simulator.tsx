'use client';

import { useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@astryxdesign/core/AppShell';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { NavIcon } from '@astryxdesign/core/NavIcon';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Icon } from '@astryxdesign/core/Icon';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useToast } from '@astryxdesign/core/Toast';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { PhoneInput, DEFAULT_COUNTRY_CODE, COUNTRY_CODES, toE164 } from './phone-input';
import { getStoredUser, type AuthUser } from '@/lib/auth-api';
import { ThemeToggle } from '@/components/theme-provider';
import {
  ChatLayout,
  ChatMessageList,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageMetadata,
  ChatComposer,
} from '@astryxdesign/core/Chat';
import {
  ChatBubbleLeftRightIcon,
  PaperClipIcon,
  DocumentTextIcon,
  PhotoIcon,
  ArrowDownTrayIcon,
  UserIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
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
  | (BaseMsg & {
      sender: 'assistant';
      kind: 'document';
      filename: string;
      mimeType: string;
      caption: string;
      downloadUrl: string;
    });

const SUPPORTED_UPLOAD_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/heic';

function toDeliveryStatus(status: DeliveryStatus): 'sending' | 'delivered' | 'error' {
  if (status === 'sent') return 'delivered';
  return status;
}

export function WhatsAppSimulator() {
  const router = useRouter();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const mediaQueryMatch = useMediaQuery('(max-width: 639px)');
  const isMobile = mounted ? mediaQueryMatch : false;
  const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
  const idCounter = useRef(0);
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
    const raw = localStorage.getItem(`magic-vault-chat-${whatsappNumber}`);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
          return;
        }
      } catch {
        // ignore parse error
      }
    }
    setMessages([]);
  }, [whatsappNumber]);

  // Save chat history when messages update
  useEffect(() => {
    if (typeof window === 'undefined' || !whatsappNumber) return;
    if (messages.length > 0) {
      localStorage.setItem(`magic-vault-chat-${whatsappNumber}`, JSON.stringify(messages));
    }
  }, [messages, whatsappNumber]);

  function clearChatHistory() {
    setMessages([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(`magic-vault-chat-${whatsappNumber}`);
    }
    toast({ body: `Chat history cleared for ${whatsappNumber}`, type: 'info' });
  }

  function nextId(): string {
    idCounter.current += 1;
    return `local-${idCounter.current}`;
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
    toast({ body: message, type: 'error' });
    addMessage({ id: nextId(), sender: 'assistant', kind: 'error', text: message, timestamp: new Date().toISOString() });
  }

  async function handleSubmitText(value: string) {
    const text = value.trim();
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
      toast({ body: 'Microphone access denied or unavailable in this browser.', type: 'error' });
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

  function renderMessage(msg: ChatMsg) {
    if (msg.sender === 'user' && msg.kind === 'text') {
      return (
        <ChatMessage key={msg.id} sender="user">
          <ChatMessageBubble
            metadata={
              <ChatMessageMetadata
                timestamp={<Timestamp value={msg.timestamp} format="time" />}
                status={toDeliveryStatus(msg.status)}
              />
            }
          >
            {msg.text}
          </ChatMessageBubble>
        </ChatMessage>
      );
    }

    if (msg.sender === 'user' && msg.kind === 'upload') {
      return (
        <ChatMessage key={msg.id} sender="user">
          <ChatMessageBubble
            metadata={
              <ChatMessageMetadata
                timestamp={<Timestamp value={msg.timestamp} format="time" />}
                status={toDeliveryStatus(msg.status)}
              />
            }
          >
            {msg.previewUrl ? (
              <img src={msg.previewUrl} alt={msg.filename} width={200} height={200} className="rounded-lg object-cover max-w-full h-auto max-h-48" />
            ) : (
              <HStack gap={2} vAlign="center">
                <Icon icon={DocumentTextIcon} size="lg" />
                <Text type="body" className="break-all">{msg.filename}</Text>
              </HStack>
            )}
          </ChatMessageBubble>
        </ChatMessage>
      );
    }

    if (msg.sender === 'user' && msg.kind === 'voice') {
      return (
        <ChatMessage key={msg.id} sender="user">
          <ChatMessageBubble
            metadata={
              <ChatMessageMetadata
                timestamp={<Timestamp value={msg.timestamp} format="time" />}
                status={toDeliveryStatus(msg.status)}
              />
            }
          >
            <VStack gap={1}>
              <HStack gap={2} vAlign="center">
                <Icon icon="microphone" size="sm" />
                <Text type="body">Voice message · {msg.durationSec}s</Text>
              </HStack>
              <audio controls src={msg.audioUrl} className="h-8 w-56 max-w-full" />
            </VStack>
          </ChatMessageBubble>
        </ChatMessage>
      );
    }

    if (msg.sender === 'assistant' && (msg.kind === 'text' || msg.kind === 'transcript' || msg.kind === 'error')) {
      const label = msg.kind === 'transcript' ? `🎙️ Transcribed: "${msg.text}"` : msg.kind === 'error' ? `⚠️ ${msg.text}` : msg.text;
      return (
        <ChatMessage key={msg.id} sender="assistant">
          <ChatMessageBubble variant="ghost" metadata={<ChatMessageMetadata timestamp={<Timestamp value={msg.timestamp} format="time" />} />}>
            {label}
          </ChatMessageBubble>
        </ChatMessage>
      );
    }

    if (msg.sender === 'assistant' && msg.kind === 'document') {
      return (
        <ChatMessage
          key={msg.id}
          sender="assistant"
          metadata={<ChatMessageMetadata timestamp={<Timestamp value={msg.timestamp} format="time" />} />}
        >
          <Card variant="muted" padding={3} width="100%" maxWidth={300}>
            <VStack gap={3}>
              <HStack gap={3} vAlign="center">
                <Icon icon={msg.mimeType.startsWith('image/') ? PhotoIcon : DocumentTextIcon} size="lg" color="accent" />
                <StackItem size="fill">
                  <VStack gap={0.5}>
                    <Text type="body" weight="medium">
                      {msg.filename}
                    </Text>
                    <Text type="supporting" maxLines={2}>
                      {msg.caption}
                    </Text>
                  </VStack>
                </StackItem>
              </HStack>
              <Button
                label="Download"
                size="sm"
                variant="secondary"
                icon={<Icon icon={ArrowDownTrayIcon} />}
                onClick={() => window.open(msg.downloadUrl, '_blank')}
              />
            </VStack>
          </Card>
        </ChatMessage>
      );
    }

    return null;
  }

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      topNav={
        <TopNav
          label="Magic Vault WhatsApp simulator"
          heading={<TopNavHeading heading="Magic Vault" logo={<NavIcon icon={<ChatBubbleLeftRightIcon />} />} />}
          endContent={
            <HStack gap={2} vAlign="center" wrap="wrap" justify="end">
              {isMobile ? (
                <Button
                  label={localNumber ? `${countryCode} ${localNumber}` : 'Number'}
                  size="sm"
                  variant={isMobileSettingsOpen ? 'primary' : 'secondary'}
                  icon={<Icon icon={ChatBubbleLeftRightIcon} />}
                  onClick={() => setIsMobileSettingsOpen((prev) => !prev)}
                />
              ) : (
                <>
                  <HStack maxWidth={210}>
                    <PhoneInput
                      countryCode={countryCode}
                      onCountryCodeChange={setCountryCode}
                      localNumber={localNumber}
                      onLocalNumberChange={setLocalNumber}
                      size="sm"
                    />
                  </HStack>
                  <Button label="Start new chat" size="sm" variant="secondary" onClick={startNewChat} />
                </>
              )}

              {messages.length > 0 && (
                <IconButton
                  label="Clear chat history"
                  icon={<Icon icon={TrashIcon} />}
                  variant="ghost"
                  size="sm"
                  onClick={clearChatHistory}
                />
              )}

              {currentUser ? (
                <Button
                  label={currentUser.name || 'Profile'}
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={UserIcon} />}
                  onClick={() => router.push('/profile')}
                />
              ) : (
                <Button
                  label="Sign in"
                  size="sm"
                  variant="primary"
                  icon={<Icon icon={UserIcon} />}
                  onClick={() => router.push('/login')}
                />
              )}

              <ThemeToggle size="sm" />
            </HStack>
          }
        />
      }
    >
      <VStack height="100%" gap={0}>
        {isMobile && isMobileSettingsOpen && (
          <Card variant="muted" padding={4} width="100%">
            <VStack gap={3}>
              <Text type="body" weight="medium" size="sm">
                Simulation Number
              </Text>
              <PhoneInput
                countryCode={countryCode}
                onCountryCodeChange={setCountryCode}
                localNumber={localNumber}
                onLocalNumberChange={setLocalNumber}
                size="md"
              />
              <HStack justify="end" gap={2} wrap="wrap">
                {messages.length > 0 && (
                  <Button
                    label="Clear history"
                    size="sm"
                    variant="ghost"
                    icon={<Icon icon={TrashIcon} />}
                    onClick={clearChatHistory}
                  />
                )}
                <Button
                  label="Start new chat"
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    startNewChat();
                    setIsMobileSettingsOpen(false);
                  }}
                />
              </HStack>
            </VStack>
          </Card>
        )}
        <ChatLayout
            composer={
              <ChatComposer
                value={composerValue}
                onChange={setComposerValue}
                onSubmit={handleSubmitText}
                placeholder="Message Magic Vault..."
                headerActions={
                  <IconButton
                    label="Attach a document"
                    icon={<Icon icon={PaperClipIcon} />}
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  />
                }
                sendActions={
                  isRecording ? (
                    <HStack gap={2} vAlign="center">
                      <Text type="supporting">{recordSeconds}s</Text>
                      <IconButton
                        label="Stop recording"
                        icon={<Icon icon="stop" />}
                        variant="destructive"
                        size="sm"
                        onClick={stopRecording}
                      />
                    </HStack>
                  ) : (
                    <IconButton
                      label="Record a voice message"
                      icon={<Icon icon="microphone" />}
                      variant="ghost"
                      size="sm"
                      onClick={startRecording}
                    />
                  )
                }
              />
            }
          >
            <ChatMessageList
              emptyState={
                <EmptyState
                  title="No messages yet"
                  description={`Testing as ${whatsappNumber}. Send a text query, upload a document, or record a voice note.`}
                />
              }
            >
              {messages.map(renderMessage)}
            </ChatMessageList>
          </ChatLayout>
        </VStack>
        <input
          ref={fileInputRef}
          type="file"
          accept={SUPPORTED_UPLOAD_ACCEPT}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
    </AppShell>
  );
}
