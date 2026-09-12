import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRoutes } from './routes/authRoutes.js';
import { bootstrapRoutes } from './routes/bootstrapRoutes.js';
import { operationRoutes } from './routes/operationRoutes.js';
import { prospectRoutes } from './routes/prospectRoutes.js';
import { publicSurveyRoutes } from './routes/publicSurveyRoutes.js';
import { selectionRoutes } from './routes/selectionRoutes.js';
import { surveyRoutes } from './routes/surveyRoutes.js';
import { trainingRoutes } from './routes/trainingRoutes.js';
import { trainingVariableRoutes } from './routes/trainingVariableRoutes.js';
import { userRoutes } from './routes/userRoutes.js';
import { getPostgresPool } from './postgres.js';
import { ensureHybridSchema } from './hybridDb.js';

const app = express();
const port = Number(process.env.PORT || 8080);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDistCandidates = [
  path.resolve(__dirname, '../../dist'),
  path.resolve(__dirname, '../public'),
];
const frontendDistPath = frontendDistCandidates.find((candidate) =>
  fs.existsSync(path.join(candidate, 'index.html')),
);

const railwayPublicOrigin = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : undefined;

const allowedOrigins = new Set(
  [
    process.env.FRONTEND_ORIGIN,
    railwayPublicOrigin,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
  ].filter(Boolean),
);

const isLocalDevelopmentOrigin = (origin: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || isLocalDevelopmentOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS.'));
    },
  }),
);
app.use(express.json({ limit: '15mb' }));

app.get('/health', async (_req, res) => {
  try {
    await getPostgresPool().query('SELECT 1');
    res.json({
      ok: true,
      frontend: Boolean(frontendDistPath),
      primaryDatabase: 'postgresql',
      firestoreMode: 'disabled-for-runtime-data',
    });
  } catch (error) {
    console.error('PostgreSQL health check failed:', error);
    res.status(503).json({
      ok: false,
      frontend: Boolean(frontendDistPath),
      primaryDatabase: 'postgresql',
    });
  }
});

app.get('/config.js', (_req, res) => {
  const publicConfig = {
    VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || '',
    VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || '',
    VITE_FIREBASE_STORAGE_BUCKET: process.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    VITE_FIREBASE_MESSAGING_SENDER_ID:
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || '',
    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || '',
  };

  res
    .type('application/javascript')
    .set('Cache-Control', 'no-store')
    .send(`window.__FDR_CONFIG__ = ${JSON.stringify(publicConfig)};`);
});

app.use('/api/auth', authRoutes);
app.use('/api/bootstrap', bootstrapRoutes);
app.use('/api/operations', operationRoutes);
app.use('/api/prospects', prospectRoutes);
app.use('/api/public-surveys', publicSurveyRoutes);
app.use('/api/selection', selectionRoutes);
app.use('/api/surveys', surveyRoutes);
app.use('/api/trainings', trainingRoutes);
app.use('/api/formacion/variables', trainingVariableRoutes);
app.use('/api/users', userRoutes);

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  console.error('Unhandled backend error:', error);
  const message = error instanceof Error ? error.message : 'Error interno del servidor.';
  const isPayloadTooLarge = 'type' in Object(error) && Object(error).type === 'entity.too.large';
  res.status(isPayloadTooLarge ? 413 : 500).json({
    message: isPayloadTooLarge
      ? 'El archivo es demasiado grande. Usa un CV de máximo 10 MB.'
      : message,
  });
});

if (frontendDistPath) {
  app.use(express.static(frontendDistPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

const start = async () => {
  await ensureHybridSchema();
  app.listen(port, '0.0.0.0', () => {
    console.log(`FDR backend listening on port ${port}`);
    console.log(
      frontendDistPath
        ? `Serving frontend from ${frontendDistPath}`
        : `Frontend build not found. Checked: ${frontendDistCandidates.join(', ')}`,
    );
  });
};

void start().catch((error) => {
  console.error('Backend startup failed:', error);
  process.exitCode = 1;
});
