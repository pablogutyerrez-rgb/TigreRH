import { dataDb } from '../hybridDb.js';

export const normalizeParticipantDocument = (value: unknown) => String(value ?? '').trim().replace(/^0+(?=\d)/, '');

export const updateParticipantDocument = async (
  participantId: string, changes: Record<string, unknown>, actor: { uid: string; nombre: string; rol: string },
) => {
  const dni = String(changes.dni ?? '').trim();
  if (!/^\d{8,15}$/.test(dni)) throw Object.assign(new Error('Ingresa un DNI o CE valido de 8 a 15 digitos.'), { status: 400 });
  return dataDb.runTransaction(async (transaction) => {
    // An advisory lock on the target document prevents concurrent duplicate corrections.
    await transaction.get(dataDb.collection('participants').doc(`document-correction:${normalizeParticipantDocument(dni)}`));
    // Serialize document corrections in the same training without changing its data.
    await transaction.get(dataDb.collection('sessions').doc(String(changes.training_session_id)));
    const ref = dataDb.collection('participants').doc(participantId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data().training_session_id !== changes.training_session_id) {
      throw Object.assign(new Error('El participante no pertenece a esta capacitacion.'), { status: 409 });
    }
    const current = snapshot.data();
    const [participants, applicants, surveys, modules, responses] = await Promise.all([
      dataDb.collection('participants').get(), dataDb.collection('selection_applicants').get(),
      dataDb.collection('surveys').get(), dataDb.collection('ojt_modules').get(), dataDb.collection('responses').get(),
    ]);
    const linkedModules = modules.docs.filter((doc) =>
      doc.data().participant_ids?.includes(participantId) || doc.data().generation_ids?.includes(current.training_session_id));
    const linkedModuleIds = new Set(linkedModules.map((doc) => doc.id));
    const sessionIds = new Set([current.training_session_id, ...linkedModules.flatMap((doc) => doc.data().generation_ids || [])]);
    const ojtParticipantIds = new Set(linkedModules.flatMap((doc) => doc.data().participant_ids || []));
    const linkedApplicants = applicants.docs.filter((doc) => doc.id === current.selection_applicant_id || doc.data().participant_id === participantId);
    const applicantIds = new Set(linkedApplicants.map((doc) => doc.id));
    if (participants.docs.some((doc) => doc.id !== participantId && (sessionIds.has(doc.data().training_session_id) || ojtParticipantIds.has(doc.id)) &&
      normalizeParticipantDocument(doc.data().dni) === normalizeParticipantDocument(dni)) ||
      (linkedApplicants.length > 0 && applicants.docs.some((doc) => !applicantIds.has(doc.id) &&
        normalizeParticipantDocument(doc.data().dni) === normalizeParticipantDocument(dni)))) {
      throw Object.assign(new Error('El documento ya esta registrado en la capacitacion, OJT o Seleccion.'), { status: 409 });
    }
    const surveyIds = new Set(surveys.docs.filter((doc) => doc.data().survey_type !== 'operaciones' &&
      (doc.data().training_session_id === current.training_session_id || linkedModuleIds.has(doc.data().ojt_module_id))).map((doc) => doc.id));
    const linkedResponses = responses.docs.filter((doc) => doc.data().survey_type !== 'operaciones' &&
      (doc.data().participant_id === participantId || (!doc.data().participant_id && surveyIds.has(doc.data().training_survey_id) &&
        normalizeParticipantDocument(doc.data().dni) === normalizeParticipantDocument(current.dni))));
    const metadata = Object.fromEntries(['nombres', 'apellidos', 'celular', 'correo', 'puesto', 'fuente_reclutamiento', 'coordinador', 'ciudad']
      .filter((key) => changes[key] !== undefined).map((key) => [key, changes[key]]));
    const participant = { ...current, ...metadata, id: participantId, dni };
    transaction.set(ref, { ...metadata, dni }, { merge: true });
    linkedApplicants.forEach((doc) => transaction.set(doc.ref, { dni }, { merge: true }));
    linkedResponses.forEach((doc) => transaction.set(doc.ref, { dni, participant_id: participantId }, { merge: true }));
    const logRef = dataDb.collection('logs').doc();
    transaction.set(logRef, {
      id: logRef.id, usuario_id: actor.uid, usuario_nombre: actor.nombre, rol: actor.rol,
      accion: 'Correccion de documento del postulante', modulo: 'Control de asistencia',
      participante_id: participantId, valor_anterior: String(current.dni || ''), valor_nuevo: dni,
      detalle: 'Documento sincronizado conservando participante, asignaciones y respuestas.', fecha: new Date().toISOString(),
    });
    return participant;
  });
};
