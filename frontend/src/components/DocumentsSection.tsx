/**
 * Pièces du dossier de candidature (§25) — écran Paramètres.
 *
 * L'utilisateur dépose ses pièces UNE FOIS ; elles sont conservées en local
 * (data/, hors dépôt) et resservies à chaque candidature. Rien n'est jamais
 * envoyé automatiquement ni publiquement (§24, §26) — ce panneau ne fait que
 * stocker, lister, consulter et supprimer.
 *
 * Les pièces sont rangées par emplacement, selon la liste limitative du décret
 * n° 2015-1437. Une liste plate ne disait pas ce qu'il restait à fournir, alors
 * que c'est la seule question qui compte au moment de candidater. Chaque
 * emplacement est REPLIÉ tant qu'il n'est pas ouvert : neuf blocs dépliés
 * faisaient une page à faire défiler sans fin.
 *
 * Le rangement passe par un préfixe dans le nom du fichier : le stockage local
 * reste un simple dossier, sans index à tenir.
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
import { ChevronDown, FileCheck2, FileWarning, Trash2, Upload } from 'lucide-react';
import { SettingsGroup, SettingsRow } from './SettingsRow.js';
import {
  DOSSIER_SLOTS,
  FORBIDDEN_PIECES,
  displayName,
  slotOf,
  slotPrefix,
  type DossierSlot,
} from '../dossier.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx';

/** Une pièce déposée : lien de consultation, poids, suppression. */
function DocumentRow({
  doc,
  onDelete,
}: {
  readonly doc: DocumentInfo;
  readonly onDelete: (name: string) => void;
}): React.JSX.Element {
  const label = displayName(doc.name);
  return (
    <li className="flex items-center gap-2 py-1.5">
      <a
        href={documentUrl(doc.name)}
        target="_blank"
        rel="noreferrer noopener"
        className="min-w-0 flex-1 truncate text-[0.9rem] text-primary underline"
      >
        {label}
      </a>
      <span className="shrink-0 text-[0.8rem] text-muted-foreground">{formatSize(doc.size)}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onDelete(doc.name)}
        aria-label={`Supprimer ${label}`}
        title={`Supprimer ${label}`}
      >
        <Trash2 aria-hidden="true" className="size-4" />
      </Button>
    </li>
  );
}

/** Un emplacement du dossier : replié, il ne montre que son état. */
function Slot({
  slot,
  documents,
  open,
  busy,
  onToggle,
  onAdd,
  onDelete,
}: {
  readonly slot: DossierSlot;
  readonly documents: readonly DocumentInfo[];
  readonly open: boolean;
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly onAdd: (slotId: string, files: FileList | null) => void;
  readonly onDelete: (name: string) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const filled = documents.length > 0;

  return (
    <SettingsRow
      Icon={filled ? FileCheck2 : FileWarning}
      tone={filled ? 'done' : 'muted'}
      label={slot.label}
      badge={filled ? `${documents.length} pièce${documents.length > 1 ? 's' : ''}` : 'À fournir'}
      hint={open ? slot.hint : undefined}
      onClick={onToggle}
      trailing={
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      }
    >
      {open ? (
        <>
          {filled && (
            <ul className="flex flex-col divide-y divide-border">
              {documents.map((doc) => (
                <DocumentRow key={doc.name} doc={doc} onDelete={onDelete} />
              ))}
            </ul>
          )}
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              onAdd(slot.id, event.target.files);
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={filled ? 'mt-2' : ''}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Upload aria-hidden="true" className="size-4" />
            {filled ? 'Ajouter une pièce' : 'Joindre'}
          </Button>
        </>
      ) : undefined}
    </SettingsRow>
  );
}

export function DocumentsSection(): React.JSX.Element | null {
  const [documents, setDocuments] = useState<readonly DocumentInfo[]>([]);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchDocuments()
      .then(setDocuments)
      .catch(() => {
        /* API locale indisponible : la section reste vide */
      });
  }, []);

  // En démo il n'y a ni API ni stockage : ne rien promettre qu'on ne tient pas.
  if (isDemoMode()) return null;

  const handleFiles = async (slotId: string | null, files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const named =
          slotId === null
            ? file
            : new File([file], `${slotPrefix(slotId)}${file.name}`, { type: file.type });
        const saved = await uploadDocument(named);
        setDocuments((current) => [...current.filter((doc) => doc.name !== saved.name), saved]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Dépôt impossible');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (name: string): void => {
    setDocuments((current) => current.filter((doc) => doc.name !== name));
    void deleteDocument(name).catch(() => setError('La suppression a échoué'));
  };

  const inSlot = (slotId: string): DocumentInfo[] =>
    documents.filter((doc) => slotOf(doc.name) === slotId);
  // Pièces déposées avant que le rangement n'existe, ou hors liste : elles ne
  // disparaissent pas de l'écran pour autant.
  const unsorted = documents.filter((doc) => slotOf(doc.name) === null);

  const tenant = DOSSIER_SLOTS.filter((slot) => !slot.forGuarantor);
  const guarantor = DOSSIER_SLOTS.filter((slot) => slot.forGuarantor);
  const done = (slots: readonly DossierSlot[]): number =>
    slots.filter((slot) => inSlot(slot.id).length > 0).length;

  const group = (slots: readonly DossierSlot[]): React.ReactNode =>
    slots.map((slot) => (
      <Slot
        key={slot.id}
        slot={slot}
        documents={inSlot(slot.id)}
        open={openSlot === slot.id}
        busy={busy}
        onToggle={() => setOpenSlot((current) => (current === slot.id ? null : slot.id))}
        onAdd={(id, files) => void handleFiles(id, files)}
        onDelete={handleDelete}
      />
    ));

  return (
    <section aria-labelledby="documents-title" className="mt-8">
      <h2 id="documents-title" className="text-lg font-bold">
        Dossier de candidature
      </h2>
      <p className="mt-1 text-[0.85rem] text-muted-foreground">
        Conservé <strong>uniquement sur cet ordinateur</strong> (dossier <code>data/</code>, hors du
        dépôt public) et <strong>jamais envoyé automatiquement</strong> : c’est vous qui joignez vos
        pièces.
      </p>

      {error !== null && (
        <p
          className="mt-3 rounded-xl border border-bad px-3 py-2 text-[0.88rem] text-bad"
          role="alert"
        >
          {error}
        </p>
      )}

      <SettingsGroup title="Vos pièces" count={`${done(tenant)}/${tenant.length}`}>
        {group(tenant)}
      </SettingsGroup>

      <SettingsGroup title="Garant" count={`${done(guarantor)}/${guarantor.length}`}>
        {group(guarantor)}
      </SettingsGroup>

      {unsorted.length > 0 && (
        <SettingsGroup title="Non classées">
          <li className="rounded-xl border border-border p-3">
            <ul className="flex flex-col divide-y divide-border">
              {unsorted.map((doc) => (
                <DocumentRow key={doc.name} doc={doc} onDelete={handleDelete} />
              ))}
            </ul>
          </li>
        </SettingsGroup>
      )}

      {/* La liste du décret est LIMITATIVE : le savoir évite d'en donner plus
        que nécessaire, ce qui est le sens même du §26. */}
      <details className="mt-4 text-[0.85rem] text-muted-foreground">
        <summary className="cursor-pointer">Ce qu’un bailleur ne peut pas exiger</summary>
        <p className="mt-1.5">
          La liste ci-dessus est fixée par le décret n° 2015-1437 et elle est limitative. Sont
          notamment interdits : {FORBIDDEN_PIECES.join(', ')}.
        </p>
      </details>
    </section>
  );
}
