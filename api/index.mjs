// Fonction Vercel : sert l'API Velora (apps/api, compilée dans dist/) sous /api, sur le même domaine que le site.
// Contrairement à l'ancien serveur gratuit Render, elle ne s'endort jamais : plus d'attente au premier chargement.
import { buildApp } from '../apps/api/dist/app.js';

// Construite une fois par instance, puis réutilisée par les requêtes suivantes (Fluid Compute).
const ready = buildApp().then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req, res) {
  const app = await ready;
  // Le site appelle /api/... ; les routes de l'API sont déclarées sans ce préfixe.
  req.url = req.url.replace(/^\/api(?=\/|\?|$)/, '') || '/';
  if (req.url.startsWith('?')) req.url = `/${req.url}`;
  app.server.emit('request', req, res);
}
