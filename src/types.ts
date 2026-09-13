/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'Administrador' | 'Analista' | 'Reclutador' | 'Formador' | 'Coordinador' | 'Sistemas';
export type UserArea = 'seleccion' | 'formacion' | 'administrador';

export interface User {
  id: string;
  nombre: string;
  correo: string;
  usuario: string;
  usuario_normalizado?: string;
  password?: string;
  rol: UserRole;
  estado: 'Activo' | 'Inactivo';
  fecha_creacion: string;
  creado_por?: string;
  requiere_cambio_password?: boolean;
  areas?: UserArea[];
  module_access?: string[];
}

export type TrainingVariableEvaluationStatus = 'BORRADOR' | 'CERRADO' | 'REABIERTO' | 'ANULADO';

export interface TrainingVariableEvaluation {
  id: string;
  anio: number;
  mes: number;
  id_formador: string;
  nombre_formador: string;
  id_coordinador: string;
  nombre_coordinador: string;
  fecha_creacion: string;
  fecha_modificacion: string;
  fecha_cierre?: string;
  estado: TrainingVariableEvaluationStatus;
  observacion_general?: string;
  porcentaje_retencion: number;
  cumplimiento_retencion: number;
  aporte_retencion: number;
  porcentaje_produccion_individual: number;
  porcentaje_produccion_grupal: number;
  aporte_produccion: number;
  porcentaje_satisfaccion: number;
  cumplimiento_satisfaccion: number;
  aporte_satisfaccion: number;
  porcentaje_administrativo: number;
  observacion_administrativa?: string;
  generation_ids?: string[];
  codigos_generacion?: string[];
  calculo_automatico?: boolean;
  calculo_detalle?: {
    participantes_dia_1: number;
    participantes_dia_final: number;
    prospectos_generados: number;
    prospectos_venta_alta: number;
    respuestas_encuesta: number;
  };
  aporte_administrativo: number;
  cumplimiento_total: number;
  comision_base: number;
  bloques_sobrecumplimiento: number;
  bono_sobrecumplimiento: number;
  comision_total: number;
  usuario_creacion: string;
  usuario_modificacion: string;
}

export interface Campaign {
  id: string;
  nombre: string;
  estado: 'Activo' | 'Inactivo';
}

export type ProspectStatus = 'Nuevo' | 'Contactado' | 'En seguimiento' | 'Interesado' | 'Venta / Alta' | 'No interesado';

export interface Prospect {
  id: string;
  campana: string;
  fecha_registro: string;
  formador_id: string;
  formador_nombre: string;
  training_session_id?: string;
  training_session_code?: string;
  ejecutivo_nombre: string;
  ejecutivo_dni: string;
  ejecutivo_inconcert: string;
  prospecto_nombre: string;
  ruc?: string;
  dni?: string;
  telefono: string;
  correo?: string;
  producto_interes: string;
  lineas_adicionales?: string;
  cantidad_productos: number;
  estado: ProspectStatus;
  observaciones?: string;
  creado_por: string;
  creado_por_rol: UserRole;
  created_at: string;
  updated_at: string;
}

export interface TrainingSession {
  id: string;
  nombre_generacion: string;
  campaña: string; // e.g. 'Entel Empresas', 'Prosegur', 'Culqi', 'Equifax'
  tipo_capacitacion: string; // e.g. 'Capacitación regular', 'Capacitación flash', etc.
  fecha_inicio: string;
  fecha_fin: string;
  formador_id: string; // User ID of the trainer
  formador_nombre: string;
  formador_ids?: string[];
  formador_nombres?: string[];
  formador_capacitacion_inicial_ids?: string[];
  formador_capacitacion_inicial_nombres?: string[];
  formador_ojt_ids?: string[];
  formador_ojt_nombres?: string[];
  reclutador_id: string; // User ID of the recruiter
  reclutador_nombre: string;
  modalidad: 'Presencial' | 'Virtual' | 'Híbrida';
  turno: 'Part time' | 'Full time' | 'Mini full';
  hora_capacitacion?: string; // 24-hour format, e.g. '08:00'
  observaciones?: string;
  estado: 'Pendiente de inicio' | 'En curso' | 'Activa' | 'Campaña cerrada' | 'Capacitación cerrada';
  fecha_creacion: string;
  generation_code?: string;
  training_days?: 5 | 10;
}

export interface Participant {
  id: string;
  training_session_id: string;
  dni: string;
  nombres: string;
  apellidos: string;
  celular: string;
  correo: string;
  puesto: string;
  fuente_reclutamiento: string;
  observacion?: string;
  estado_final: 'Completó capacitación' | 'Desistió' | 'No asistió' | 'En riesgo' | 'En formación' | 'Pendiente de alta' | 'Alta confirmada' | 'Pendiente de gestión';
  
  // Real Excel fields
  reclutador_origen?: string;
  coordinador?: string;
  ciudad?: string;
  sueldo?: string;
  estado_pruebas_psicologicas?: string;
  fecha_entrevista_sup?: string;
  resultado_entrevista_sup?: string;
  fecha_capacitacion?: string;
  formador_asignado?: string;

  // Daily attendance state & observation directly on participant
  asistencia_dia_1?: AttendanceStatus;
  observacion_dia_1?: string;
  asistencia_dia_2?: AttendanceStatus;
  observacion_dia_2?: string;
  asistencia_dia_3?: AttendanceStatus;
  observacion_dia_3?: string;
  asistencia_dia_4?: AttendanceStatus;
  observacion_dia_4?: string;
  asistencia_dia_5?: AttendanceStatus;
  asistencia_dia_6?: AttendanceStatus;
  asistencia_dia_7?: AttendanceStatus;
  asistencia_dia_8?: AttendanceStatus;
  asistencia_dia_9?: AttendanceStatus;
  asistencia_dia_10?: AttendanceStatus;
  observacion_dia_5?: string;
  
  // Deserción and high states
  motivo_desercion?: string;
  observacion_general?: string;
  estado_alta?: 'Alta confirmada' | 'Pendiente de alta' | 'No alta';
  _rowId?: string;

  // Resultado de formación
  resultado_formacion?: 'Marcar' | 'Apto' | 'No apto';
  comentario_aptitud?: string;
  motivo_no_apt?: string;
  evaluacion_nota?: number | null;
  observacion_evaluacion?: string;

  // Curriculum Vitae
  cv_record_id?: string;
  cv_file_name?: string;
  cv_file_path?: string;
  cv_bucket?: string;
  cv_storage_provider?: 'firebase_storage' | 'google_drive';
  cv_drive_file_id?: string;
  cv_drive_folder_id?: string;
  cv_content_type?: string;
  cv_file_size?: number;
  cv_uploaded_at?: string;
  cv_uploaded_by?: string;
}

export type AttendanceStatus = 'Seleccionar' | 'Asistió' | 'Tardanza' | 'Faltó' | 'Descanso médico' | 'Desistió' | 'Baja' | 'Feriado' | 'Pendiente';

export interface AttendanceRecord {
  id: string;
  participant_id: string;
  training_session_id: string;
  dia: number; // 1, 2, 3, 4, 5
  fecha: string; // YYYY-MM-DD
  estado_asistencia: AttendanceStatus;
  minutos_tardanza?: number; // Optional
  motivo_desercion?: string; // Optional (if Desistió)
  observacion?: string;
  evidencia_nombre?: string;
  evidencia_imagen?: string;
  registrado_por: string; // User ID
  fecha_registro: string;
}

export type AltaStatus = 'Alta confirmada' | 'Pendiente de alta' | 'No alta' | 'Eliminada';

export interface OperationConfirmation {
  id: string;
  participant_id: string;
  training_session_id: string;
  estado_alta: AltaStatus;
  fecha_alta?: string; // YYYY-MM-DD
  motivo_no_alta?: string; // Required if 'No alta'
  observacion?: string;
  registrado_por: string; // User ID
  fecha_registro: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
}

export interface UploadHistory {
  id: string;
  training_session_id: string;
  nombre_archivo: string;
  total_registros: number;
  registros_validos: number;
  registros_error: number;
  cargado_por: string; // User ID or username
  fecha_carga: string;
}

export type ReopenRequestStatus = 'pendiente' | 'aprobada' | 'rechazada' | 'vencida';

export interface AttendanceReopenRequest {
  id: string;
  training_session_id: string;
  formador_id: string;
  formador_nombre: string;
  campaña: string;
  generacion: string;
  fecha_capacitacion: string;
  dia_capacitacion: number; // 1 to 5
  motivo: string;
  comentario?: string;
  estado: ReopenRequestStatus;
  aprobado_por?: string; // Admin User ID or name
  fecha_solicitud: string;
  fecha_respuesta?: string;
  comentario_respuesta?: string;
  habilitado_hasta?: string; // ISO String or YYYY-MM-DD HH:mm:ss
}

export interface AuditLog {
  id: string;
  usuario_id: string;
  usuario_nombre: string;
  rol: UserRole;
  accion: string;
  modulo: string;
  detalle: string;
  fecha: string; // ISO String
  campaña?: string;
  generacion?: string;
  participante_id?: string;
  participante_nombre?: string;
  valor_anterior?: string;
  valor_nuevo?: string;
  comentario?: string;
}

export type SurveyStatus = 'Borrador' | 'Habilitada' | 'Deshabilitada' | 'Cerrada' | 'Eliminada';

export interface TrainingSurvey {
  id: string;
  training_session_id: string;
  codigo_generacion: string;
  campaña: string;
  formador_id: string;
  formador_nombre: string;
  estado: SurveyStatus;
  token: string;
  link_assigned_user_ids?: string[];
  fecha_habilitacion?: string;
  fecha_cierre?: string;
  
  // extra fields from requirement 17
  training_type?: string;
  start_date?: string;
  end_date?: string;
  created_by?: string;
  created_at?: string;
  enabled_at?: string;
  disabled_at?: string;
  closed_at?: string;
  deleted_at?: string;
  deleted_by?: string;
}

export interface SurveyResponse {
  id: string;
  training_survey_id: string;
  participant_id: string;
  dni: string;
  nombre_ejecutivo: string;
  campaña: string;
  codigo_generacion: string;
  formador_id: string;
  formador_nombre: string;
  fecha_respuesta: string;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  q5: number;
  q6: number;
  q7: number;
  q8: number;
  q9: number;
  q10: number;
  total_score: number;
  final_score_20: number;
  classification: 'Excelente' | 'Bueno' | 'Regular' | 'Crítico';
  
  // for backwards compatibility with initial seed data
  p1?: number;
  p2?: number;
  p3?: number;
  p4?: number;
  p5?: number;
  p6?: number;
  p7?: number;
  p8?: number;
  promedio_individual?: number;
  comentario_positivo?: string;
  aspecto_mejora?: string;
}

export interface TrainingClosure {
  id: string;
  training_session_id: string;
  closed_by: string;
  closed_by_name?: string;
  closed_at: string;
  observation?: string;
  validations: Record<string, unknown>;
  status: 'closed';
}

export type SelectionRequisitionStatus =
  | 'Borrador'
  | 'Programada'
  | 'Activa'
  | 'En proceso'
  | 'Próxima a vencer'
  | 'Vencida'
  | 'Pendiente de cierre'
  | 'Pendiente de asignación a capacitación'
  | 'Parcialmente asignada a capacitación'
  | 'Finalizada'
  | 'Finalizada con postulantes pendientes'
  | 'Cancelada'
  | 'Archivada'
  | 'Eliminada';

export type SelectionApplicantStatus =
  | 'Pendiente de gestión'
  | 'Registrado'
  | 'Pendiente de contacto'
  | 'Contactado'
  | 'No contactado'
  | 'Interesado'
  | 'Citado'
  | 'Ausente'
  | 'En evaluación'
  | 'No interesado'
  | 'No responde'
  | 'No contesta'
  | 'Entrevista inicial'
  | 'Examen teórico'
  | 'Entrevista RH'
  | 'Pruebas psicológicas'
  | 'Entrevista Supervisor/Coordinador'
  | 'Apto para capacitación'
  | 'Asignado a capacitación'
  | 'Alta en operación'
  | 'Caído'
  | 'Desistió'
  | 'No corresponde'
  | 'No apto'
  | 'Eliminado';
export type SelectionEvaluationStatus =
  | 'Pendiente'
  | 'Programada'
  | 'En proceso'
  | 'Apto'
  | 'No apto'
  | 'No aplica';

export interface SelectionRequisition {
  id: string;
  codigo: string;
  nombre: string;
  cuenta: string;
  posicion: string;
  ciudad: string;
  fuente_principal: string;
  vacantes: number;
  meta_leads: number;
  prioridad: 'Baja' | 'Media' | 'Alta' | 'Crítica';
  descripcion?: string;
  requisitos?: string;
  observaciones?: string;
  analista_id?: string;
  analista_nombre?: string;
  coordinador_id?: string;
  coordinador_nombre?: string;
  reclutador_ids: string[];
  reclutador_nombres: string[];
  fecha_creacion: string;
  fecha_inicio: string;
  fecha_fin: string;
  hora_inicio?: string;
  hora_cierre?: string;
  sla_objetivo: number;
  sla_unidad: 'minutos' | 'horas';
  sla_tipo: 'Horas calendario' | 'Horas laborales';
  max_intentos_contacto: number;
  seguimiento_max_horas: number;
  training_tipo?: string;
  training_formador_id?: string;
  training_formador_nombre?: string;
  training_formador_ids?: string[];
  training_formador_nombres?: string[];
  training_formador_inicial_ids?: string[];
  training_formador_inicial_nombres?: string[];
  training_formador_ojt_ids?: string[];
  training_formador_ojt_nombres?: string[];
  training_fecha_inicio?: string;
  training_fecha_fin?: string;
  training_hora?: string;
  training_modalidad?: 'Presencial' | 'Virtual' | 'Híbrida';
  training_sede?: string;
  training_enlace?: string;
  training_observaciones?: string;
  training_session_id?: string;
  estado: SelectionRequisitionStatus;
  cierre_motivo?: string;
  deleted_at?: string;
  deleted_by?: string;
  deletion_reason?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by?: string;
}

export interface SelectionApplicantEvaluation {
  estado: SelectionEvaluationStatus;
  fecha?: string;
  hora?: string;
  responsable?: string;
  puntaje?: number;
  observacion?: string;
  motivo_no_apto?: string;
}

export interface SelectionApplicant {
  id: string;
  codigo: string;
  requisition_id: string;
  requisition_codigo: string;
  reclutador_excel?: string;
  coordinador_excel?: string;
  cuenta: string;
  fuente: string;
  posicion: string;
  ciudad: string;
  fecha_nacimiento?: string;
  dni: string;
  nombre_completo: string;
  telefono: string;
  correo?: string;
  entrevista?: string;
  status_excel?: string;
  examen_teorico?: string;
  entrevista_rh?: string;
  pruebas_psic?: string;
  entrevista_super_coord?: string;
  registrado_por: string;
  registrado_por_nombre: string;
  reclutador_id: string;
  reclutador_nombre: string;
  fecha_registro: string;
  fecha_asignacion: string;
  fecha_primera_gestion?: string;
  tiempo_primera_gestion_min?: number;
  cumple_sla?: boolean;
  intentos_contacto: number;
  proximo_seguimiento?: string;
  ultimo_estado: SelectionApplicantStatus;
  etapa_actual: string;
  motivo_caida?: string;
  submotivo_caida?: string;
  observaciones?: string;
  ultima_actualizacion: string;
  actualizado_por?: string;
  estado_capacitacion?: 'Pendiente' | 'Asignado a capacitación' | 'Inició capacitación' | 'Finalizó capacitación';
  estado_alta_operacion?: 'Pendiente' | 'Alta en operación' | 'No alta';
  convocatoria_origen: string;
  training_session_id?: string;
  participant_id?: string;
  evaluaciones?: Record<string, SelectionApplicantEvaluation>;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by?: string;
}

export interface SelectionAuditLog {
  id: string;
  action: string;
  module: string;
  entity_id?: string;
  entity_name?: string;
  user_id: string;
  user_name: string;
  user_role: UserRole;
  created_at: string;
  previous_value?: string;
  new_value?: string;
  reason?: string;
  ip?: string;
}
