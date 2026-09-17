import { App } from './app/App.js';

const container = document.getElementById('app-container');
const app = new App(container);
app.start();

const loadingScreen = document.getElementById('loading-screen');
requestAnimationFrame(() => {
  requestAnimationFrame(() => loadingScreen.classList.add('hidden'));
});

const hint = document.getElementById('desktop-hint');
setTimeout(() => hint.classList.add('faded'), 9000);

if (import.meta.env.DEV) {
  window.__app = app;
}
