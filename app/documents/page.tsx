'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  User as UserIcon,
  FileText,
  Image as ImageIcon,
  Download,
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  HelpCircle
} from "lucide-react";
import { listDocuments, getDownloadLink, type VaultDocument } from '@/lib/documents-api';
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
  const [documents, setDocuments] = useState<VaultDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  async function loadDocuments() {
    setIsLoading(true);
    setError('');
    try {
      const res = await listDocuments();
      setDocuments(res.items);

      // Fetch download links for images to show previews
      const imageDocs = res.items.filter(d => d.mimeType?.startsWith('image/'));
      const urls: Record<string, string> = {};
      await Promise.all(
        imageDocs.map(async (doc) => {
          try {
            const url = await getDownloadLink(doc.id);
            urls[doc.id] = url;
          } catch (err) {
            console.error(`Failed to load preview for ${doc.filename}`, err);
          }
        })
      );
      setImageUrls(urls);
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
      toast.info(`Downloading ${doc.filename}...`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download document');
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
    <div className="min-h-screen w-screen flex flex-col bg-background">
      {/* Top Navbar */}
      <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => router.push('/')}>
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <MessageSquare className="h-5 w-5" />
          </div>
          <h3 className="font-semibold text-sm">Magic Vault</h3>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/')}
            className="text-xs h-8 gap-1.5"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push('/profile')}
            className="text-xs h-8 gap-1.5"
          >
            <UserIcon className="h-3.5 w-3.5" />
            Profile
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        
        {/* Dashboard Title Panel */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Saved Vault Documents</h1>
            <p className="text-xs text-muted-foreground">
              View, filter, and download all documents stored in your vault
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadDocuments}
            disabled={isLoading}
            className="w-full sm:w-auto h-8 text-xs gap-1.5"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="flex items-center gap-2 text-sm font-medium text-red-600 bg-red-500/10 border border-red-500/20 p-4 rounded-lg">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4">
          {/* Filters Section */}
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input Box */}
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, filename, or summary..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
            
            {/* Category Pills */}
            {categories.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
                <span className="text-xs font-semibold text-muted-foreground mr-1 uppercase">Category:</span>
                <div className="flex gap-1">
                  {categories.map((cat) => (
                    <Button
                      key={cat}
                      variant={selectedCategory === cat ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setSelectedCategory(cat)}
                      className="text-xs h-7 px-2.5"
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Documents Content list */}
          {isLoading ? (
            <Card className="border-border/60">
              <CardContent className="p-12 flex flex-col items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Loading vault documents...</p>
              </CardContent>
            </Card>
          ) : filteredDocuments.length === 0 ? (
            <Card className="border-border/60">
              <CardContent className="p-12 flex flex-col items-center justify-center text-center max-w-sm mx-auto">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
                  <HelpCircle className="h-5 w-5" />
                </div>
                <CardTitle className="text-sm font-semibold mb-1">
                  {searchQuery || selectedCategory !== 'all' ? 'No matching documents' : 'No documents saved yet'}
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed mb-4">
                  {searchQuery || selectedCategory !== 'all'
                    ? 'Try clearing your search filters or category selection.'
                    : 'Upload a document or photo in the chat to store it securely in your Magic Vault.'}
                </CardDescription>
                <Button
                  onClick={() => router.push('/')}
                  className="w-full text-xs h-9 bg-emerald-500 hover:bg-emerald-600 text-white border-0 gap-1.5"
                >
                  <MessageSquare className="h-4 w-4" />
                  Open Chat
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase px-1">
                {filteredDocuments.length} {filteredDocuments.length === 1 ? 'DOCUMENT' : 'DOCUMENTS'}
              </div>

              {/* Grid of Document Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {filteredDocuments.map((doc) => {
                  const isImage = doc.mimeType.startsWith('image/');
                  const isReady = doc.status === 'ready';
                  const isFailed = doc.status === 'failed';

                  return (
                    <Card
                      key={doc.id}
                      onClick={() => router.push(`/documents/${doc.id}`)}
                      className="border-border/80 hover:border-border hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden flex flex-col group bg-card"
                    >
                      {/* Document Preview Header */}
                      <div className="h-40 w-full bg-muted/30 relative flex items-center justify-center border-b border-border/50 overflow-hidden shrink-0">
                        {isImage && imageUrls[doc.id] ? (
                          <img
                            src={imageUrls[doc.id]}
                            alt={doc.title || doc.filename}
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/10 flex flex-col items-center justify-center gap-2">
                            <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                              <FileText className="h-6 w-6" />
                            </div>
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80">
                              {doc.mimeType.split('/')[1]?.toUpperCase() || 'DOCUMENT'}
                            </span>
                          </div>
                        )}
                        
                        {/* Category Badge overlay */}
                        <div className="absolute top-3 left-3 z-10">
                          <Badge variant="secondary" className="text-[9px] font-semibold py-0.5 px-2 bg-background/95 backdrop-blur-sm shadow-sm border border-border/40">
                            {doc.category}
                          </Badge>
                        </div>

                        {/* Status Badge overlay */}
                        <div className="absolute top-3 right-3 z-10">
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-semibold py-0.5 px-2 bg-background/95 backdrop-blur-sm shadow-sm border border-border/40 gap-1 ${
                              isReady
                                ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                                : isFailed
                                ? 'text-red-600 dark:text-red-400 bg-red-500/5'
                                : 'text-amber-600 dark:text-amber-400 bg-amber-500/5'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              isReady ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-amber-500'
                            }`}></span>
                            {doc.status}
                          </Badge>
                        </div>
                      </div>

                      {/* Document Details Content */}
                      <CardContent className="p-4 flex-1 flex flex-col justify-between">
                        <div className="space-y-2">
                          <h3 className="font-semibold text-sm leading-tight text-foreground line-clamp-1 group-hover:text-emerald-500 transition-colors">
                            {doc.title || doc.filename}
                          </h3>
                          
                          <p className="text-[10px] text-muted-foreground truncate">
                            {doc.filename} · {formatFileSize(doc.size)}
                          </p>

                          {doc.summary ? (
                            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                              {doc.summary}
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground/60 italic">
                              No summary generated yet.
                            </p>
                          )}
                        </div>

                        <div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground/80">
                            {formatDate(doc.createdAt)}
                          </span>

                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={downloadingId === doc.id}
                            onClick={(e) => {
                              e.stopPropagation(); // prevent card navigation
                              handleDownload(doc);
                            }}
                            className="h-7 text-[10px] font-bold gap-1 px-2.5 rounded-md hover:bg-emerald-500/10 hover:text-emerald-600 shrink-0"
                          >
                            {downloadingId === doc.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            Download
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
