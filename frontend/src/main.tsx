import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { initTheme } from './theme.js';
import './styles.css';

// AVANT le premier rendu : sinon la page s'affiche une fraction de seconde
// dans le thème de l'appareil avant de basculer — un éclair blanc dans une
// chambre sombre, ce qu'on cherchait précisément à éviter.
initTheme();

const container = document.getElementById('root');
if (container === null) throw new Error('Élément #root introuvable');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
