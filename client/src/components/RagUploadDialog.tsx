import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, CheckCircle } from "lucide-react";
import type { RagDocument } from "@shared/schema";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RagUploadDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: documents = [] } = useQuery<RagDocument[]>({
    queryKey: ["/api/rag/documents"],
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ filename, content }: { filename: string; content: string }) => {
      const res = await apiRequest("POST", "/api/rag/upload", { filename, content });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/rag/documents"] });
      toast({
        title: "Document indexed",
        description: `"${data.filename}" processed into ${data.chunkCount} chunks for RAG.`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Upload error", description: e.message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);

    for (const file of Array.from(files)) {
      try {
        const text = await readFileAsText(file);
        if (text.trim()) {
          await uploadMutation.mutateAsync({ filename: file.name, content: text });
        }
      } catch (err) {
        toast({
          title: "Error reading file",
          description: `Could not read "${file.name}". Only text-based files (.txt, .md, .csv) are supported.`,
          variant: "destructive",
        });
      }
    }

    setIsProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Reference Books</DialogTitle>
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
              Supports .txt, .md, .csv files. Text content will be chunked and indexed.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.text"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              data-testid="input-file-upload"
            />
          </div>

          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Processing files...
            </div>
          )}

          {documents.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Indexed Documents</h4>
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm"
                    data-testid={`text-document-${doc.id}`}
                  >
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="truncate flex-1">{doc.filename}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {doc.chunkCount} chunks
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
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
