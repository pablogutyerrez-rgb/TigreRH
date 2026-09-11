import { dataDb as adminDb } from '../hybridDb.js';

interface SurveyEmailRecipient {
  participant_id: string;
  nombre: string;
  dni: string;
  correo: string;
  url: string;
}

interface SurveyEmailInfo {
  id: string;
  campana: string;
  codigo_generacion: string;
  formador_nombre: string;
}

interface SendSurveyInvitationsInput {
  survey: SurveyEmailInfo;
  recipients: SurveyEmailRecipient[];
  requestedBy: {
    uid: string;
    nombre: string;
  };
}

interface BrevoEmailResponse {
  messageId?: string;
  message?: string;
  code?: string;
}

const requiredBrevoVars = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL'];

const getSenderName = () => process.env.BREVO_SENDER_NAME || 'Automatizate';
const getSenderEmail = () => process.env.BREVO_SENDER_EMAIL || '';
const getEmailReplyTo = () => process.env.EMAIL_REPLY_TO || getSenderEmail();

const validateBrevoConfig = () => {
  const missing = requiredBrevoVars.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Faltan variables Brevo: ${missing.join(', ')}`);
  }
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildSurveyEmail = (survey: SurveyEmailInfo, recipient: SurveyEmailRecipient) => {
  const nombre = escapeHtml(recipient.nombre);
  const campana = escapeHtml(survey.campana);
  const generacion = escapeHtml(survey.codigo_generacion);
  const formador = escapeHtml(survey.formador_nombre);
  const url = escapeHtml(recipient.url);

  return {
    subject: `Encuesta de satisfaccion - ${generacion}`,
    text: [
      `Hola ${recipient.nombre},`,
      '',
      `Te invitamos a completar la encuesta de satisfaccion de la capacitacion ${survey.codigo_generacion}.`,
      `Campana: ${survey.campana}`,
      `Formador: ${survey.formador_nombre}`,
      '',
      `Ingresa aqui: ${recipient.url}`,
      '',
      'Gracias por ayudarnos a mejorar el proceso de formacion.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
        <h2 style="margin:0 0 12px;">Encuesta de satisfaccion</h2>
        <p>Hola <strong>${nombre}</strong>,</p>
        <p>Te invitamos a completar la encuesta de satisfaccion de tu capacitacion.</p>
        <ul>
          <li><strong>Campana:</strong> ${campana}</li>
          <li><strong>Generacion:</strong> ${generacion}</li>
          <li><strong>Formador:</strong> ${formador}</li>
        </ul>
        <p>
          <a href="${url}" style="background:#7c3aed;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">
            Responder encuesta
          </a>
        </p>
        <p style="font-size:12px;color:#64748b;">Si el boton no abre, copia este enlace en tu navegador:<br>${url}</p>
      </div>
    `,
  };
};

export const sendSurveyInvitations = async ({
  survey,
  recipients,
  requestedBy,
}: SendSurveyInvitationsInput) => {
  validateBrevoConfig();

  const results = [];
  for (const recipient of recipients) {
    const content = buildSurveyEmail(survey, recipient);
    const traceBase = {
      survey_id: survey.id,
      codigo_generacion: survey.codigo_generacion,
      participant_id: recipient.participant_id,
      destinatario: recipient.correo,
      tipo_correo: 'survey_invitation',
      provider: 'brevo',
      requested_by_uid: requestedBy.uid,
      requested_by_nombre: requestedBy.nombre,
      fecha_envio: new Date().toISOString(),
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': process.env.BREVO_API_KEY!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            name: getSenderName(),
            email: getSenderEmail(),
          },
          to: [
            {
              email: recipient.correo,
              name: recipient.nombre,
            },
          ],
          replyTo: {
            email: getEmailReplyTo(),
          },
          subject: content.subject,
          textContent: content.text,
          htmlContent: content.html,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      const data = (await response.json().catch(() => null)) as BrevoEmailResponse | null;
      if (!response.ok) {
        const message = data?.message || data?.code || 'Brevo no pudo enviar el correo.';
        throw new Error(message);
      }

      await saveEmailTrace({
        ...traceBase,
        estado_envio: 'enviado',
        message_id: data?.messageId || '',
      });

      results.push({
        participant_id: recipient.participant_id,
        correo: recipient.correo,
        messageId: data?.messageId || '',
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'Timeout conectando con Brevo.'
          : error instanceof Error
            ? error.message
            : 'No se pudo enviar el correo.';

      await saveEmailTrace({
        ...traceBase,
        estado_envio: 'error',
        error: message,
      });
      throw new Error(message);
    }
  }

  return results;
};

const saveEmailTrace = async (data: Record<string, unknown>) => {
  try {
    await adminDb.collection(process.env.EMAIL_TRACE_COLLECTION || 'correos_enviados').add(data);
  } catch (error) {
    console.error('Email trace save error:', error);
  }
};
