'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  FileText,
  Image as ImageIcon,
  Download,
  Calendar,
  Layers,
  FileCode,
  Tag,
  Loader2,
  AlertCircle,
  Clock,
  ExternalLink
} from "lucide-react";
import { getDocument, getDownloadLink, type VaultDocument } from '@/lib/documents-api';
import { getStoredUser } from '@/lib/auth-api';
import { ThemeToggle } from '@/components/theme-provider';
import { toast } from "sonner";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface PageProps {
  params: Promise<{ documentId: string }>;
}

export default function DocumentDetailPage({ params }: PageProps) {
  const router = useRouter();
  const { documentId } = use(params);

  const [document, setDocument] = useState<VaultDocument | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState('');

  async function loadDocumentDetails() {
    setIsLoading(true);
    setError('');
    try {
      const doc = await getDocument(documentId);
      setDocument(doc);

      // If it's an image, fetch download link for preview
      if (doc.mimeType?.startsWith('image/')) {
        const url = await getDownloadLink(doc.id);
        setDownloadUrl(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load document details');
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
    void loadDocumentDetails();
  }, [documentId, router]);

  async function handleDownload() {
    if (!document) return;
    setIsDownloading(true);
    try {
      const url = await getDownloadLink(document.id);
      window.open(url, '_blank');
      toast.info(`Downloading ${document.filename}...`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download document');
    } finally {
      setIsDownloading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen w-screen flex flex-col bg-background text-foreground">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => router.push('/')}>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <FileText className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-sm">Magic Vault</h3>
          </div>
          <ThemeToggle />
        </header>
        <div className="flex-grow flex flex-col items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-500 mb-2" />
          <p className="text-sm text-muted-foreground">Fetching document details...</p>
        </div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="min-h-screen w-screen flex flex-col bg-background text-foreground">
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => router.push('/')}>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <FileText className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-sm">Magic Vault</h3>
          </div>
          <ThemeToggle />
        </header>
        <div className="flex-grow flex flex-col items-center justify-center p-8 max-w-md mx-auto text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold">Failed to Load Document</h2>
          <p className="text-sm text-muted-foreground">{error || 'The requested document could not be found or you do not have permission to access it.'}</p>
          <Button onClick={() => router.push('/documents')} className="text-xs h-9 bg-emerald-500 text-white border-0">
            Back to Documents
          </Button>
        </div>
      </div>
    );
  }

  const isImage = document.mimeType.startsWith('image/');
  const isReady = document.status === 'ready';
  const isFailed = document.status === 'failed';

  return (
    <div className="min-h-screen w-screen flex flex-col bg-background text-foreground">
      {/* Top Navbar */}
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => router.push('/')}>
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <FileText className="h-5 w-5" />
          </div>
          <h3 className="font-semibold text-sm">Magic Vault</h3>
        </div>
        <ThemeToggle />
      </header>

      {/* Detail Container */}
      <div className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        
        {/* Back and Navigation Actions */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/documents')}
            className="text-xs h-8 gap-1.5 hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Documents
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isDownloading}
            onClick={handleDownload}
            className="h-8 text-xs font-semibold gap-1.5 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          >
            {isDownloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Download File
          </Button>
        </div>

        {/* Title Details Header */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs font-semibold py-0.5 px-2.5">
              {document.category}
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs font-semibold py-0.5 px-2.5 gap-1.5 ${
                isReady
                  ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border-emerald-500/20'
                  : isFailed
                  ? 'text-red-600 dark:text-red-400 bg-red-500/5 border-red-500/20'
                  : 'text-amber-600 dark:text-amber-400 bg-amber-500/5 border-amber-500/20'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                isReady ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-amber-500'
              }`}></span>
              {document.status}
            </Badge>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground break-all">
            {document.title || document.filename}
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Left Column: Image Preview or File Icon Representation */}
          <div className="md:col-span-1 space-y-4">
            <Card className="overflow-hidden border-border/80 bg-card">
              <div className="h-56 w-full bg-muted/40 relative flex items-center justify-center overflow-hidden">
                {isImage && downloadUrl ? (
                  <img
                    src={downloadUrl}
                    alt={document.title || document.filename}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/10 flex flex-col items-center justify-center gap-3">
                    <div className="h-16 w-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shadow-sm border border-emerald-500/25">
                      <FileText className="h-8 w-8" />
                    </div>
                    <span className="text-xs uppercase tracking-widest font-bold text-muted-foreground/80">
                      {document.mimeType.split('/')[1]?.toUpperCase() || 'DOCUMENT'}
                    </span>
                  </div>
                )}
              </div>
              {isImage && downloadUrl && (
                <div className="p-3 border-t border-border/50 text-center bg-muted/20">
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Image in New Tab
                  </a>
                </div>
              )}
            </Card>

            {/* Document metadata checklist */}
            <Card className="border-border/80 bg-card p-4">
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-3">
                File Information
              </CardTitle>
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 text-xs text-foreground">
                  <FileCode className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-muted-foreground uppercase text-[9px] tracking-wider leading-none">Mime Type</p>
                    <p className="font-mono mt-1 text-[11px] truncate">{document.mimeType}</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-2.5 text-xs text-foreground">
                  <Layers className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-muted-foreground uppercase text-[9px] tracking-wider leading-none">File Size</p>
                    <p className="font-medium mt-1">{formatFileSize(document.size)}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 text-xs text-foreground">
                  <Calendar className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-muted-foreground uppercase text-[9px] tracking-wider leading-none">Uploaded On</p>
                    <p className="font-medium mt-1">{formatDate(document.createdAt)}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 text-xs text-foreground">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-muted-foreground uppercase text-[9px] tracking-wider leading-none">Original Name</p>
                    <p className="font-medium mt-1 break-all">{document.filename}</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Right Column: AI Analysis details & Summary */}
          <div className="md:col-span-2 space-y-6">
            <Card className="border-border/80 bg-card p-5 sm:p-6 flex flex-col space-y-4">
              <div className="space-y-1">
                <CardTitle className="text-base sm:text-lg font-bold">AI Document Analysis</CardTitle>
                <CardDescription className="text-xs">
                  Summary and categories processed by Magic Vault AI assistant
                </CardDescription>
              </div>

              <Separator className="bg-border/60" />

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h4 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Document Summary</h4>
                  <div className="bg-emerald-500/5 dark:bg-emerald-500/[0.02] border border-emerald-500/10 p-4 rounded-xl leading-relaxed text-sm text-foreground/90">
                    {document.summary || 'No summary was generated for this document.'}
                  </div>
                </div>

                {document.tags && document.tags.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs uppercase tracking-wider font-bold text-muted-foreground flex items-center gap-1.5">
                      <Tag className="h-3.5 w-3.5" />
                      Extracted Tags
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {document.tags.map((tag, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs bg-muted/30 px-2 py-0.5">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {isFailed && document.failureReason && (
                  <div className="space-y-1.5 border border-red-500/20 bg-red-500/5 p-4 rounded-xl">
                    <h4 className="text-xs uppercase tracking-wider font-bold text-red-600 dark:text-red-400">Processing Failure Reason</h4>
                    <p className="text-xs text-red-600 dark:text-red-400">{document.failureReason}</p>
                  </div>
                )}
              </div>
            </Card>
          </div>
          
        </div>

      </div>
    </div>
  );
}
