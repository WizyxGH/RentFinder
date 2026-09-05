/**
 * Premier parcours, après la toute première connexion (§39).
 *
 * DEUX RÉGLAGES CHANGENT TOUT LE RESTE. Le profil locataire compose les
 * messages de candidature — sans lui, chaque fiche affiche « renseignez votre
 * profil » au lieu d'un message prêt à envoyer. Les critères décident de ce que
 * la collecte ramène et signale. Les deux vivaient dans des sous-écrans des
 * paramètres, que rien n'invitait à ouvrir : on découvrait leur existence en
 * butant sur ce qu'ils empêchaient.
 *
 * TOUT EST FACULTATIF, ET ÇA SE VOIT. Chaque étape porte « Passer » avec le
 * même poids que « Continuer ». Un premier parcours qu'on ne peut pas quitter
 * est une porte fermée, pas un accueil — et l'application fonctionne sans ces
 * réglages, elle le faisait déjà.
 *
 * ON NE LE REVOIT PAS. La marque est posée en base et non dans le navigateur :
 * un compte se crée sur l'ordinateur et s'ouvre ensuite sur le téléphone.
 */

import { useState } from 'react';
import { ArrowRight, Check, Search, User } from './icons.js';
import type { TenantProfile } from '@rentfinder/shared';
import { ProfileForm } from './ProfileForm.js';
import { FiltersPanel } from './FiltersPanel.js';
import { Button } from '@/components/ui/button.js';

/** Les trois temps : on dit ce qu'on va demander, on demande, on conclut. */
type Step = 'welcome' | 'profile' | 'search';

interface OnboardingPanelProps {
  readonly profile: TenantProfile | null;
  readonly onSaveProfile: (profile: TenantProfile) => void;
  /** Referme le parcours, marque comprise : on ne le reverra plus. */
  readonly onFinish: () => void;
}

/** Un pas sur trois, pour savoir combien il en reste. */
function Progress({ step }: { readonly step: Step }): React.JSX.Element {
  const index = step === 'welcome' ? 0 : step === 'profile' ? 1 : 2;
  return (
    <div
      role="progressbar"
      aria-valuenow={index + 1}
      aria-valuemin={1}
      aria-valuemax={3}
      aria-label={`Étape ${index + 1} sur 3`}
      className="mb-6 flex gap-1.5"
    >
      {[0, 1, 2].map((at) => (
        <span
          key={at}
          className={`h-1 flex-1 rounded-full ${at <= index ? 'bg-primary' : 'bg-border'}`}
        />
      ))}
    </div>
  );
}

export function OnboardingPanel({
  profile,
  onSaveProfile,
  onFinish,
}: OnboardingPanelProps): React.JSX.Element {
  const [step, setStep] = useState<Step>('welcome');

  return (
    // `px-5` : cet écran vit HORS de la coquille commune, qui porte
    // habituellement les marges. Sans elles, le texte touchait les deux bords
    // du téléphone. `pb-10` laisse respirer le dernier bouton au-dessus de la
    // barre système.
    <div className="mx-auto max-w-md px-5 py-6 pb-10">
      <Progress step={step} />

      {step === 'welcome' && (
        <section aria-labelledby="welcome-title">
          <h1 id="welcome-title" className="text-2xl font-bold tracking-tight">
            Bienvenue sur Maïoun
          </h1>
          <p className="text-muted-foreground mt-2 text-[0.95rem]">
            Maïoun rassemble les annonces de location de dizaines de sites et d’agences, écarte les
            doublons, et vous prévient quand une annonce entre dans vos critères.
          </p>
          <p className="text-muted-foreground mt-3 text-[0.95rem]">
            Deux réglages rendent le reste utile. Vous pouvez les passer et y revenir quand vous
            voulez depuis les Paramètres.
          </p>

          <ul className="mt-5 flex flex-col gap-3">
            <li className="border-border flex items-start gap-3 rounded-xl border p-3">
              <User aria-hidden="true" className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <span>
                <strong className="block">Votre profil</strong>
                <span className="text-muted-foreground text-[0.88rem]">
                  Il compose vos messages de candidature. Rien n’est jamais envoyé sans vous.
                </span>
              </span>
            </li>
            <li className="border-border flex items-start gap-3 rounded-xl border p-3">
              <Search aria-hidden="true" className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <span>
                <strong className="block">Votre recherche</strong>
                <span className="text-muted-foreground text-[0.88rem]">
                  Budget, surface, quartier : ce qui décide de ce qu’on vous signale.
                </span>
              </span>
            </li>
          </ul>

          <div className="mt-6 flex flex-col gap-2">
            <Button className="w-full" onClick={() => setStep('profile')}>
              Commencer <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
            <Button variant="ghost" className="w-full" onClick={onFinish}>
              Passer et découvrir seul
            </Button>
          </div>
        </section>
      )}

      {step === 'profile' && (
        <section aria-labelledby="profile-title">
          <h1 id="profile-title" className="text-xl font-bold">
            Votre profil locataire
          </h1>
          <p className="text-muted-foreground mt-1 mb-4 text-[0.9rem]">
            Il sert à composer vos messages. Il reste dans votre navigateur et n’est jamais transmis
            à une agence sans votre geste.
          </p>
          {/* Le formulaire porte déjà « Enregistrer » et « Annuler » : on ne
            double pas ses boutons, on ajoute seulement la sortie. */}
          <ProfileForm
            initial={profile}
            onSave={(next) => {
              onSaveProfile(next);
              setStep('search');
            }}
            onCancel={() => setStep('search')}
          />
          <Button variant="ghost" className="mt-3 w-full" onClick={() => setStep('search')}>
            Passer cette étape
          </Button>
        </section>
      )}

      {step === 'search' && (
        <section aria-labelledby="search-title">
          <h1 id="search-title" className="text-xl font-bold">
            Votre recherche
          </h1>
          <p className="text-muted-foreground mt-1 mb-4 text-[0.9rem]">
            Ces filtres décident de ce qu’on vous signale. Ils se modifient à tout moment depuis «
            Trier et filtrer », et s’enregistrent au fur et à mesure.
          </p>
          <FiltersPanel />
          <div className="mt-6 flex flex-col gap-2">
            <Button className="w-full" onClick={onFinish}>
              <Check aria-hidden="true" className="size-4" /> C’est parti
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
