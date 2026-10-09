const isPresentAttendance = (status?: string) => ['asistio', 'tardanza', 'feriado'].includes((status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim());
const isAttendedAttendance = (status?: string) => (status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === 'asistio';

export const calculatePhaseMetrics = (
  participantIds: Set<string>,
  attendanceRecords: Array<{ participant_id: string; dia: number; estado_asistencia?: string }>,
  confirmationRecords: Array<{ participant_id: string; estado_alta: string }>,
) => {
  const attendantsByDay = new Map<number, Set<string>>(
    [1, 2, 5, 6, 10].map((day) => [day, new Set<string>()]),
  );
  const ojtParticipantIds = new Set<string>();
  const altasD10Ids = new Set<string>();

  attendanceRecords.forEach((record) => {
    if (!participantIds.has(record.participant_id)) return;
    if (record.dia === 10 && isAttendedAttendance(record.estado_asistencia)) altasD10Ids.add(record.participant_id);
    if (!isPresentAttendance(record.estado_asistencia)) return;
    attendantsByDay.get(record.dia)?.add(record.participant_id);
    if (record.dia >= 6 && record.dia <= 10) ojtParticipantIds.add(record.participant_id);
  });

  const confirmedAltaIds = new Set(
    confirmationRecords
      .filter((confirmation) =>
        participantIds.has(confirmation.participant_id) &&
        confirmation.estado_alta === 'Alta confirmada',
      )
      .map((confirmation) => confirmation.participant_id),
  );
  const d1Ids = attendantsByDay.get(1) || new Set<string>();
  const d2Ids = attendantsByDay.get(2) || new Set<string>();
  const d5Ids = attendantsByDay.get(5) || new Set<string>();
  const d6Ids = attendantsByDay.get(6) || new Set<string>();
  const d10Ids = attendantsByDay.get(10) || new Set<string>();
  const desercionesFinales = Math.max(d2Ids.size - d10Ids.size, 0);

  return {
    d1Ids,
    d2Ids,
    d5Ids,
    d6Ids,
    d10Ids,
    ojtParticipantIds,
    altasD10Ids,
    confirmedAltaIds,
    retencionCapacitacion: d1Ids.size > 0 ? Math.round((d5Ids.size / d1Ids.size) * 100) : 0,
    retencionOjt: d6Ids.size > 0 ? Math.round((d10Ids.size / d6Ids.size) * 100) : 0,
    desercionesFinales,
    desercionFinalRate: d2Ids.size > 0 ? Math.round((desercionesFinales / d2Ids.size) * 100) : 0,
  };
};
