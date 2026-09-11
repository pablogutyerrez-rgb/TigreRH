import { dataDb as adminDb } from '../hybridDb.js';

interface AuditLogInput {
  modulo: string;
  accion: string;
  usuario_id: string;
  usuario_nombre: string;
  entityType?: string;
  entityId?: string;
  detalle: string;
}

export const createAuditLog = async (data: AuditLogInput) => {
  const ref = adminDb.collection('logs').doc();
  await ref.set({
    id: ref.id,
    modulo: data.modulo,
    accion: data.accion,
    usuario_id: data.usuario_id,
    usuario_nombre: data.usuario_nombre,
    fecha: new Date().toISOString(),
    entityType: data.entityType ?? '',
    entityId: data.entityId ?? '',
    detalle: data.detalle,
  });
};
