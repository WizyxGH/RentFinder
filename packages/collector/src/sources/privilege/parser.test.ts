import { describe, expect, it } from 'vitest';
import { parseLocationLinks } from './parser.js';

const PAGE = 'https://www.agenceprivilege.com/fr/locations';

// Sur /fr/locations, les liens de fiches sont `/fr/propriété/{id}` — accent
// littéral OU %-encodé (%C3%A9). Les autres liens (nav, ventes) sont ignorés.
const HTML = `
<a href="/fr/propri%C3%A9t%C3%A9/87216707">Nice 3 pièces</a>
<a href="/fr/propriété/85675019">Nice studio</a>
<a href="/fr/propri%C3%A9t%C3%A9/87216707">doublon</a>
<a href="/fr/locations">Toutes les locations</a>
<a href="/fr/ventes">Ventes</a>
<a href="/fr/contact">Contact</a>`;

describe('parseLocationLinks (Privilège)', () => {
  const links = parseLocationLinks(HTML, PAGE);

  it('extrait les fiches location, dédoublonnées, sans les liens de nav', () => {
    expect(links.map((l) => l.reference).sort()).toEqual(['85675019', '87216707']);
  });

  it('construit une URL absolue exploitable', () => {
    const l = links.find((x) => x.reference === '85675019');
    expect(l?.canonicalUrl).toBe('https://www.agenceprivilege.com/fr/propri%C3%A9t%C3%A9/85675019');
  });
});
