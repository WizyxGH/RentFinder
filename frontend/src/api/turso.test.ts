import { describe, expect, it } from 'vitest';
import { normalizeUrl, urlProblem } from './turso.js';

const REAL = 'libsql://rentfinder-exemple.aws-eu-west-1.turso.io';

describe('normalizeUrl', () => {
  it('accepte la valeur exacte', () => {
    expect(normalizeUrl(REAL)).toBe(REAL);
  });

  it('tolère la ligne entière copiée depuis .env', () => {
    // Le geste naturel est de copier la ligne, pas la valeur.
    expect(normalizeUrl(`TURSO_DATABASE_URL=${REAL}`)).toBe(REAL);
    expect(normalizeUrl(`TURSO_DATABASE_URL="${REAL}"`)).toBe(REAL);
  });

  it('tolère le schéma https, l’absence de schéma et la barre finale', () => {
    expect(normalizeUrl(REAL.replace('libsql://', 'https://'))).toBe(REAL);
    expect(normalizeUrl(REAL.replace('libsql://', ''))).toBe(REAL);
    expect(normalizeUrl(`${REAL}/`)).toBe(REAL);
  });

  it('tolère les espaces autour', () => {
    expect(normalizeUrl(`  ${REAL}  `)).toBe(REAL);
  });
});

describe('urlProblem', () => {
  it('laisse passer une vraie adresse de base', () => {
    expect(urlProblem(REAL)).toBeNull();
  });

  it('reconnaît l’adresse du tableau de bord, confusion la plus courante', () => {
    // Colle l'URL du site Turso plutôt que celle de la base et l'on obtient un
    // « 405 Not Allowed » d'un serveur sans rapport, impossible à interpréter.
    expect(urlProblem('libsql://app.turso.tech/wizyx/rentfinder')).toMatch(/tableau de bord/);
  });

  it('refuse un hôte qui n’est pas une base Turso', () => {
    expect(urlProblem('libsql://exemple.invalid')).toMatch(/turso\.io/);
  });

  it('refuse une adresse illisible', () => {
    expect(urlProblem('libsql://')).toMatch(/illisible|turso\.io/);
  });
});
