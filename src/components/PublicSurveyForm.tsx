import React, { useState } from 'react';
import { TrainingSurvey, SurveyResponse, Participant, TrainingSession, AuditLog, User } from '../types';
import { isSurveyEligibleParticipant } from '../utils/trainingProgress';
import { AlertTriangle, CheckCircle2, ShieldCheck, Clipboard, Send, Star, HelpCircle } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { APP_NAME } from '../constants/app';
import { formatPeruDate } from '../utils/time';
import {
  getPublicSurveyContext,
  getPublicSurveyMetadata,
  submitPublicSurveyResponse,
} from '../services/publicSurveyService';

const normalizeDocument = (value: unknown) => String(value ?? '').trim().replace(/^0+(?=\d)/, '');

interface PublicSurveyFormProps {
  surveys: TrainingSurvey[];
  sessions: TrainingSession[];
  participants: Participant[];
  responses: SurveyResponse[];
  attendance: any[];
  surveyToken: string | null;
  onAddResponse: (response: SurveyResponse) => void;
  onAuditLog: (
    accion: string,
    modulo: string,
    detalle: string,
    campaña?: string,
    generacion?: string,
    partId?: string,
    partName?: string,
    prevVal?: string,
    newVal?: string,
    comment?: string,
    forcedUser?: User
  ) => void;
  onClosePublicSurvey: () => void;
}

export default function PublicSurveyForm({
  surveys,
  sessions,
  participants,
  responses,
  attendance,
  surveyToken,
  onAddResponse,
  onAuditLog,
  onClosePublicSurvey
}: PublicSurveyFormProps) {
  // --- Wizard / Validation States ---
  const [step, setStep] = useState<'validate' | 'form' | 'success'>('validate');
  const [dni, setDni] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('dni') || '';
  });
  const [selectedSurveyId, setSelectedSurveyId] = useState<string>(() => {
    // If a token/slug was parsed, find the corresponding active survey
    if (surveyToken) {
      const cleanToken = surveyToken.trim().toLowerCase();
      const found = surveys.find(
        s => s.token.toLowerCase() === cleanToken || s.codigo_generacion.replace(/\s+/g, '-').toLowerCase() === cleanToken
      );
      return found ? found.id : '';
    }
    return '';
  });

  const [validationError, setValidationError] = useState('');
  const [activeParticipant, setActiveParticipant] = useState<Participant | null>(null);
  const [activeSurvey, setActiveSurvey] = useState<TrainingSurvey | null>(null);
  const [remoteSurvey, setRemoteSurvey] = useState<TrainingSurvey | null>(null);
  const [loadingSurvey, setLoadingSurvey] = useState(Boolean(surveyToken));
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // --- Form Answers States ---
  const [p1, setP1] = useState<number>(0);
  const [p2, setP2] = useState<number>(0);
  const [p3, setP3] = useState<number>(0);
  const [p4, setP4] = useState<number>(0);
  const [p5, setP5] = useState<number>(0);
  const [p6, setP6] = useState<number>(0);
  const [p7, setP7] = useState<number>(0);
  const [p8, setP8] = useState<number>(0);
  const [comentarioPositivo, setComentarioPositivo] = useState('');
  const [aspectoMejora, setAspectoMejora] = useState('');
  const [formError, setFormError] = useState('');

  // Find survey list that are enabled/habilitadas
  const activeSurveysList = surveys.filter(s => s.estado === 'Habilitada');

  React.useEffect(() => {
    if (!surveyToken) return;

    let cancelled = false;
    setLoadingSurvey(true);
    getPublicSurveyMetadata(surveyToken)
      .then(({ survey }) => {
        if (cancelled) return;
        setRemoteSurvey(survey);
        setSelectedSurveyId(survey.id);
        setValidationError('');
      })
      .catch((error) => {
        if (!cancelled) {
          setRemoteSurvey(null);
          setValidationError(error instanceof Error ? error.message : 'No se pudo cargar la encuesta.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSurvey(false);
      });

    return () => {
      cancelled = true;
    };
  }, [surveyToken]);

  const deletedSurvey = React.useMemo(() => {
    if (!surveyToken) return null;
    const cleanToken = surveyToken.trim().toLowerCase();
    return surveys.find(
      srv => (srv.token.toLowerCase() === cleanToken || srv.codigo_generacion.replace(/\s+/g, '-').toLowerCase() === cleanToken) && srv.estado === 'Eliminada'
    ) || null;
  }, [surveyToken, surveys]);

  // Audit log on load if opening a deleted survey link
  React.useEffect(() => {
    if (surveyToken) {
      const cleanToken = surveyToken.trim().toLowerCase();
      const s = surveys.find(
        srv => srv.token.toLowerCase() === cleanToken || srv.codigo_generacion.replace(/\s+/g, '-').toLowerCase() === cleanToken
      );
      if (s && s.estado === 'Eliminada') {
        onAuditLog(
          'Intento de apertura de encuesta eliminada',
          'Encuestas de Satisfacción',
          `El ejecutivo intentó abrir el enlace de una encuesta eliminada (ID: ${s.id}, Generación: ${s.codigo_generacion}).`,
          s.campaña,
          s.codigo_generacion
        );
      }
    }
  }, [surveyToken, surveys]);

  // Handle DNI validation
  const handleValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    const cleanDni = dni.trim();
    if (!cleanDni) {
      setValidationError('Por favor, ingresa tu DNI.');
      return;
    }

    if (surveyToken) {
      try {
        setValidating(true);
        const context = await getPublicSurveyContext(surveyToken, cleanDni);
        setRemoteSurvey(context.survey);
        setSelectedSurveyId(context.survey.id);
        setActiveParticipant(context.participant);
        setActiveSurvey(context.survey);
        setStep('form');
      } catch (error) {
        setValidationError(
          error instanceof Error ? error.message : 'No se pudo validar tu registro.',
        );
      } finally {
        setValidating(false);
      }
      return;
    }

    const targetSurveyId = selectedSurveyId;
    if (!targetSurveyId) {
      setValidationError('Por favor, selecciona una capacitación.');
      return;
    }

    const survey = surveys.find(s => s.id === targetSurveyId);
    if (!survey) {
      setValidationError('La encuesta seleccionada no es válida.');
      return;
    }

    if (survey.estado === 'Eliminada') {
      onAuditLog(
        'Intento de respuesta de encuesta eliminada',
        'Encuestas de Satisfacción',
        `Un ejecutivo con DNI "${dni}" intentó responder la encuesta eliminada (ID: ${survey.id}, Generación: ${survey.codigo_generacion}).`,
        survey.campaña,
        survey.codigo_generacion
      );
      setValidationError('Esta encuesta ya no se encuentra disponible.');
      return;
    }

    if (survey.estado !== 'Habilitada') {
      setValidationError('Esta encuesta de satisfacción se encuentra cerrada o no habilitada actualmente.');
      return;
    }

    // Match DNI against participants of that session
    const matchedPart = participants.find(
      p => p.training_session_id === survey.training_session_id && normalizeDocument(p.dni) === normalizeDocument(cleanDni)
    );

    if (!matchedPart) {
      // Register audit log for invalid attempt
      onAuditLog(
        'Intento de encuesta con DNI no válido',
        'Encuestas de Satisfacción',
        `Intento fallido de ingresar a encuesta con DNI "${cleanDni}" para la generación "${survey.codigo_generacion}".`,
        survey.campaña,
        survey.codigo_generacion
      );
      setValidationError('No se encontró tu registro en esta capacitación. Verifica tu DNI o comunícate con Formación.');
      return;
    }

    // Check if duplicate response exists
    const alreadyResponded = responses.some(
      r => r.training_survey_id === survey.id && normalizeDocument(r.dni) === normalizeDocument(cleanDni)
    );

    if (alreadyResponded) {
      // Register audit log for double response attempt
      onAuditLog(
        'Intento de responder encuesta duplicada',
        'Encuestas de Satisfacción',
        `El ejecutivo "${matchedPart.nombres} ${matchedPart.apellidos}" (DNI: ${cleanDni}) intentó responder la encuesta de "${survey.codigo_generacion}" nuevamente.`,
        survey.campaña,
        survey.codigo_generacion,
        matchedPart.id,
        `${matchedPart.nombres} ${matchedPart.apellidos}`
      );
      setValidationError('Ya registraste tu encuesta de satisfacción para esta capacitación.');
      return;
    }

    // The survey is available once any attendance record exists for training Day 5.
    const pAttendance = attendance.filter(a => a.participant_id === matchedPart.id);
    if (!isSurveyEligibleParticipant(matchedPart, pAttendance)) {
      onAuditLog(
        'Intento de encuesta rechazado sin registro del Día 5',
        'Encuestas de Satisfacción',
        `El ejecutivo "${matchedPart.nombres} ${matchedPart.apellidos}" (DNI: ${cleanDni}) fue rechazado porque no existe un registro de asistencia para el Día 5 de capacitación.`,
        survey.campaña,
        survey.codigo_generacion,
        matchedPart.id,
        `${matchedPart.nombres} ${matchedPart.apellidos}`
      );
      setValidationError('No existe un registro de asistencia para el Día 5 de capacitación. Comunícate con el área de Formación.');
      return;
    }

    // Validated successfully
    setActiveParticipant(matchedPart);
    setActiveSurvey(survey);
    setStep('form');
  };

  // Handle survey submission
  const handleSubmitSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Check that all scales have values from 1 to 5
    const scales = [p1, p2, p3, p4, p5, p6, p7, p8];
    if (scales.some(val => val < 1 || val > 5)) {
      setFormError('Por favor, responde todas las preguntas obligatorias marcando tu valoración de 1 a 5.');
      return;
    }

    if (!comentarioPositivo.trim() || !aspectoMejora.trim()) {
      setFormError('Por favor, completa las preguntas abiertas de comentarios y áreas de mejora.');
      return;
    }

    if (!activeParticipant || !activeSurvey) {
      setFormError('Ocurrió un error con el participante o encuesta de sesión.');
      return;
    }

    // Math conversions as requested by Section 6 of requirements:
    // 1. Suma total de puntos obtenidos en las preguntas de escala de valoración (máximo 50 puntos).
    // since we have 8 rating questions, we scale the sum of 8 questions to 50 points (sum_8 * 1.25)
    const sum_8 = p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8;
    const total_score = Number((sum_8 * 1.25).toFixed(2));
    
    // 2. Nota final convertida a escala de 0 a 20 mediante la fórmula:
    // notaFinal = (total_score / 50) * 20
    const final_score_20 = Number(((total_score / 50) * 20).toFixed(2));

    // 3. Clasificación del desempeño del formador según la nota convertida
    let classification: 'Excelente' | 'Bueno' | 'Regular' | 'Crítico';
    if (final_score_20 >= 18.00) {
      classification = 'Excelente';
    } else if (final_score_20 >= 15.00) {
      classification = 'Bueno';
    } else if (final_score_20 >= 11.00) {
      classification = 'Regular';
    } else {
      classification = 'Crítico';
    }

    const newResponse: SurveyResponse = {
      id: `resp-${Math.random().toString(36).substring(2, 11)}`,
      training_survey_id: activeSurvey.id,
      participant_id: activeParticipant.id,
      dni: dni.trim(),
      nombre_ejecutivo: `${activeParticipant.nombres} ${activeParticipant.apellidos}`,
      campaña: activeSurvey.campaña,
      codigo_generacion: activeSurvey.codigo_generacion,
      formador_id: activeSurvey.formador_id,
      formador_nombre: activeSurvey.formador_nombre,
      fecha_respuesta: new Date().toISOString(),
      
      // New format fields
      q1: p1,
      q2: p2,
      q3: p3,
      q4: p4,
      q5: p5,
      q6: p6,
      q7: p7,
      q8: p8,
      q9: 5, // place holder rating to satisfy TypeScript definition, or map appropriately
      q10: 5,
      total_score,
      final_score_20,
      classification,

      // Backwards compatibility fields
      p1, p2, p3, p4, p5, p6, p7, p8,
      promedio_individual: Number((sum_8 / 8).toFixed(2)),
      comentario_positivo: comentarioPositivo.trim(),
      aspecto_mejora: aspectoMejora.trim()
    };

    if (surveyToken) {
      try {
        setSubmitting(true);
        const result = await submitPublicSurveyResponse(surveyToken, {
          dni: dni.trim(),
          q1: p1,
          q2: p2,
          q3: p3,
          q4: p4,
          q5: p5,
          q6: p6,
          q7: p7,
          q8: p8,
          comentario_positivo: comentarioPositivo.trim(),
          aspecto_mejora: aspectoMejora.trim(),
        });
        onAddResponse(result.response);
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : 'No se pudo registrar la encuesta.',
        );
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    } else {
      onAddResponse(newResponse);
    }

    // Register audit log for successful survey response
    onAuditLog(
      'Encuesta de satisfacción completada',
      'Encuestas de Satisfacción',
      `El ejecutivo "${newResponse.nombre_ejecutivo}" completó la encuesta de satisfacción para la generación "${activeSurvey.codigo_generacion}". Nota: ${final_score_20} (${classification})`,
      activeSurvey.campaña,
      activeSurvey.codigo_generacion,
      activeParticipant.id,
      newResponse.nombre_ejecutivo
    );

    setStep('success');
  };

  const scaleTexts: { [key: number]: string } = {
    1: 'Muy malo',
    2: 'Malo',
    3: 'Regular',
    4: 'Bueno',
    5: 'Excelente'
  };

  // Render question rating row
  const renderRatingQuestion = (
    num: number,
    question: string,
    currentValue: number,
    setValue: (val: number) => void
  ) => {
    return (
      <div className="space-y-3 bg-white/40 p-4 rounded-2xl border border-slate-100" id={`question-${num}`}>
        <div className="flex gap-2">
          <span className="font-extrabold text-fuchsia-600 font-mono text-sm">{num}.</span>
          <p className="text-slate-800 text-xs font-bold leading-tight">{question} <span className="text-rose-500">*</span></p>
        </div>
        
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          {[1, 2, 3, 4, 5].map((val) => {
            const isSelected = currentValue === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => setValue(val)}
                className={`flex-1 min-w-[50px] py-2 px-1 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center gap-1 border cursor-pointer ${
                  isSelected
                    ? 'bg-fuchsia-600 border-fuchsia-600 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                <span className="text-sm font-black">{val}</span>
                <span className="text-[8px] font-medium hidden sm:block truncate max-w-full">
                  {scaleTexts[val]}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4" id="public-survey-container">
      {/* Background designs */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_62%,#eef2ff_100%)]"></div>
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-fuchsia-500 via-violet-600 to-blue-600"></div>
      </div>

      <div className="w-full max-w-2xl bg-white/95 backdrop-blur-xl border border-slate-200 p-6 sm:p-8 rounded-3xl shadow-xl shadow-slate-200/70 space-y-6">
        {/* Header Branding */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center min-w-0">
            <BrandLogo width={165} height={55} className="max-w-full" />
          </div>
          <div className="text-right">
            <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider shadow-xs">
              Calidad & FDR
            </span>
          </div>
        </div>

        {/* STEP 1: VALIDATION SCREEN */}
        {step === 'validate' && (
          deletedSurvey ? (
            <div className="space-y-5 text-center py-6" id="deleted-survey-warning">
              <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto animate-pulse" />
              <h2 className="text-slate-800 text-lg font-black tracking-tight">Capacitación No Disponible</h2>
              <p className="text-slate-500 text-sm max-w-md mx-auto leading-relaxed font-semibold">
                Esta encuesta ya no se encuentra disponible.
              </p>
              {onClosePublicSurvey && (
                <button
                  type="button"
                  onClick={onClosePublicSurvey}
                  className="mt-4 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl px-5 py-2.5 transition-all cursor-pointer shadow-xs"
                >
                  Volver al Panel Administrativo
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5" id="step-validate">
              <div className="text-center space-y-2">
                <Clipboard className="w-10 h-10 text-fuchsia-600 mx-auto" />
                <h2 className="text-slate-800 text-xl font-black tracking-tight">Encuesta de Satisfacción</h2>
                <p className="text-slate-500 text-xs max-w-md mx-auto leading-relaxed">
                  Tu opinión nos ayuda a mejorar la experiencia de capacitación. Responde esta encuesta con sinceridad. Tus respuestas serán utilizadas para fortalecer el proceso de formación.
                </p>
              </div>

              <form onSubmit={handleValidate} className="space-y-4">
                {validationError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
                    <span>{validationError}</span>
                  </div>
                )}

                {/* If general survey URL without token, select Survey */}
                {!surveyToken ? (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-600 block">Capacitación Finalizada <span className="text-rose-500">*</span></label>
                    <select
                      value={selectedSurveyId}
                      onChange={(e) => setSelectedSurveyId(e.target.value)}
                      required
                      className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-xl px-3.5 py-2.5 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500 focus:border-fuchsia-500"
                    >
                      <option value="">Selecciona tu capacitación...</option>
                      {activeSurveysList.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.campaña}] {s.codigo_generacion} - Formador: {s.formador_nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  // Hidden/disabled view of selected survey details
                  (() => {
                    const s = remoteSurvey || surveys.find(
                      srv => srv.token.toLowerCase() === surveyToken.trim().toLowerCase() ||
                      srv.codigo_generacion.replace(/\s+/g, '-').toLowerCase() === surveyToken.trim().toLowerCase()
                    );
                    if (loadingSurvey) {
                      return (
                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold">
                          Verificando enlace de encuesta...
                        </div>
                      );
                    }
                    if (s) {
                      return (
                        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-1">
                          <span className="text-[9px] text-fuchsia-600 font-extrabold uppercase font-mono">Detalles de Capacitación</span>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="block text-[10px] text-slate-400 font-semibold">Campaña:</span>
                              <span className="font-bold text-slate-700">{s.campaña}</span>
                            </div>
                            <div>
                              <span className="block text-[10px] text-slate-400 font-semibold">Generación:</span>
                              <span className="font-bold text-slate-700">{s.codigo_generacion}</span>
                            </div>
                            <div className="col-span-2 pt-1 border-t border-slate-200/50">
                              <span className="block text-[10px] text-slate-400 font-semibold">Formador asignado:</span>
                              <span className="font-bold text-slate-700">{s.formador_nombre}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="bg-rose-50 p-3 rounded-xl border border-rose-200 text-rose-800 text-xs">
                        {validationError || 'No se pudo encontrar ninguna capacitación con el enlace de acceso actual. Verifica con el área de Formación.'}
                      </div>
                    );
                  })()
                )}

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-600 block">Ingresa tu DNI <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    required
                    pattern="[0-9]{8,15}"
                    title="DNI numérico válido"
                    placeholder="Escribe tu número de documento de identidad..."
                    value={dni}
                    onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-xl px-3.5 py-2.5 font-semibold outline-hidden focus:ring-1 focus:ring-fuchsia-500 focus:border-fuchsia-500"
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    type="submit"
                    disabled={validating}
                    className="flex-1 bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white font-bold text-xs rounded-xl py-3 flex items-center justify-center gap-2 cursor-pointer hover:opacity-95 shadow-sm active:scale-[0.98] transition-transform"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {validating ? 'Validando...' : 'Validar Registro & Responder'}
                  </button>
                </div>
              </form>

              {/* Back to administrative panel link */}
              <div className="text-center pt-2">
                <button
                  onClick={onClosePublicSurvey}
                  className="text-slate-400 hover:text-slate-600 text-[11px] font-bold underline transition-colors"
                >
                  Volver al Panel Administrativo de FDR
                </button>
              </div>
            </div>
          )
        )}

        {/* STEP 2: FILL SURVEY FORM */}
        {step === 'form' && activeParticipant && activeSurvey && (
          <form onSubmit={handleSubmitSurvey} className="space-y-6" id="step-form">
            {/* Context Info card */}
            <div className="bg-white text-slate-900 p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] bg-fuchsia-600 text-white px-2 py-0.5 rounded-md font-mono font-bold uppercase tracking-wider">
                  EJECUTIVO VALIDADO
                </span>
                <span className="text-[10px] font-mono text-slate-500">DNI: {activeParticipant.dni}</span>
              </div>
              <h3 className="font-extrabold text-sm leading-snug">{activeParticipant.nombres} {activeParticipant.apellidos}</h3>
              
              <div className="grid grid-cols-2 gap-4 text-xs pt-3 border-t border-slate-200 text-slate-500">
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wide">Campaña</span>
                  <span className="font-bold text-slate-900">{activeSurvey.campaña}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wide">Generación</span>
                  <span className="font-bold text-slate-900">{activeSurvey.codigo_generacion}</span>
                </div>
                <div className="col-span-2">
                  <span className="block text-[9px] text-slate-500 font-bold uppercase tracking-wide">Formador</span>
                  <span className="font-bold text-slate-900">{activeSurvey.formador_nombre}</span>
                </div>
              </div>
            </div>

            {formError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4.5 h-4.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Questions list wrapper */}
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
              <div className="bg-slate-50 px-3.5 py-2.5 rounded-xl text-[11px] text-slate-600 font-medium">
                Puntúa del <span className="font-extrabold text-slate-800">1 al 5</span> (donde 1 es <span className="font-extrabold text-rose-600">Muy malo</span> y 5 es <span className="font-extrabold text-emerald-600">Excelente</span>)
              </div>

              {renderRatingQuestion(1, '¿Qué tan útil fue la capacitación para el puesto que vas a desempeñar?', p1, setP1)}
              {renderRatingQuestion(2, '¿Qué tan claro fue el formador al explicar los temas?', p2, setP2)}
              {renderRatingQuestion(3, '¿El formador demostró dominio del contenido?', p3, setP3)}
              {renderRatingQuestion(4, '¿El formador resolvió tus dudas durante la capacitación?', p4, setP4)}
              {renderRatingQuestion(5, '¿La capacitación tuvo ejemplos, ejercicios o casos prácticos suficientes?', p5, setP5)}
              {renderRatingQuestion(6, '¿El material usado en la capacitación fue claro y útil?', p6, setP6)}
              {renderRatingQuestion(7, '¿Te sientes preparado para aplicar lo aprendido en operación?', p7, setP7)}
              {renderRatingQuestion(8, 'En general, ¿cómo calificarías al formador?', p8, setP8)}

              {/* Open questions */}
              <div className="space-y-3 bg-white/40 p-4 rounded-2xl border border-slate-100">
                <div className="flex gap-2">
                  <span className="font-extrabold text-fuchsia-600 font-mono text-sm">9.</span>
                  <label className="text-slate-800 text-xs font-bold leading-tight">
                    ¿Qué fue lo más positivo de la capacitación? <span className="text-rose-500">*</span>
                  </label>
                </div>
                <textarea
                  required
                  rows={2}
                  maxLength={500}
                  placeholder="Por favor, detalla qué aspectos te parecieron más positivos..."
                  value={comentarioPositivo}
                  onChange={(e) => setComentarioPositivo(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-xl px-3.5 py-2 outline-hidden focus:ring-1 focus:ring-fuchsia-500 focus:border-fuchsia-500"
                ></textarea>
              </div>

              <div className="space-y-3 bg-white/40 p-4 rounded-2xl border border-slate-100">
                <div className="flex gap-2">
                  <span className="font-extrabold text-fuchsia-600 font-mono text-sm">10.</span>
                  <label className="text-slate-800 text-xs font-bold leading-tight">
                    ¿Qué debería mejorar el formador o la capacitación? <span className="text-rose-500">*</span>
                  </label>
                </div>
                <textarea
                  required
                  rows={2}
                  maxLength={500}
                  placeholder="Por favor, coméntanos qué aspectos o temas podrían mejorarse..."
                  value={aspectoMejora}
                  onChange={(e) => setAspectoMejora(e.target.value)}
                  className="w-full bg-white border border-slate-200 text-slate-800 text-xs rounded-xl px-3.5 py-2 outline-hidden focus:ring-1 focus:ring-fuchsia-500 focus:border-fuchsia-500"
                ></textarea>
              </div>
            </div>

            <div className="pt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setStep('validate')}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl px-5 py-3 cursor-pointer transition-colors"
              >
                Atrás
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-fuchsia-600 to-indigo-600 text-white font-bold text-xs rounded-xl py-3 flex items-center justify-center gap-2 cursor-pointer hover:opacity-95 shadow-sm active:scale-[0.98] transition-transform"
              >
                <Send className="w-4 h-4" />
                Enviar Encuesta de Satisfacción
              </button>
            </div>
          </form>
        )}

        {/* STEP 3: SUCCESS THANK YOU SCREEN */}
        {step === 'success' && activeParticipant && activeSurvey && (
          <div className="text-center space-y-6 py-6" id="step-success">
            <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto border border-emerald-100 animate-bounce">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-2">
              <h2 className="text-slate-800 text-xl font-black tracking-tight">¡Muchas gracias, {activeParticipant.nombres}!</h2>
              <p className="text-slate-500 text-xs max-w-sm mx-auto leading-relaxed">
                Tus respuestas se registraron exitosamente. Valoramos profundamente tus comentarios, ya que nos ayudan a perfeccionar continuamente nuestros procesos de Formación y Desarrollo en <strong>{APP_NAME}</strong>.
              </p>
            </div>

            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 max-w-sm mx-auto text-left text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Generación:</span>
                <span className="font-bold text-slate-700">{activeSurvey.codigo_generacion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Formador:</span>
                <span className="font-bold text-slate-700">{activeSurvey.formador_nombre}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fecha de Registro:</span>
                <span className="font-bold text-slate-700 font-mono text-[11px]">{formatPeruDate(new Date())}</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2 max-w-xs mx-auto">
              <button
                onClick={() => {
                  setStep('validate');
                  setDni('');
                  setP1(0); setP2(0); setP3(0); setP4(0); setP5(0); setP6(0); setP7(0); setP8(0);
                  setComentarioPositivo('');
                  setAspectoMejora('');
                }}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl py-3 cursor-pointer transition-colors"
              >
                Registrar otra respuesta
              </button>
              <button
                onClick={onClosePublicSurvey}
                className="w-full text-slate-400 hover:text-slate-600 text-xs font-bold py-1 underline cursor-pointer"
              >
                Volver al panel administrativo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
