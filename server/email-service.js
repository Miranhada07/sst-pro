import nodemailer from 'nodemailer';

// Carregar variáveis de ambiente do .env caso ainda não tenham sido carregadas
try {
  process.loadEnvFile();
} catch (_) {
  // .env opcional se variáveis forem injetadas diretamente pelo container/SO
}

// Criação do transportador SMTP dinâmico
function getEmailTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });
  }

  // Se não houver SMTP configurado no ambiente, retornar null para modo contingência/simulado
  return null;
}

/**
 * Envia o código de verificação de 6 dígitos por e-mail
 * @param {Object} params
 * @param {string} params.to - E-mail do funcionário destinatário
 * @param {string} params.name - Nome completo do funcionário
 * @param {string} params.code - Código numérico de 6 dígitos
 * @param {number} [params.expiresMinutes=15] - Tempo de expiração em minutos
 */
export async function sendVerificationCodeEmail({ to, name, code, expiresMinutes = 15 }) {
  const fromName = process.env.SMTP_FROM_NAME || 'SST PRO - Segurança do Trabalho';
  const fromEmail = process.env.SMTP_FROM_EMAIL || 'notificacoes@sstpro.com.br';
  const from = `"${fromName}" <${fromEmail}>`;

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Código de Verificação SST PRO</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 0; }
        .container { max-width: 560px; margin: 30px auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
        .header { background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); color: #ffffff; padding: 28px 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 13px; opacity: 0.9; }
        .content { padding: 32px 28px; }
        .greeting { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #0f172a; }
        .text { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
        .code-box { background: #f1f5f9; border: 2px dashed #3b82f6; border-radius: 10px; padding: 20px; text-align: center; margin: 24px 0; }
        .code { font-family: monospace; font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #1d4ed8; }
        .code-label { font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; margin-top: 6px; letter-spacing: 1px; }
        .warning-box { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #1e40af; margin-bottom: 24px; }
        .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; }
        .footer a { color: #2563eb; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🛡️ SST PRO - Autenticação Segura</h1>
          <p>Sistema Integrado de Segurança e Saúde no Trabalho</p>
        </div>
        <div class="content">
          <div class="greeting">Olá, ${name || 'Colaborador(a)'}!</div>
          <div class="text">
            Um acesso ao sistema <strong>SST PRO</strong> foi solicitado para a sua conta. Para confirmar a sua identidade e liberar o acesso, utilize o código de verificação abaixo:
          </div>
          
          <div class="code-box">
            <div class="code">${code}</div>
            <div class="code-label">Código de Verificação de 6 Dígitos</div>
          </div>

          <div class="warning-box">
            ⏱️ Este código é válido por <strong>${expiresMinutes} minutos</strong> e é de uso único e pessoal. Nunca compartilhe este código com terceiros.
          </div>

          <div class="text" style="font-size: 13px; color: #64748b;">
            Se você não solicitou este código ou não reconhece este acesso, desconsidere este e-mail imediatamente.
          </div>
        </div>
        <div class="footer">
          SST PRO Enterprise &copy; ${new Date().getFullYear()} - Todos os direitos reservados.<br>
          Acesse: <a href="https://sstpro.com.br" target="_blank">https://sstpro.com.br</a>
        </div>
      </div>
    </body>
    </html>
  `;

  const textTemplate = `SST PRO - Código de Verificação\n\nOlá, ${name}!\n\nSeu código de verificação de segurança é: ${code}\n\nEste código expira em ${expiresMinutes} minutos e é de uso único.\n\nSST PRO Enterprise - https://sstpro.com.br`;

  try {
    const transporter = getEmailTransporter();

    if (transporter) {
      const info = await transporter.sendMail({
        from,
        to,
        subject: `🔐 [${code}] Seu Código de Verificação SST PRO`,
        text: textTemplate,
        html: htmlTemplate
      });

      console.log(`[EmailService] ✉️ E-mail enviado com sucesso para ${to} (ID: ${info.messageId}) - Código: ${code}`);
      return { success: true, messageId: info.messageId, code };
    } else {
      // Fallback sem SMTP configurado (desenvolvimento / ambiente inicial)
      console.log(`[EmailService/Simulado] 📧 [SMTP não configurado] Código de verificação para ${name} (${to}): ${code}`);
      return {
        success: true,
        simulated: true,
        message: 'Código de verificação gerado (Modo simulação SMTP ativo)',
        code
      };
    }
  } catch (error) {
    console.error(`[EmailService] ⚠️ Falha ao disparar e-mail via SMTP para ${to}:`, error.message);
    // Mesmo com erro de SMTP, registramos no log do servidor para que o técnico possa ser atendido
    console.log(`[EmailService/Fallback] 📧 Código de contingência para ${to}: ${code}`);
    return {
      success: true,
      error: error.message,
      fallback: true,
      code
    };
  }
}
