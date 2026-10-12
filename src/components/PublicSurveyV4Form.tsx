import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Send, ShieldCheck } from 'lucide-react';
import type { SurveyResponse, TrainingSurvey } from '../types';
import { getPublicSurveyContext, getPublicSurveyMetadata, submitPublicSurveyResponse } from '../services/publicSurveyService';

const OJT_QUESTIONS = [
  '¿Cómo calificarías el acompañamiento que recibiste de tu formador durante el OJT?',
  '¿Cómo calificarías la disponibilidad de tu formador para atender tus dudas durante la gestión?',
  '¿Cómo calificarías la orientación que recibiste para mejorar tu gestión de ventas?',
  '¿Cómo calificarías el apoyo de tu formador cuando enfrentaste dificultades durante la gestión?',
  '¿Cómo calificarías los refuerzos que recibiste para mejorar los aspectos en los que tenías dificultades?',
  '¿Cómo calificarías la claridad y utilidad de las retroalimentaciones que recibiste?',
  '¿Cómo calificarías el apoyo recibido para prepararte para ingresar a operación?',
  'En general, ¿cómo calificarías el desempeño de tu formador OJT?',
];
const OPS_QUESTIONS = [
  '¿Cómo calificarías la bienvenida y orientación que recibiste de tu supervisor al ingresar a operación?',
  '¿Cómo calificarías el acompañamiento de tu supervisor durante tus primeros días de gestión?',
  '¿Cómo calificarías su disponibilidad para atender tus consultas o dificultades?',
  '¿Cómo calificarías el apoyo que recibiste de tu supervisor para mejorar tus resultados de ventas?',
  '¿Cómo calificarías la claridad y utilidad de las retroalimentaciones de tu supervisor?',
  '¿Cómo calificarías el trato y respeto de tu supervisor hacia ti?',
  '¿Cómo calificarías el apoyo de tu supervisor para integrarte y adaptarte al equipo?',
  'En general, ¿cómo calificarías el desempeño de tu supervisor durante tus primeros días?',
];
const DIFFICULTIES = ['Herramientas/sistemas', 'Metas de ventas', 'Falta de acompañamiento', 'Comunicación o trato', 'Condiciones laborales', 'Motivos personales', 'Otras dificultades', 'Ninguna'];

interface Props {
  surveyToken: string;
  initialSurvey: TrainingSurvey;
  onAddResponse: (response: SurveyResponse) => void;
  onClose: () => void;
}

export default function PublicSurveyV4Form({ surveyToken, initialSurvey, onAddResponse, onClose }: Props) {
  const [survey, setSurvey] = useState<TrainingSurvey>(initialSurvey);
  const [nonce, setNonce] = useState('');
  const [dni, setDni] = useState('');
  const [validated, setValidated] = useState(false);
  const [answers, setAnswers] = useState<number[]>(Array(8).fill(0));
  const [supervisor, setSupervisor] = useState('');
  const [difficulties, setDifficulties] = useState<string[]>([]);
  const [leaveIntent, setLeaveIntent] = useState<'Sí' | 'No' | 'Tengo dudas' | 'Prefiero no responder' | ''>('');
  const [leaveReason, setLeaveReason] = useState('');
  const [positive, setPositive] = useState('');
  const [improvement, setImprovement] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const isOperations = survey.survey_type === 'operaciones';

  useEffect(() => {
    getPublicSurveyMetadata(surveyToken).then(({ survey: remote, submission_nonce }) => {
      setSurvey(remote); setNonce(submission_nonce || '');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'No se pudo cargar la encuesta.'));
  }, [surveyToken]);

  const setAnswer = (index: number, value: number) => setAnswers((current) => current.map((item, position) => position === index ? value : item));
  const validateDni = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await getPublicSurveyContext(surveyToken, dni); setValidated(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo validar tu registro.'); }
    finally { setBusy(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (answers.some((answer) => answer < 1)) return setError('Responde las ocho preguntas con una valoración de 1 a 5.');
    if (isOperations && !supervisor) return setError('Selecciona el supervisor que deseas evaluar.');
    if (isOperations && !nonce) return setError('Actualiza la página para obtener un enlace de envío válido.');
    setBusy(true);
    try {
      const result = await submitPublicSurveyResponse(surveyToken, {
        ...(isOperations ? { submission_nonce: nonce, supervisor_nombre: supervisor, dificultades: difficulties, intencion_salida: leaveIntent || undefined, motivo_salida: leaveReason, comentario_q11: positive, comentario_q12: improvement } : { dni, comentario_positivo: positive, aspecto_mejora: improvement }),
        q1: answers[0], q2: answers[1], q3: answers[2], q4: answers[3], q5: answers[4], q6: answers[5], q7: answers[6], q8: answers[7],
      });
      onAddResponse(result.response); setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo registrar la encuesta.'); }
    finally { setBusy(false); }
  };
  const questions = isOperations ? OPS_QUESTIONS : OJT_QUESTIONS;
  const toggleDifficulty = (value: string) => setDifficulties((current) => {
    if (value === 'Ninguna') return current.includes(value) ? [] : [value];
    const next = current.filter((item) => item !== 'Ninguna');
    return next.includes(value) ? next.filter((item) => item !== value) : [...next, value];
  });

  return <div className="min-h-screen bg-white flex items-center justify-center p-4">
    <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-5">
      <div className="border-b border-slate-100 pb-4"><h1 className="text-xl font-extrabold text-slate-800">Encuesta de Satisfacción</h1><p className="text-xs text-slate-500 mt-1">{isOperations ? 'Experiencia en Operaciones' : 'Acompañamiento OJT'}</p></div>
      {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs font-semibold flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{error}</div>}
      {done ? <div className="text-center space-y-4 py-8"><CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" /><h2 className="text-lg font-extrabold text-slate-800">Gracias por responder</h2><button onClick={onClose} className="text-xs font-bold text-indigo-600 underline">Volver al Panel Administrativo de FDR</button></div> : !isOperations && !validated ? <form onSubmit={validateDni} className="space-y-4"><div className="bg-slate-50 p-4 rounded-xl text-xs"><b>Campaña:</b> {survey.campaña}<br /><b>Grupo OJT:</b> {survey.grupo_ojt || survey.codigo_generacion}<br /><b>Formador OJT:</b> {survey.formador_nombre}</div><label className="block text-xs font-bold text-slate-600">Ingresa tu DNI<input required pattern="[0-9]{8,15}" value={dni} onChange={(event) => setDni(event.target.value.replace(/\D/g, ''))} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5" /></label><button disabled={busy} className="w-full bg-fuchsia-600 text-white rounded-xl py-3 text-xs font-bold flex justify-center gap-2"><ShieldCheck className="w-4 h-4" />{busy ? 'Validando...' : 'Validar registro'}</button></form> : <form onSubmit={submit} className="space-y-4">
        <div className="bg-slate-50 p-4 rounded-xl text-xs"><b>Campaña:</b> {survey.campaña}{survey.subcampaña ? ` · ${survey.subcampaña}` : ''}{!isOperations && <><br /><b>Formador OJT:</b> {survey.formador_nombre}</>}</div>
        {isOperations && <label className="block text-xs font-bold text-slate-600">Supervisor a evaluar<select required value={supervisor} onChange={(event) => setSupervisor(event.target.value)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white"><option value="">Selecciona...</option>{(survey.supervisor_nombres || []).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
        <div className="bg-slate-50 px-3 py-2 rounded-xl text-[11px] text-slate-600">Puntúa del <b>1 al 5</b>, donde 1 es Muy malo y 5 es Excelente.</div>
        {questions.map((question, index) => <div key={question} className="border border-slate-100 rounded-xl p-4 space-y-3"><p className="text-xs font-bold text-slate-800">{index + 1}. {question} <span className="text-rose-500">*</span></p><div className="grid grid-cols-5 gap-2">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" onClick={() => setAnswer(index, value)} className={`rounded-xl border py-2 text-xs font-bold ${answers[index] === value ? 'bg-fuchsia-600 text-white border-fuchsia-600' : 'bg-white text-slate-600 border-slate-200'}`}>{value}</button>)}</div></div>)}
        {isOperations ? <><fieldset className="border border-slate-100 rounded-xl p-4"><legend className="text-xs font-bold text-slate-800 px-1">9. Dificultades durante los primeros días</legend><div className="grid sm:grid-cols-2 gap-2 mt-2">{DIFFICULTIES.map((value) => <label key={value} className="text-xs text-slate-600 flex gap-2"><input type="checkbox" checked={difficulties.includes(value)} onChange={() => toggleDifficulty(value)} />{value}</label>)}</div></fieldset><label className="block text-xs font-bold text-slate-700">10. ¿Has considerado dejar de trabajar en la campaña?<select value={leaveIntent} onChange={(event) => setLeaveIntent(event.target.value as typeof leaveIntent)} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2.5 bg-white"><option value="">Prefiero no responder</option><option>Sí</option><option>No</option><option>Tengo dudas</option><option>Prefiero no responder</option></select></label>{(leaveIntent === 'Sí' || leaveIntent === 'Tengo dudas') && <label className="block text-xs font-bold text-slate-700">Motivo principal<textarea value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} maxLength={500} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2" /></label>}<label className="block text-xs font-bold text-slate-700">11. ¿Qué fue lo más positivo de tu experiencia?<textarea value={positive} onChange={(event) => setPositive(event.target.value)} maxLength={500} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2" /></label><label className="block text-xs font-bold text-slate-700">12. ¿Qué debería mejorar tu supervisor o la empresa?<textarea value={improvement} onChange={(event) => setImprovement(event.target.value)} maxLength={500} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2" /></label></> : <><label className="block text-xs font-bold text-slate-700">9. ¿Qué fue lo más positivo del acompañamiento OJT?<textarea value={positive} onChange={(event) => setPositive(event.target.value)} maxLength={500} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2" /></label><label className="block text-xs font-bold text-slate-700">10. ¿Qué debería mejorar tu formador?<textarea value={improvement} onChange={(event) => setImprovement(event.target.value)} maxLength={500} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2" /></label></>}
        <button disabled={busy} className="w-full bg-fuchsia-600 text-white rounded-xl py-3 text-xs font-bold flex justify-center gap-2"><Send className="w-4 h-4" />{busy ? 'Enviando...' : 'Enviar encuesta'}</button>
      </form>}
      {!done && <button onClick={onClose} className="w-full text-xs text-slate-400 font-bold underline">Volver al Panel Administrativo de FDR</button>}
    </div>
  </div>;
}
