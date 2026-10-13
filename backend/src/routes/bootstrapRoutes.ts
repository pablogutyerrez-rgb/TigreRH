import { Router, type Response } from 'express';
import { dataDb as adminDb, getCollectionRevision } from '../hybridDb.js';
import {
  type AuthenticatedRequest,
  requireAuth,
} from '../utils/authMiddleware.js';

const router = Router();
const collectionCache = new Map<string, {
  expiresAt: number;
  revision: number;
  data?: Array<Record<string, unknown>>;
  pending?: Promise<Array<Record<string, unknown>>>;
}>();
const COLLECTION_CACHE_TTL_MS = 30 * 1000;

const readCollection = async (name: string, bypassCache = false) => {
  const now = Date.now();
  const revision = getCollectionRevision(name);
  const cached = collectionCache.get(name);
  if (!bypassCache && cached?.revision === revision && cached?.data && cached.expiresAt > now) return cached.data;
  if (!bypassCache && cached?.revision === revision && cached?.pending) return cached.pending;

  const pending = adminDb.collection(name).get().then((snapshot) =>
    snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })) as Array<Record<string, unknown>>,
  );
  if (!bypassCache) {
    collectionCache.set(name, { expiresAt: now + COLLECTION_CACHE_TTL_MS, revision, pending });
  }

  try {
    const data = await pending;
    if (!bypassCache) {
      collectionCache.set(name, {
        data,
        revision,
        expiresAt: Date.now() + COLLECTION_CACHE_TTL_MS,
      });
    }
    return data;
  } catch (error) {
    if (!bypassCache) collectionCache.delete(name);
    throw error;
  }
};

const readStringField = (data: Record<string, unknown> | undefined, keys: string[]) => {
  if (!data) return '';
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const isAssignedTrainer = (session: Record<string, unknown>, userId: string) =>
  session.formador_id === userId ||
  [
    session.formador_ids,
    session.formador_capacitacion_inicial_ids,
    session.formador_ojt_ids,
  ].some((ids) => Array.isArray(ids) && ids.includes(userId));

const canAccessSurveyLink = (
  survey: Record<string, unknown>,
  session: Record<string, unknown> | undefined,
  userId: string,
  role: string,
) =>
  role === 'Administrador' ||
  (Array.isArray(survey.link_assigned_user_ids) && survey.link_assigned_user_ids.includes(userId)) ||
  Boolean(session && isAssignedTrainer(session, userId));

router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const surveyProgressOnly = req.query.scope === 'surveys';
    const canSeeAllSessions = [
      'Administrador',
      'Analista',
      'Coordinador',
      'Sistemas',
      'Reclutador',
    ].includes(user.rol);

    const [
      allUsers,
      allSessions,
      allParticipants,
      allAttendance,
      allConfirmations,
      allReopens,
      allLogs,
      allSurveys,
      allResponses,
      allOjtModules,
    ] = await Promise.all([
      surveyProgressOnly ? [] : readCollection('users'),
      readCollection('sessions'),
      surveyProgressOnly ? [] : readCollection('participants'),
      surveyProgressOnly ? [] : readCollection('attendance'),
      surveyProgressOnly ? [] : readCollection('confirmations'),
      surveyProgressOnly ? [] : readCollection('reopens'),
      surveyProgressOnly ? [] : readCollection('logs'),
      readCollection('surveys', surveyProgressOnly),
      readCollection('responses', surveyProgressOnly),
      readCollection('ojt_modules'),
    ]);

    const sessions = canSeeAllSessions
      ? allSessions
      : allSessions.filter((session) =>
          user.rol === 'Formador'
            ? isAssignedTrainer(session, user.uid)
            : session.reclutador_id === user.uid,
        );
    const sessionIds = new Set(sessions.map((session) => String(session.id)));
    const participants = allParticipants.filter((participant) =>
      sessionIds.has(String(participant.training_session_id)),
    );
    const participantIds = new Set(
      participants.map((participant) => String(participant.id)),
    );
    const accessibleOjtModuleIds = new Set(
      allOjtModules
        .filter((module) => Array.isArray(module.generation_ids) && module.generation_ids.some((id) => sessionIds.has(String(id))))
        .map((module) => String(module.id)),
    );
    const canAccessSurvey = (survey: Record<string, unknown>) =>
      sessionIds.has(String(survey.training_session_id)) ||
      accessibleOjtModuleIds.has(String(survey.ojt_module_id || '')) ||
      (survey.survey_type === 'operaciones' && canSeeAllSessions);
    const scopedSurveys = allSurveys.filter(canAccessSurvey);
    const surveysById = new Map(allSurveys.map((survey) => [String(survey.id), survey]));
    const sessionsById = new Map(allSessions.map((session) => [String(session.id), session]));
    const assignedSurveyIds = new Set(
      allSurveys
        .filter((survey) =>
          Array.isArray(survey.link_assigned_user_ids) && survey.link_assigned_user_ids.includes(user.uid),
        )
        .map((survey) => String(survey.id)),
    );
    const surveys = allSurveys
      .filter((survey) => canAccessSurvey(survey) || assignedSurveyIds.has(String(survey.id)))
      .map((survey) => {
        const session = sessionsById.get(String(survey.training_session_id));
        return canAccessSurveyLink(survey, session, user.uid, user.rol)
          ? survey
          : { ...survey, token: '' };
      });
    const responseSurveyIds = new Set(surveys.map((survey) => String(survey.id)));
    const normalizedResponses: Array<Record<string, unknown>> = allResponses.map((response) => {
      const survey = surveysById.get(String(response.training_survey_id || ''));
      const session = sessionsById.get(String(survey?.training_session_id || ''));
      const campaignName =
        readStringField(response, ['campaña', 'campana', 'campa�a']) ||
        readStringField(survey, ['campaña', 'campana', 'campa�a']) ||
        readStringField(session, ['campaña', 'campana', 'campa�a']);
      const generationCode =
        readStringField(session, ['generation_code', 'nombre_generacion']) ||
        readStringField(survey, ['codigo_generacion']) ||
        readStringField(response, ['codigo_generacion']);
      const isOjtSurvey = survey?.survey_type === 'ojt';
      const trainerId =
        (isOjtSurvey ? readStringField(survey, ['formador_id']) : '') ||
        readStringField(session, ['formador_id']) ||
        readStringField(survey, ['formador_id']) ||
        readStringField(response, ['formador_id']);
      const trainerName =
        (isOjtSurvey ? readStringField(survey, ['formador_nombre']) : '') ||
        readStringField(session, ['formador_nombre']) ||
        readStringField(survey, ['formador_nombre']) ||
        readStringField(response, ['formador_nombre']);

      return {
        ...response,
        campaña: campaignName,
        campana: campaignName,
        codigo_generacion: generationCode,
        formador_id: trainerId,
        formador_nombre: trainerName,
        classification:
          response.classification === 'Critico' ? 'Crítico' : response.classification,
      };
    });

    if (surveyProgressOnly) {
      res.set('Cache-Control', 'no-store').json({
        surveys,
        responses: normalizedResponses.filter((response) => responseSurveyIds.has(String(response.training_survey_id))),
      });
      return;
    }

    res.json({
      users:
        user.rol === 'Administrador' || user.rol === 'Analista' || user.module_access.includes('administrador:usuarios')
          ? allUsers
          : allUsers.filter(
              (profile) =>
                profile.id === user.uid ||
                ['Analista', 'Coordinador', 'Formador', 'Reclutador'].includes(String(profile.rol)),
            ),
      sessions,
      ojt_modules: allOjtModules.filter((module) =>
        user.rol === 'Administrador' ||
        (Array.isArray(module.generation_ids) && module.generation_ids.some((id) => sessionIds.has(String(id)))),
      ),
      participants,
      attendance: allAttendance.filter(
        (record) =>
          sessionIds.has(String(record.training_session_id)) ||
          participantIds.has(String(record.participant_id)),
      ),
      confirmations: allConfirmations.filter((record) =>
        sessionIds.has(String(record.training_session_id)),
      ),
      reopens: allReopens.filter((record) =>
        sessionIds.has(String(record.training_session_id)),
      ),
      logs: ['Administrador', 'Coordinador', 'Sistemas'].includes(user.rol)
        ? allLogs
        : [],
      surveys,
      responses: normalizedResponses.filter((response) =>
        responseSurveyIds.has(String(response.training_survey_id)),
      ),
    });
  } catch (error) {
    console.error('Bootstrap load error:', error);
    res.status(500).json({ message: 'No se pudieron cargar los datos de la plataforma.' });
  }
});

export { router as bootstrapRoutes };
