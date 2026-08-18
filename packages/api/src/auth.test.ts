/**
 * Tests d'authentification de l'API (§55).
 */

import { describe, expect, it } from 'vitest';
import { corsHeaders, extractBearer, requireAuth, timingSafeEqual } from './auth.js';

const withAuth = (token: string): Request =>
  new Request('https://api.example.invalid/api/listings', {
    headers: { authorization: `Bearer ${token}` },
  });

describe('timingSafeEqual', () => {
  it('reconnaît deux chaînes identiques', () => {
    expect(timingSafeEqual('jeton-secret', 'jeton-secret')).toBe(true);
  });

  it('rejette deux chaînes différentes', () => {
    expect(timingSafeEqual('jeton-secret', 'jeton-secrez')).toBe(false);
  });

  it('rejette des longueurs différentes sans court-circuiter', () => {
    expect(timingSafeEqual('court', 'beaucoup-plus-long')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });

  it('gère les caractères non ASCII', () => {
    expect(timingSafeEqual('jetoné', 'jetoné')).toBe(true);
    expect(timingSafeEqual('jetoné', 'jetone')).toBe(false);
  });
});

describe('extractBearer', () => {
  it('extrait le jeton d’un en-tête Bearer', () => {
    expect(extractBearer(withAuth('abc123'))).toBe('abc123');
  });

  it('accepte une casse variable', () => {
    const request = new Request('https://api.example.invalid/', {
      headers: { authorization: 'bearer abc123' },
    });
    expect(extractBearer(request)).toBe('abc123');
  });

  it('rend null sans en-tête', () => {
    expect(extractBearer(new Request('https://api.example.invalid/'))).toBeNull();
  });
});

describe('requireAuth', () => {
  it('laisse passer une requête avec le bon jeton', () => {
    expect(requireAuth(withAuth('bon-jeton'), 'bon-jeton')).toBeNull();
  });

  it('refuse une requête sans jeton', async () => {
    const response = requireAuth(new Request('https://api.example.invalid/'), 'bon-jeton');
    expect(response?.status).toBe(401);
  });

  it('refuse un jeton incorrect', () => {
    expect(requireAuth(withAuth('mauvais'), 'bon-jeton')?.status).toBe(401);
  });

  it('ferme l’API si le jeton serveur n’est pas configuré', () => {
    // Une erreur de déploiement ne doit jamais ouvrir l'accès aux données.
    expect(requireAuth(withAuth('peu-importe'), undefined)?.status).toBe(503);
    expect(requireAuth(withAuth('peu-importe'), '')?.status).toBe(503);
  });

  it('ne divulgue jamais le jeton attendu dans la réponse', async () => {
    const response = requireAuth(withAuth('mauvais'), 'jeton-tres-secret');
    const body = await response?.text();
    expect(body).not.toContain('jeton-tres-secret');
  });
});

describe('corsHeaders', () => {
  it('n’autorise jamais toutes les origines', () => {
    const headers = corsHeaders('https://example-user.github.io');
    expect(headers['access-control-allow-origin']).toBe('https://example-user.github.io');
    expect(headers['access-control-allow-origin']).not.toBe('*');
  });
});
