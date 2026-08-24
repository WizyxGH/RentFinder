import { describe, expect, it } from 'vitest';
import { parseAlertEmail, resolvePortalUrl } from './parser.js';

describe('resolvePortalUrl', () => {
  it('reconnaît un lien Leboncoin direct', () => {
    const r = resolvePortalUrl('https://www.leboncoin.fr/ad/locations/2812345678');
    expect(r?.portal.id).toBe('leboncoin');
  });

  it('dénoue un lien de tracking qui enveloppe l’URL du portail', () => {
    const wrapped =
      'https://clic.leboncoin-mail.fr/redirect?u=' +
      encodeURIComponent(
        'https://www.seloger.com/annonces/locations/appartement/nice/123456789.htm',
      );
    const r = resolvePortalUrl(wrapped);
    expect(r?.portal.id).toBe('seloger');
    expect(r?.url.hostname).toBe('www.seloger.com');
  });

  it('ignore un lien hors portail', () => {
    expect(resolvePortalUrl('https://exemple.fr/aide')).toBeNull();
  });

  it('déplie l’URL Bien’ici encodée en base64 dans le lien de tracking', () => {
    // Bien'ici enveloppe la vraie URL en base64url dans le dernier segment.
    const real = 'https://www.bienici.com/annonce/ag123456-789?at_canal=CRM';
    const b64 = Buffer.from(real).toString('base64url');
    const wrapped = `https://link.bienici.com/lnk/AAAA/8/HASH/${b64}`;
    const r = resolvePortalUrl(wrapped);
    expect(r?.portal.id).toBe('bienici');
    expect(r?.url.hostname).toBe('www.bienici.com');
    expect(r?.canonical).toBe(true);
  });

  it('reconnaît un lien de tracking SeLoger opaque sans URL réelle', () => {
    const r = resolvePortalUrl('https://click.by.seloger.com/?qs=ABB7InYiOjEsImQ9');
    expect(r?.portal.id).toBe('seloger');
    expect(r?.canonical).toBe(false); // sous-domaine de tracking → pas canonique
  });
});

const EMAIL = `
<html><body>
  <table>
    <tr>
      <td>
        <a href="https://clic.lbc.fr/r?u=${encodeURIComponent(
          'https://www.leboncoin.fr/ad/locations/2812345678',
        )}">
          <img src="https://img.leboncoin.fr/photo1.jpg" alt="photo">
          Bel appartement T2 à Nice — 680 € — 32 m²
        </a>
      </td>
    </tr>
    <tr>
      <td>
        <a href="https://www.seloger.com/annonces/locations/appartement/nice/987654321.htm">
          Studio meublé Nice centre
        </a>
        <div>Loyer 590 € CC · 24 m²</div>
      </td>
    </tr>
    <tr><td><a href="https://aide.exemple.fr/faq">Se désabonner</a></td></tr>
    <tr><td><a href="https://www.leboncoin.fr/ad/locations/2812345678">doublon</a></td></tr>
  </table>
</body></html>`;

describe('parseAlertEmail', () => {
  const listings = parseAlertEmail(EMAIL);

  it('extrait une annonce par portail, dédoublonnée sur la référence', () => {
    expect(listings).toHaveLength(2);
    const refs = listings.map((l) => l.sourceRef).sort();
    expect(refs).toEqual(['leboncoin:2812345678', 'seloger:987654321']);
  });

  it('déplie le lien de tracking et garde l’URL canonique du portail', () => {
    const lbc = listings.find((l) => l.extra?.['portal'] === 'leboncoin');
    expect(lbc?.sourceUrl).toBe('https://www.leboncoin.fr/ad/locations/2812345678');
    expect(lbc?.priceText).toContain('680');
    expect(lbc?.areaText).toBe('32 m²');
    expect(lbc?.imageUrls?.[0]).toContain('photo1.jpg');
  });

  it('récupère prix/surface depuis le bloc voisin (SeLoger)', () => {
    const sl = listings.find((l) => l.extra?.['portal'] === 'seloger');
    expect(sl?.priceText).toContain('590');
    expect(sl?.areaText).toBe('24 m²');
    expect(sl?.title).toContain('Studio');
  });

  it('ignore les liens hors annonce (désabonnement, aide)', () => {
    expect(
      listings.every((l) => l.sourceUrl.includes('leboncoin') || l.sourceUrl.includes('seloger')),
    ).toBe(true);
  });
});

// Gabarit RÉEL des digests SeLoger : chaque annonce est un bloc « tableau » où
// image, titre et prix sont des liens de TRACKING distincts (click.by.seloger),
// et la ligne ville « Nice, 06000 » précède le prix « 570 € ».
const SELOGER_DIGEST = `
<table>
  <tbody>
    <tr>
      <td style="background-image: url('https://mms.seloger.com/a/b/c/photo.jpg?ci_seal=xyz'); width:250px">
        <a href="https://click.by.seloger.com/?qs=IMG001"><img src="https://mms.seloger.com/static/logo.png" /></a>
      </td>
    </tr>
    <tr>
      <td><a href="https://click.by.seloger.com/?qs=TITLE01">Appartement • 1 pièce • 12 m² <br /> Nice, 06000</a></td>
      <td align="right"><a href="https://click.by.seloger.com/?qs=PRICE01">570 €</a></td>
    </tr>
  </tbody>
</table>`;

describe('parseAlertEmail — digest SeLoger réel (liens de tracking)', () => {
  const [listing, ...rest] = parseAlertEmail(SELOGER_DIGEST);

  it('produit une seule annonce malgré les 3 liens de tracking distincts', () => {
    expect(rest).toHaveLength(0);
    expect(listing?.extra?.['portal']).toBe('seloger');
  });

  it('lit le prix sans avaler le code postal collé (« 06000 570 € » → « 570 € »)', () => {
    expect(listing?.priceText).toBe('570 €');
    expect(listing?.areaText).toBe('12 m²');
    expect(listing?.cityText).toBe('Nice');
    expect(listing?.postalCodeText).toBe('06000');
  });

  it('garde le lien de tracking comme URL (il redirige vers l’annonce)', () => {
    expect(listing?.sourceUrl).toContain('click.by.seloger.com');
    // Faute d'identifiant exposé, la référence est dérivée du contenu.
    expect(listing?.sourceRef).toMatch(/^seloger:/);
  });

  it('extrait la photo depuis background-image et ignore le logo', () => {
    // SeLoger met la vraie photo en CSS `background-image`, pas en <img> ;
    // le seul <img> présent est un logo (à écarter).
    expect(listing?.imageUrls?.[0]).toBe('https://mms.seloger.com/a/b/c/photo.jpg?ci_seal=xyz');
  });
});
