import nodemailer from "nodemailer";

// Salida de correo del sistema (hoy solo la usa Importaciones). La cuenta NO vive en el código ni en
// git: sale de backend/.env del servidor, así que cambiar de cuenta es editar esas líneas y reiniciar
// con pm2. Con Google Workspace (esteromar.gt) la contraseña es una "contraseña de aplicación" de la
// cuenta: la normal la rechaza con 535-5.7.8.
//
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587                      (587 = STARTTLS; 465 = TLS directo)
//   SMTP_USER=cuenta@esteromar.gt
//   SMTP_PASS=<contraseña de aplicación>
//   SMTP_FROM="Importaciones MP <cuenta@esteromar.gt>"   (opcional; si falta, sale como SMTP_USER)

let transporte: nodemailer.Transporter | null = null;

export function correoConfigurado(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function obtenerTransporte(): nodemailer.Transporter {
  if (!correoConfigurado()) throw new Error("El correo no está configurado en el servidor (faltan SMTP_HOST, SMTP_USER o SMTP_PASS en .env)");
  if (!transporte) {
    const puerto = Number(process.env.SMTP_PORT) || 587;
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: puerto,
      secure: puerto === 465,
      requireTLS: puerto !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporte;
}

export interface Correo { para: string[]; asunto: string; html: string; texto: string }

// Un solo correo con todos en "Para": así cada quien ve a quién más le llegó, como en la demo.
export async function enviarCorreo(c: Correo): Promise<{ messageId: string; aceptados: string[]; rechazados: string[] }> {
  const r = await obtenerTransporte().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: c.para,
    subject: c.asunto,
    html: c.html,
    text: c.texto,
  });
  return { messageId: r.messageId, aceptados: r.accepted.map(String), rechazados: r.rejected.map(String) };
}
