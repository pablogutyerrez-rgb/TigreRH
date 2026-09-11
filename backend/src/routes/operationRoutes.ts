import { raw, Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { adminRealtimeDb, adminStorage } from '../firebaseAdmin.js';
import { dataDb as adminDb } from '../hybridDb.js';
import {
  deleteCvFromGoogleDrive,
  downloadCvFromGoogleDrive,
  uploadCvToGoogleDrive,
} from '../services/googleDriveService.js';
import {
  type AuthenticatedRequest,
  requireAuth,
  requireRole,
} from '../utils/authMiddleware.js';

const router = Router();
const recordSchema = z.object({ id: z.string().min(1), training_session_id: z.string().min(1) }).passthrough();
const cvUploadSchema = z.object({
  training_session_id: z.string().min(1),
  file_name: z.string().min(1).max(180),
  content_type: z.string().min(1).max(140),
  base64: z.string().min(1).optional(),
});

const cvContentTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const cvAllowedRoles = ['Administrador', 'Analista', 'Reclutador', 'Coordinador'];
const cvViewerRoles = ['Administrador', 'Analista', 'Reclutador', 'Coordinador', 'Formador'];

const safeFileName = (fileName: string) =>
  fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 160);

const safePathSegment = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, 100) || 'POSTULANTE';

const isAllowedCvFile = (fileName: string, contentType: string) =>
  cvContentTypes.has(contentType) || /\.(pdf|doc|docx)$/i.test(fileName);

const getGoogleDriveUploadError = (error: unknown) => {
  const detail = error instanceof Error ? error.message : 'error desconocido';
  const normalized = detail.toLowerCase();

  if (normalized.includes('file not found') || normalized.includes('notfound')) {
    return 'La carpeta de Google Drive no existe o no fue compartida con la cuenta de servicio del backend.';
  }
  if (normalized.includes('storagequotaexceeded') || normalized.includes('service accounts do not have storage quota')) {
    return 'La cuenta de servicio no tiene cuota propia. Usa una carpeta de una Unidad compartida y agrégala como Administrador de contenido.';
  }
  if (normalized.includes('access not configured') || normalized.includes('has not been used') || normalized.includes('disabled')) {
    return 'La API de Google Drive no está habilitada en el proyecto de Google Cloud del backend.';
  }
  if (normalized.includes('insufficient') || normalized.includes('permission')) {
    return 'La cuenta de servicio del backend no tiene permisos de edición sobre la carpeta de Google Drive.';
  }

  return detail;
};

const getStorageBucketCandidates = (preferredBucket?: string) => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  return Array.from(new Set([
    preferredBucket,
    process.env.VITE_FIREBASE_STORAGE_BUCKET,
    projectId ? `${projectId}.firebasestorage.app` : undefined,
    process.env.FIREBASE_STORAGE_BUCKET,
    projectId ? `${projectId}.appspot.com` : undefined,
  ].filter((bucket): bucket is string => Boolean(bucket))));
};

const isAssignedTrainer = (data: Record<string, unknown> | undefined, userId: string) =>
  data?.formador_id === userId ||
  (Array.isArray(data?.formador_ids) && data.formador_ids.includes(userId));

const hasSplitTrainerAssignment = (data: Record<string, unknown> | undefined) =>
  Array.isArray(data?.formador_capacitacion_inicial_ids) || Array.isArray(data?.formador_ojt_ids);

const isInitialTrainer = (data: Record<string, unknown> | undefined, userId: string) =>
  hasSplitTrainerAssignment(data)
    ? Array.isArray(data?.formador_capacitacion_inicial_ids) && data.formador_capacitacion_inicial_ids.includes(userId)
    : isAssignedTrainer(data, userId);

const isOjtTrainer = (data: Record<string, unknown> | undefined, userId: string) =>
  hasSplitTrainerAssignment(data)
    ? Array.isArray(data?.formador_ojt_ids) && data.formador_ojt_ids.includes(userId)
    : isAssignedTrainer(data, userId);

const canTrainerEditAttendanceDay = (data: Record<string, unknown> | undefined, userId: string, day: number) =>
  (day <= 5 && isInitialTrainer(data, userId)) || (day >= 6 && isOjtTrainer(data, userId));

const normalizeAttendanceStatus = (value: unknown) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

const isDropoutAttendance = (value: unknown) =>
  ['desistio', 'baja'].includes(normalizeAttendanceStatus(value));

const ownsSession = async (req: AuthenticatedRequest, sessionId: string) => {
  const session = await adminDb.collection('sessions').doc(sessionId).get();
  if (!session.exists) return false;
  if (req.user!.rol === 'Formador') return isAssignedTrainer(session.data(), req.user!.uid);
  if (req.user!.rol === 'Reclutador') {
    const data = session.data();
    return data?.reclutador_id === req.user!.uid ||
      (Array.isArray(data?.reclutador_ids) && data.reclutador_ids.includes(req.user!.uid));
  }
  return true;
};

const canAccessParticipant = async (req: AuthenticatedRequest, participantId: string) => {
  const participantDoc = await adminDb.collection('participants').doc(participantId).get();
  if (!participantDoc.exists) return null;
  const participant = { id: participantDoc.id, ...participantDoc.data() } as Record<string, unknown>;
  const sessionId = String(participant.training_session_id || '');
  if (!sessionId || !(await ownsSession(req, sessionId))) return null;
  return { participantDoc, participant, sessionId };
};

router.put(
  '/attendance/:id',
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Formador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = recordSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success || !(await ownsSession(req, parsed.data.training_session_id))) {
      res.status(403).json({ message: 'No puedes modificar esta asistencia.' });
      return;
    }
    if (req.user!.rol === 'Formador') {
      const session = await adminDb.collection('sessions').doc(parsed.data.training_session_id).get();
      if (!canTrainerEditAttendanceDay(session.data(), req.user!.uid, Number(parsed.data.dia))) {
        res.status(403).json({ message: 'Este día de asistencia no corresponde a tu fase asignada.' });
        return;
      }
    }
    const attendanceRef = adminDb.collection('attendance').doc(req.params.id);
    const previousAttendance = await attendanceRef.get();
    const previousData = previousAttendance.data();
    const isDropoutCorrection =
      (isDropoutAttendance(previousData?.estado_asistencia) ||
        Boolean(String(previousData?.motivo_desercion || '').trim())) &&
      !isDropoutAttendance(parsed.data.estado_asistencia);

    if (!isDropoutCorrection) {
      await attendanceRef.set(parsed.data, { merge: true });
      res.json({ ok: true });
      return;
    }

    const participantId = String(parsed.data.participant_id || previousData?.participant_id || '');
    const correctedDay = Number(parsed.data.dia);
    if (!participantId || !Number.isFinite(correctedDay)) {
      res.status(400).json({ message: 'Datos de asistencia invalidos.' });
      return;
    }

    const participantAttendanceSnapshot = await adminDb
      .collection('attendance')
      .where('participant_id', '==', participantId)
      .get();
    const sameSessionAttendance = participantAttendanceSnapshot.docs.filter(
      (document) => String(document.data().training_session_id || '') === parsed.data.training_session_id,
    );
    const propagatedDropouts = sameSessionAttendance.filter((document) => {
      const data = document.data();
      return document.id !== req.params.id &&
        Number(data.dia) > correctedDay &&
        isDropoutAttendance(data.estado_asistencia);
    });
    const staleDropoutMetadata = sameSessionAttendance.filter((document) => {
      const data = document.data();
      return document.id !== req.params.id &&
        !isDropoutAttendance(data.estado_asistencia) &&
        Boolean(String(data.motivo_desercion || '').trim());
    });
    const propagatedIds = new Set(propagatedDropouts.map((document) => document.id));
    const hasRemainingDropout = sameSessionAttendance.some((document) =>
      document.id !== req.params.id &&
      !propagatedIds.has(document.id) &&
      isDropoutAttendance(document.data().estado_asistencia),
    );

    const correctedAttendance: Record<string, unknown> = {
      ...parsed.data,
      motivo_desercion: FieldValue.delete(),
    };
    if (parsed.data.observacion === undefined) correctedAttendance.observacion = FieldValue.delete();
    if (parsed.data.evidencia_nombre === undefined) correctedAttendance.evidencia_nombre = FieldValue.delete();
    if (parsed.data.evidencia_imagen === undefined) correctedAttendance.evidencia_imagen = FieldValue.delete();

    const participantRef = adminDb.collection('participants').doc(participantId);
    const participantSnapshot = !hasRemainingDropout ? await participantRef.get() : null;
    const shouldReactivateParticipant =
      !hasRemainingDropout &&
      isDropoutAttendance(participantSnapshot?.data()?.estado_final);

    const writer = adminDb.bulkWriter();
    writer.set(attendanceRef, correctedAttendance, { merge: true });
    propagatedDropouts.forEach((document) => {
      writer.set(document.ref, {
        estado_asistencia: 'Seleccionar',
        minutos_tardanza: FieldValue.delete(),
        motivo_desercion: FieldValue.delete(),
        observacion: FieldValue.delete(),
        evidencia_nombre: FieldValue.delete(),
        evidencia_imagen: FieldValue.delete(),
        registrado_por: req.user!.uid,
        fecha_registro: new Date().toISOString(),
      }, { merge: true });
    });
    staleDropoutMetadata.forEach((document) => {
      writer.set(document.ref, {
        motivo_desercion: FieldValue.delete(),
      }, { merge: true });
    });
    if (shouldReactivateParticipant) {
      writer.set(participantRef, {
        estado_final: 'En formación',
        motivo_desercion: FieldValue.delete(),
      }, { merge: true });
    }
    await writer.close();
    res.json({ ok: true });
  },
);

router.put(
  '/confirmations/:id',
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Formador', 'Reclutador', 'Coordinador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = recordSchema.safeParse({ ...req.body, id: req.params.id });
    const mustOwnSession = req.user!.rol === 'Formador';
    if (
      !parsed.success ||
      (mustOwnSession && !(await ownsSession(req, parsed.data.training_session_id)))
    ) {
      res.status(403).json({ message: 'No puedes modificar esta alta.' });
      return;
    }

    const nextParticipantStatus =
      parsed.data.estado_alta === 'Alta confirmada'
        ? 'Alta confirmada'
        : parsed.data.estado_alta === 'No alta'
          ? 'Completó capacitación'
          : 'Pendiente de alta';
    const writer = adminDb.bulkWriter();
    writer.set(adminDb.collection('confirmations').doc(req.params.id), parsed.data, { merge: true });
    if (typeof parsed.data.participant_id === 'string' && parsed.data.participant_id) {
      writer.set(
        adminDb.collection('participants').doc(parsed.data.participant_id),
        {
          estado_final: nextParticipantStatus,
          estado_alta: parsed.data.estado_alta,
        },
        { merge: true },
      );
    }
    await writer.close();
    res.json({ ok: true });
  },
);

router.put(
  '/participants/:id',
  requireAuth,
  requireRole(['Administrador', 'Analista', 'Formador', 'Reclutador', 'Coordinador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = recordSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success || !(await ownsSession(req, parsed.data.training_session_id))) {
      res.status(403).json({ message: 'No puedes modificar este participante.' });
      return;
    }
    if (req.user!.rol === 'Formador') {
      const session = await adminDb.collection('sessions').doc(parsed.data.training_session_id).get();
      const sessionData = session.data();
      const allowed: Record<string, unknown> = {};
      if (isInitialTrainer(sessionData, req.user!.uid)) {
        allowed.evaluacion_nota = parsed.data.evaluacion_nota;
        allowed.observacion_evaluacion = parsed.data.observacion_evaluacion;
      }
      if (isOjtTrainer(sessionData, req.user!.uid)) {
        allowed.resultado_formacion = parsed.data.resultado_formacion;
        allowed.comentario_aptitud = parsed.data.comentario_aptitud;
        allowed.motivo_no_apt = parsed.data.motivo_no_apt;
        allowed.estado_final = parsed.data.estado_final;
      }
      const sanitized = Object.fromEntries(Object.entries(allowed).filter(([, value]) => value !== undefined));
      if (Object.keys(sanitized).length === 0) {
        res.status(403).json({ message: 'No tienes permisos para modificar estos campos.' });
        return;
      }
      await adminDb.collection('participants').doc(req.params.id).set(sanitized, { merge: true });
      res.json({ ok: true });
      return;
    }
    await adminDb.collection('participants').doc(req.params.id).set(parsed.data, { merge: true });
    res.json({ ok: true });
  },
);

router.post(
  '/participants/:id/cv',
  requireAuth,
  requireRole(cvAllowedRoles),
  raw({ type: () => true, limit: '10mb' }),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      let headerFileName = '';
      try {
        headerFileName = decodeURIComponent(req.get('X-File-Name') || '');
      } catch {
        res.status(400).json({ message: 'El nombre del archivo CV no es valido.' });
        return;
      }
      const bodyData = Buffer.isBuffer(req.body) ? undefined : req.body;
      const parsed = cvUploadSchema.safeParse({
        training_session_id:
          req.query.training_session_id || req.get('X-Training-Session-Id') || bodyData?.training_session_id,
        file_name: req.query.file_name || headerFileName || bodyData?.file_name,
        content_type: Buffer.isBuffer(req.body)
          ? req.get('Content-Type')?.split(';')[0]
          : bodyData?.content_type,
        base64: bodyData?.base64,
      });
      if (!parsed.success) {
        res.status(400).json({ message: 'Datos del CV invalidos.' });
        return;
      }

    const access = await canAccessParticipant(req, req.params.id);
    if (!access || access.sessionId !== parsed.data.training_session_id) {
      res.status(403).json({ message: 'No puedes cargar CV para este participante.' });
      return;
    }
    if (!isAllowedCvFile(parsed.data.file_name, parsed.data.content_type)) {
      res.status(400).json({ message: 'Formato no permitido. Sube un archivo PDF, DOC o DOCX.' });
      return;
    }

    const buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(parsed.data.base64 || '', 'base64');
    const maxSizeBytes = 10 * 1024 * 1024;
    if (!buffer.length || buffer.length > maxSizeBytes) {
      res.status(400).json({ message: 'El CV supera el tamaño máximo permitido de 10 MB.' });
      return;
    }

    const recordId = randomUUID();
    const participantName = [access.participant.nombres, access.participant.apellidos]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
    const driveFile = await uploadCvToGoogleDrive({
      buffer,
      fileName: `${safePathSegment(participantName || req.params.id)}_${safeFileName(parsed.data.file_name)}`,
      mimeType: parsed.data.content_type,
      participantId: req.params.id,
      recordId,
      uploadedBy: req.user!.uid,
    });

    const uploadedAt = new Date().toISOString();
    const fileAccessUrl = `/api/operations/participants/${req.params.id}/cv-content`;
    const path = `google-drive://${driveFile.id}`;
    const cvRecord = {
      id: recordId,
      userId: req.user!.uid,
      postulanteId: req.params.id,
      nombrePostulante: participantName,
      cvFile: {
        id: recordId,
        name: driveFile.name,
        mimeType: driveFile.mimeType,
        size: driveFile.size,
        storageProvider: 'google_drive',
        storagePath: path,
        bucket: driveFile.folderId,
        driveFileId: driveFile.id,
        driveFolderId: driveFile.folderId,
        webViewLink: driveFile.webViewLink,
        url: fileAccessUrl,
        publicUrl: fileAccessUrl,
        downloadUrl: fileAccessUrl,
        previewUrl: fileAccessUrl,
        uploadedAt,
        uploadedBy: req.user!.uid,
      },
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
    };

    const nextParticipant = {
      ...access.participant,
      cv_record_id: recordId,
      cv_file_name: driveFile.name,
      cv_file_path: path,
      cv_bucket: driveFile.folderId,
      cv_storage_provider: 'google_drive',
      cv_drive_file_id: driveFile.id,
      cv_drive_folder_id: driveFile.folderId,
      cv_content_type: driveFile.mimeType,
      cv_file_size: driveFile.size,
      cv_uploaded_at: uploadedAt,
      cv_uploaded_by: req.user!.uid,
    };
    try {
      await adminDb.collection('cv_records').doc(recordId).set(cvRecord);
      await access.participantDoc.ref.set(nextParticipant, { merge: true });
      if (process.env.FIREBASE_DATABASE_URL) {
        void adminRealtimeDb.ref().update({
          [`shared/cv_records_v1/${recordId}`]: cvRecord,
          [`shared/cv_record_${recordId}`]: cvRecord,
        }).catch((metadataError) => console.warn('Realtime Database CV metadata was not mirrored:', metadataError));
      }
    } catch (persistenceError) {
      const rollbackTasks: Promise<unknown>[] = [
        deleteCvFromGoogleDrive(driveFile.id),
        adminDb.collection('cv_records').doc(recordId).delete(),
      ];
      if (process.env.FIREBASE_DATABASE_URL) {
        rollbackTasks.push(adminRealtimeDb.ref().update({
          [`shared/cv_records_v1/${recordId}`]: null,
          [`shared/cv_record_${recordId}`]: null,
        }));
      }
      await Promise.allSettled(rollbackTasks);
      throw persistenceError;
    }
    res.json({ ok: true, participant: nextParticipant });
    } catch (error) {
      console.error('Error uploading participant CV:', error);
      res.status(500).json({
        message: `No se pudo guardar el CV en Google Drive: ${getGoogleDriveUploadError(error)}`,
      });
    }
  },
);

router.get(
  '/participants/:id/cv-content',
  requireAuth,
  requireRole(cvViewerRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const access = await canAccessParticipant(req, req.params.id);
      if (!access) {
        res.status(404).json({ message: 'CV no encontrado.' });
        return;
      }

      const provider = String(access.participant.cv_storage_provider || '');
      const driveFileId = String(access.participant.cv_drive_file_id || '');
      if (provider !== 'google_drive' || !driveFileId) {
        res.status(404).json({ message: 'El CV no está almacenado en Google Drive.' });
        return;
      }

      const fileBuffer = await downloadCvFromGoogleDrive(driveFileId);
      const contentType = String(access.participant.cv_content_type || 'application/octet-stream');
      const fileName = String(access.participant.cv_file_name || 'cv');
      res
        .set('Content-Type', contentType)
        .set('Content-Length', String(fileBuffer.length))
        .set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`)
        .set('Cache-Control', 'private, max-age=300')
        .send(fileBuffer);
    } catch (error) {
      console.error('Error downloading participant CV from Google Drive:', error);
      res.status(500).json({
        message: error instanceof Error
          ? `No se pudo abrir el CV desde Google Drive: ${error.message}`
          : 'No se pudo abrir el CV desde Google Drive.',
      });
    }
  },
);

router.get(
  '/participants/:id/cv-url',
  requireAuth,
  requireRole(cvViewerRoles),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
    const access = await canAccessParticipant(req, req.params.id);
    const cvPath = String(access?.participant.cv_file_path || '');
    if (!access || !cvPath) {
      res.status(404).json({ message: 'CV no encontrado.' });
      return;
    }

    const bucketCandidates = getStorageBucketCandidates(String(access.participant.cv_bucket || ''));
    if (!bucketCandidates.length) {
      res.status(500).json({ message: 'Firebase Storage no esta configurado en el backend.' });
      return;
    }

    let bucketName = bucketCandidates[0];
    for (const candidate of bucketCandidates) {
      const [exists] = await adminStorage.bucket(candidate).file(cvPath).exists();
      if (exists) {
        bucketName = candidate;
        break;
      }
    }

    const [url] = await adminStorage.bucket(bucketName).file(cvPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });
    res.json({ url });
    } catch (error) {
      console.error('Error generating participant CV URL:', error);
      res.status(500).json({
        message: error instanceof Error
          ? `No se pudo abrir el CV: ${error.message}`
          : 'No se pudo abrir el CV.',
      });
    }
  },
);

router.delete(
  '/participants/:id',
  requireAuth,
  requireRole(['Administrador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const participantDoc = await adminDb.collection('participants').doc(req.params.id).get();
    if (!participantDoc.exists) {
      res.status(404).json({ message: 'Postulante no encontrado.' });
      return;
    }

    const [
      attendanceSnapshot,
      confirmationsSnapshot,
      responsesSnapshot,
    ] = await Promise.all([
      adminDb.collection('attendance').where('participant_id', '==', req.params.id).get(),
      adminDb.collection('confirmations').where('participant_id', '==', req.params.id).get(),
      adminDb.collection('responses').where('participant_id', '==', req.params.id).get(),
    ]);

    const writer = adminDb.bulkWriter();
    writer.delete(participantDoc.ref);
    attendanceSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
    confirmationsSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
    responsesSnapshot.docs.forEach((doc) => writer.delete(doc.ref));
    await writer.close();

    res.json({
      ok: true,
      deleted: {
        participant: 1,
        attendance: attendanceSnapshot.size,
        confirmations: confirmationsSnapshot.size,
        responses: responsesSnapshot.size,
      },
    });
  },
);

router.put(
  '/reopens/:id',
  requireAuth,
  requireRole(['Administrador', 'Formador']),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = recordSchema.safeParse({ ...req.body, id: req.params.id });
    if (!parsed.success || !(await ownsSession(req, parsed.data.training_session_id))) {
      res.status(403).json({ message: 'No puedes modificar esta solicitud de reapertura.' });
      return;
    }

    if (
      req.user!.rol === 'Formador' &&
      (parsed.data.formador_id !== req.user!.uid || parsed.data.estado !== 'pendiente')
    ) {
      res.status(403).json({ message: 'Solo puedes crear solicitudes pendientes propias.' });
      return;
    }

    await adminDb.collection('reopens').doc(req.params.id).set(parsed.data, { merge: true });
    res.json({ ok: true });
  },
);

export { router as operationRoutes };
