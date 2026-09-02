/**
 * Pièces du dossier de candidature (§25) — onglet Profil.
 *
 * L'utilisateur dépose ses pièces UNE FOIS ; elles sont conservées en local
 * (data/, hors dépôt) et resservies à chaque candidature. Rien n'est jamais
 * envoyé automatiquement ni publiquement (§24, §26) — ce panneau ne fait que
 * stocker, lister, consulter et supprimer.
 */

import { useEffect, useRef, useState } from 'react';
import {
  deleteDocument,
  documentUrl,
  fetchDocuments,
  isDemoMode,
  uploadDocument,
  type DocumentInfo,
} from '../api/client.js';
import { Button } from '@/components/ui/button.js';
import { Card } from '@/components/ui/card.js';
import { Trash2 } from 'lucide-react';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function DocumentsSection(): React.JSX.Element | null {
  const [documents, setDocuments] = useState<readonly DocumentInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchDocuments()
      .then(setDocuments)
      .catch(() => {
        /* API locale indisponible : la section reste vide */
      });
  }, []);

  // En démo il n'y a ni API ni stockage : ne rien promettre qu'on ne tient pas.
  if (isDemoMode()) return null;

  const handleFiles = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const saved = await uploadDocument(file);
        setDocuments((current) => [...current.filter((doc) => doc.name !== saved.name), saved]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dépôt impossible');
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  };

  const handleDelete = async (name: string): Promise<void> => {
    setDocuments((current) => current.filter((doc) => doc.name !== name));
    try {
      await deleteDocument(name);
    } catch {
      setError('La suppression a échoué');
    }
  };

  return (
    <section aria-labelledby="documents-title" className="mt-6">
      <h2 id="documents-title" className="mb-2 text-lg font-bold">
        Documents de candidature
      </h2>

      <p className="border-l-3 border-primary pl-2.5 text-[0.85rem] text-muted-foreground">
        Déposez vos pièces une seule fois (CNI, bulletins de salaire, avis d’imposition, garant…).
        Elles sont conservées <strong>uniquement sur cet ordinateur</strong> (dossier{' '}
        <code>data/</code>, hors du dépôt public) et ne sont{' '}
        <strong>jamais envoyées automatiquement</strong> : c’est vous qui les joignez à vos
        candidatures.
      </p>

      <Card className="mt-3">
        {documents.length === 0 ? (
          <p className="text-[0.9rem] text-muted-foreground">
            Aucune pièce déposée pour l’instant.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {documents.map((doc) => (
              <li key={doc.name} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                <a
                  href={documentUrl(doc.name)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="min-w-0 flex-1 truncate text-[0.92rem] text-primary underline"
                >
                  {doc.name}
                </a>
                <span className="shrink-0 text-[0.8rem] text-muted-foreground">
                  {formatSize(doc.size)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(doc.name)}
                  aria-label={`Supprimer ${doc.name}`}
                  title={`Supprimer ${doc.name}`}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error !== null && (
          <p
            className="mt-2 rounded-xl border border-bad px-3 py-2 text-[0.88rem] text-bad"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="mt-3">
          <input
            ref={inputRef}
            id="document-upload"
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx"
            className="hidden"
            onChange={(event) => void handleFiles(event.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Dépôt en cours…' : 'Déposer des pièces'}
          </Button>
        </div>
      </Card>
    </section>
  );
}
