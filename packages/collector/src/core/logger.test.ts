/**
 * Tests de sécurité du journal (§55, §62).
 *
 * Un secret ou une donnée personnelle qui atteint les logs d'un run GitHub
 * Actions devient publiquement consultable. Ces tests verrouillent l'expurgation.
 */

import { describe, expect, it } from 'vitest';
import { createLogger, formatPretty, redact, type LogEvent } from './logger.js';

describe('redact', () => {
  it('masque les clés sensibles quel que soit leur nommage', () => {
    const output = redact({
      TURSO_AUTH_TOKEN: 'valeur-fictive-de-test', // secret-scan-ignore
      apiKey: 'valeur-fictive-de-test', // secret-scan-ignore
      Authorization: 'Bearer xyz',
      cookie: 'session=abc',
      password: 'motdepasse',
      url: 'https://example.invalid',
    }) as Record<string, string>;

    expect(output['TURSO_AUTH_TOKEN']).toBe('[expurgé]');
    expect(output['apiKey']).toBe('[expurgé]');
    expect(output['Authorization']).toBe('[expurgé]');
    expect(output['cookie']).toBe('[expurgé]');
    expect(output['password']).toBe('[expurgé]');
    // Une valeur anodine n'est pas masquée : les logs doivent rester utiles.
    expect(output['url']).toBe('https://example.invalid');
  });

  it('masque les données personnelles du locataire', () => {
    const output = redact({
      tenantEmail: 'prenom.nom@example.invalid',
      TENANT_PHONE: '+33600000012',
    }) as Record<string, string>;

    expect(output['tenantEmail']).toBe('[expurgé]');
    expect(output['TENANT_PHONE']).toBe('[expurgé]');
  });

  it('masque un JWT glissé dans une chaîne libre', () => {
    // JWT entièrement fictif, assemblé à l'exécution pour ne pas laisser de
    // motif ressemblant à un vrai jeton dans le dépôt public.
    const fakeJwt = ['eyJhbGciOiJFZERTQSJ9', 'eyJzdWIiOiJ0ZXN0In0', 'c2lnbmF0dXJlX2ZpY3RpdmU'].join(
      '.',
    );
    const output = redact({ message: `échec avec ${fakeJwt}` }) as Record<string, string>;

    expect(output['message']).toContain('[expurgé]');
    expect(output['message']).not.toContain(fakeJwt);
  });

  it('masque une adresse e-mail dans un message d’erreur', () => {
    const output = redact({ message: 'contact : agence@example.invalid' }) as Record<
      string,
      string
    >;
    expect(output['message']).toBe('contact : [expurgé]');
  });

  it('masque un numéro de téléphone français dans un message', () => {
    const output = redact({ message: 'appeler le 06 00 00 00 12' }) as Record<string, string>;
    expect(output['message']).toBe('appeler le [expurgé]');
  });

  it('descend dans les objets et les tableaux imbriqués', () => {
    const output = redact({
      run: { sources: [{ id: 'laforet', authToken: 'secret' }] },
    }) as { run: { sources: { id: string; authToken: string }[] } };

    expect(output.run.sources[0]?.authToken).toBe('[expurgé]');
    expect(output.run.sources[0]?.id).toBe('laforet');
  });
});

describe('createLogger', () => {
  it('émet des événements structurés', () => {
    const events: LogEvent[] = [];
    const logger = createLogger({
      sink: (event) => events.push(event),
      now: () => '2026-08-14T12:00:00.000Z',
    });

    logger.info('source.completed', { source: 'laforet', listings: 5 });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      level: 'info',
      event: 'source.completed',
      at: '2026-08-14T12:00:00.000Z',
      fields: { source: 'laforet', listings: 5 },
    });
  });

  it('applique l’expurgation à l’écriture, pas à l’appel', () => {
    const events: LogEvent[] = [];
    const logger = createLogger({ sink: (event) => events.push(event) });

    // L'appelant n'a rien à faire : c'est le logger qui protège.
    logger.error('db.failed', { authToken: 'valeur-fictive' }); // secret-scan-ignore

    expect(events[0]?.fields['authToken']).toBe('[expurgé]');
  });

  it('filtre par niveau', () => {
    const events: LogEvent[] = [];
    const logger = createLogger({ minLevel: 'warn', sink: (event) => events.push(event) });

    logger.debug('ignoré');
    logger.info('ignoré');
    logger.warn('retenu');

    expect(events.map((event) => event.event)).toEqual(['retenu']);
  });

  it('propage les champs du logger dérivé', () => {
    const events: LogEvent[] = [];
    const logger = createLogger({ sink: (event) => events.push(event) }).child({
      source: 'laforet',
    });

    logger.info('page.parsed', { found: 3 });

    expect(events[0]?.fields).toEqual({ source: 'laforet', found: 3 });
  });
});

describe('formatPretty', () => {
  const event: LogEvent = {
    level: 'info',
    event: 'source.completed',
    at: '2026-08-16T06:43:12.000Z',
    fields: { source: 'foncia', listings: 15 },
  };

  it('rend une ligne lisible « HH:MM:SS NIVEAU event · clés=valeurs » (sans couleur)', () => {
    expect(formatPretty(event, false)).toBe(
      '06:43:12 INFO source.completed · source=foncia listings=15',
    );
  });

  it('n’ajoute pas de séparateur quand il n’y a aucun champ', () => {
    expect(formatPretty({ ...event, fields: {} }, false)).toBe('06:43:12 INFO source.completed');
  });

  it('sérialise les valeurs imbriquées de façon compacte', () => {
    const line = formatPretty(
      { ...event, fields: { written: { inserted: 2, updated: 1 } } },
      false,
    );
    expect(line).toContain('written={"inserted":2,"updated":1}');
  });
});
