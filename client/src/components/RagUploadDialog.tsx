import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, CheckCircle, BookOpen, Loader2 } from "lucide-react";
import type { RagDocument } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export function RagUploadDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingFile, setProcessingFile] = useState("");

  const { data: documents = [] } = useQuery<RagDocument[]>({
    queryKey: ["/api/rag/documents"],
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);

    for (const file of Array.from(files)) {
      try {
        setProcessingFile(file.name);
        const ext = file.name.toLowerCase().split(".").pop();

        if (ext === "pdf") {
          // Use the file upload endpoint for PDFs
          const formData = new FormData();
          formData.append("file", file);

          const res = await fetch(`${API_BASE}/api/rag/upload-file`, {
            method: "POST",
            headers: {
              "x-visitor-id": getVisitorId(),
            },
            body: formData,
          });

          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Upload failed");
          }

          const data = await res.json();
          queryClient.invalidateQueries({ queryKey: ["/api/rag/documents"] });
          toast({
            title: "PDF indexed",
            description: `"${data.filename}" — ${data.chunkCount} chunks from ${Math.round(data.charCount / 1000)}K characters.`,
          });
        } else {
          // Text-based files: read as text and use the JSON endpoint
          const text = await readFileAsText(file);
          if (text.trim()) {
            const res = await apiRequest("POST", "/api/rag/upload", {
              filename: file.name,
              content: text,
            });
            const data = await res.json();
            queryClient.invalidateQueries({ queryKey: ["/api/rag/documents"] });
            toast({
              title: "Document indexed",
              description: `"${data.filename}" processed into ${data.chunkCount} chunks.`,
            });
          }
        }
      } catch (err: any) {
        toast({
          title: "Error processing file",
          description: err.message || `Could not process "${file.name}".`,
          variant: "destructive",
        });
      }
    }

    setIsProcessing(false);
    setProcessingFile("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Upload Reference Books
          </DialogTitle>
          <DialogDescription>
            Upload Vedic astrology texts for RAG (Retrieval-Augmented Generation).
            The chatbot will reference these books when answering questions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            data-testid="dropzone-upload"
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Click to upload files</p>
            <p className="text-xs text-muted-foreground mt-1">
              Supports PDF, TXT, MD, and CSV files. Text is extracted, chunked, and indexed for search.
            </p>
            <div className="flex items-center justify-center gap-2 mt-3">
              <Badge variant="outline" className="text-xs">PDF</Badge>
              <Badge variant="outline" className="text-xs">TXT</Badge>
              <Badge variant="outline" className="text-xs">MD</Badge>
              <Badge variant="outline" className="text-xs">CSV</Badge>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,.text"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-upload"
            />
          </div>

          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing {processingFile}...
            </div>
          )}

          {documents.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">
                Indexed Documents ({documents.length})
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {documents.map((doc) => {
                  const isPdf = doc.filename.toLowerCase().endsWith(".pdf");
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm"
                      data-testid={`text-document-${doc.id}`}
                    >
                      {isPdf ? (
                        <BookOpen className="w-4 h-4 text-red-500 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-primary shrink-0" />
                      )}
                      <span className="truncate flex-1">{doc.filename}</span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        {doc.chunkCount} chunks
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Recommended: Upload classical texts like Brihat Parashara Hora Shastra, Phaladeepika,
            Jataka Parijata, or Saravali for richer AI readings.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

function getVisitorId(): string {
  // Match the visitor ID logic used in the main chat page
  return "default-visitor";
}
