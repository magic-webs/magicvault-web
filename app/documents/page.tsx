'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@astryxdesign/core/AppShell';
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav';
import { NavIcon } from '@astryxdesign/core/NavIcon';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text, Heading } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Badge } from '@astryxdesign/core/Badge';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Banner } from '@astryxdesign/core/Banner';
import { useToast } from '@astryxdesign/core/Toast';
import {
  ChatBubbleLeftRightIcon,
  UserIcon,
  DocumentTextIcon,
  PhotoIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { listDocuments, getDownloadLink, type VaultDocument } from '@/lib/documents-api';
import { getStoredUser } from '@/lib/auth-api';
import { ThemeToggle } from '@/components/theme-provider';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function DocumentsPage() {
  const router = useRouter();
  const toast = useToast();
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function loadDocuments() {
    setIsLoading(true);
    setError('');
    try {
      const res = await listDocuments();
      setDocuments(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load documents');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.push('/login');
      return;
    }
    void loadDocuments();
  }, [router]);

  async function handleDownload(doc: VaultDocument) {
    setDownloadingId(doc.id);
    try {
      const url = await getDownloadLink(doc.id);
      window.open(url, '_blank');
      toast({ body: `Downloading ${doc.filename}...`, type: 'info' });
    } catch (err) {
      toast({ body: err instanceof Error ? err.message : 'Could not download document', type: 'error' });
    } finally {
      setDownloadingId(null);
    }
  }

  const categories = ['all', ...Array.from(new Set(documents.map((d) => d.category || 'uncategorized')))];

  const filteredDocuments = documents.filter((doc) => {
    const matchesCategory = selectedCategory === 'all' || doc.category?.toLowerCase() === selectedCategory.toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !query ||
      doc.title.toLowerCase().includes(query) ||
      doc.filename.toLowerCase().includes(query) ||
      doc.summary.toLowerCase().includes(query) ||
      doc.category.toLowerCase().includes(query);

    return matchesCategory && matchesSearch;
  });

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      topNav={
        <TopNav
          label="Magic Vault Documents"
          heading={
            <TopNavHeading
              heading="Magic Vault"
              logo={<NavIcon icon={<ChatBubbleLeftRightIcon />} />}
              onClick={() => router.push('/')}
            />
          }
          endContent={
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button
                label="Simulator"
                size="sm"
                variant="secondary"
                icon={<Icon icon={ChatBubbleLeftRightIcon} />}
                onClick={() => router.push('/')}
              />
              <Button
                label="Profile"
                size="sm"
                variant="ghost"
                icon={<Icon icon={UserIcon} />}
                onClick={() => router.push('/profile')}
              />
              <ThemeToggle size="sm" />
            </HStack>
          }
        />
      }
    >
      <div className="w-full max-w-5xl mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        <VStack gap={2}>
          <HStack justify="between" vAlign="center" wrap="wrap">
            <VStack gap={1}>
              <Heading level={2}>Saved Vault Documents</Heading>
              <Text type="body" color="secondary" size="sm">
                View, filter, and download all documents stored in your vault
              </Text>
            </VStack>
            <Button
              label="Refresh"
              size="sm"
              variant="secondary"
              icon={<Icon icon={ArrowPathIcon} />}
              onClick={loadDocuments}
              isLoading={isLoading}
            />
          </HStack>
        </VStack>

        {error && <Banner status="error" title={error} container="card" />}

        <VStack gap={4}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <div className="flex-1 min-w-[240px]">
              <TextInput
                label="Search documents"
                isLabelHidden
                placeholder="Search by title, filename, or summary..."
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </div>
            {categories.length > 1 && (
              <HStack gap={1.5} wrap="wrap" vAlign="center">
                <Text type="supporting">Category:</Text>
                {categories.map((cat) => (
                  <Button
                    key={cat}
                    label={cat.charAt(0).toUpperCase() + cat.slice(1)}
                    size="sm"
                    variant={selectedCategory === cat ? 'primary' : 'ghost'}
                    onClick={() => setSelectedCategory(cat)}
                  />
                ))}
              </HStack>
            )}
          </HStack>

          {isLoading ? (
            <Card padding={8} width="100%">
              <VStack gap={3} hAlign="center">
                <Spinner size="lg" />
                <Text type="body" color="secondary">
                  Loading vault documents...
                </Text>
              </VStack>
            </Card>
          ) : filteredDocuments.length === 0 ? (
            <Card padding={8} width="100%">
              <EmptyState
                title={searchQuery || selectedCategory !== 'all' ? 'No matching documents' : 'No documents saved yet'}
                description={
                  searchQuery || selectedCategory !== 'all'
                    ? 'Try clearing your search filters or category selection.'
                    : 'Upload a document or photo in the WhatsApp simulator to store it securely in your Magic Vault.'
                }
                actions={
                  <Button
                    label="Launch WhatsApp Simulator"
                    variant="primary"
                    icon={<Icon icon={ChatBubbleLeftRightIcon} />}
                    onClick={() => router.push('/')}
                  />
                }
              />
            </Card>
          ) : (
            <VStack gap={3} width="100%">
              <Text type="supporting" weight="bold">
                {filteredDocuments.length} {filteredDocuments.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'}
              </Text>

              {filteredDocuments.map((doc) => {
                const isImage = doc.mimeType.startsWith('image/');
                const isReady = doc.status === 'ready';
                const isFailed = doc.status === 'failed';

                return (
                  <Card key={doc.id} padding={4} width="100%">
                    <HStack gap={4} vAlign="center" justify="between" wrap="wrap">
                      <HStack gap={3} vAlign="center" style={{ flex: '1 1 300px' }}>
                        <Icon icon={isImage ? PhotoIcon : DocumentTextIcon} size="lg" color="accent" />
                        <VStack gap={1} style={{ flex: 1 }}>
                          <HStack gap={2} vAlign="center" wrap="wrap">
                            <Text type="body" weight="bold" size="lg">
                              {doc.title || doc.filename}
                            </Text>
                            <Badge label={doc.category} variant="neutral" />
                            <StatusDot
                              variant={isReady ? 'success' : isFailed ? 'error' : 'warning'}
                              label={doc.status}
                            />
                          </HStack>
                          <Text type="supporting" color="secondary" size="sm">
                            {doc.filename} · {formatFileSize(doc.size)} · Uploaded {formatDate(doc.createdAt)}
                          </Text>
                          {doc.summary && (
                            <Text type="body" size="sm" color="secondary" maxLines={2}>
                              {doc.summary}
                            </Text>
                          )}
                        </VStack>
                      </HStack>

                      <HStack gap={2} vAlign="center">
                        <Button
                          label="Download"
                          size="sm"
                          variant="secondary"
                          icon={<Icon icon={ArrowDownTrayIcon} />}
                          isLoading={downloadingId === doc.id}
                          onClick={() => handleDownload(doc)}
                        />
                      </HStack>
                    </HStack>
                  </Card>
                );
              })}
            </VStack>
          )}
        </VStack>
      </div>
    </AppShell>
  );
}
