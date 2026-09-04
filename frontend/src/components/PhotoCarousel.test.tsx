import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PhotoCarousel } from './PhotoCarousel.js';

const URLS = ['https://x/1.jpg', 'https://x/2.jpg', 'https://x/3.jpg'];

describe('PhotoCarousel', () => {
  it('affiche des flèches et des points quand il y a plusieurs photos', () => {
    render(<PhotoCarousel urls={URLS} />);
    expect(screen.getByLabelText('Photo précédente')).toBeInTheDocument();
    expect(screen.getByLabelText('Photo suivante')).toBeInTheDocument();
    expect(screen.getByLabelText('Aller à la photo 1')).toHaveAttribute('aria-current', 'true');
  });

  it('n’affiche ni flèche ni point pour une seule photo', () => {
    render(<PhotoCarousel urls={['https://x/only.jpg']} />);
    expect(screen.queryByLabelText('Photo suivante')).not.toBeInTheDocument();
  });

  it('avance et boucle avec la flèche suivante', async () => {
    const user = userEvent.setup();
    render(<PhotoCarousel urls={URLS} />);
    const next = screen.getByLabelText('Photo suivante');

    await user.click(next);
    expect(screen.getByLabelText('Aller à la photo 2')).toHaveAttribute('aria-current', 'true');

    // 2 → 3 → boucle vers 1.
    await user.click(next);
    await user.click(next);
    expect(screen.getByLabelText('Aller à la photo 1')).toHaveAttribute('aria-current', 'true');
  });

  it('saute directement à une photo via son point', async () => {
    const user = userEvent.setup();
    render(<PhotoCarousel urls={URLS} />);
    await user.click(screen.getByLabelText('Aller à la photo 3'));
    expect(screen.getByLabelText('Aller à la photo 3')).toHaveAttribute('aria-current', 'true');
  });
});

describe('PhotoCarousel — glissement du doigt', () => {
  const PHOTOS = ['https://exemple.invalid/1.jpg', 'https://exemple.invalid/2.jpg'];

  /** Simule un glissement horizontal de `delta` pixels sur la piste. */
  function swipe(element: HTMLElement, delta: number): void {
    fireEvent.touchStart(element, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientX: 200 + delta }] });
  }

  it('avance d’une photo vers la gauche, recule vers la droite', () => {
    const { container } = render(<PhotoCarousel urls={PHOTOS} />);
    const root = container.firstElementChild as HTMLElement;
    const track = (): HTMLElement => root.firstElementChild as HTMLElement;

    expect(track().style.transform).toBe('translateX(-0%)');
    swipe(root, -120);
    expect(track().style.transform).toBe('translateX(-100%)');
    swipe(root, 120);
    expect(track().style.transform).toBe('translateX(-0%)');
  });

  it('ignore une hésitation du doigt', () => {
    // Sous le seuil, on fait défiler la page — pas le carrousel.
    const { container } = render(<PhotoCarousel urls={PHOTOS} />);
    const root = container.firstElementChild as HTMLElement;
    swipe(root, -10);
    expect((root.firstElementChild as HTMLElement).style.transform).toBe('translateX(-0%)');
  });

  it('ne fait rien avec une seule photo', () => {
    const { container } = render(<PhotoCarousel urls={[PHOTOS[0]!]} />);
    const root = container.firstElementChild as HTMLElement;
    swipe(root, -120);
    expect((root.firstElementChild as HTMLElement).style.transform).toBe('translateX(-0%)');
  });
});
