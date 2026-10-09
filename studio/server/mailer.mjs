/**
 * ChiCong Studio Email Notification Service
 * Supports Resend API (HTTP REST, zero-dependency) and SMTP (Nodemailer).
 */

const escapeHtml = (str) =>
  String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export function buildStudioEmail({ inquiry, reference, settings, siteUrl = 'https://chicongphoto.vn' }) {
  const brand = escapeHtml(settings?.brand || 'ChiCong');
  const name = escapeHtml(inquiry.name);
  const phone = escapeHtml(inquiry.phone || 'Chưa cung cấp');
  const email = escapeHtml(inquiry.email || 'Chưa cung cấp');
  const service = escapeHtml(inquiry.service || 'Chưa chọn dịch vụ');
  const date = escapeHtml(inquiry.date || 'Chưa chọn ngày');
  const budget = escapeHtml(inquiry.budget || 'Chưa cung cấp');
  const message = escapeHtml(inquiry.message || 'Không có lời nhắn');
  const adminUrl = `${siteUrl.replace(/\/$/, '')}/admin`;

  const subject = `[${brand}] Yêu cầu tư vấn mới từ ${inquiry.name.replace(/[\r\n]/g, ' ')} (#${reference})`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;line-height:1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f4f0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:580px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e4;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
          <!-- Header -->
          <tr>
            <td style="padding:28px 32px;background:#1c1917;color:#faf8f5;">
              <h1 style="margin:0;font-size:20px;font-weight:600;letter-spacing:0.02em;">${brand} · Thông báo yêu cầu tư vấn</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#a8a29e;">Mã tham chiếu: #${reference}</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 20px;font-size:15px;color:#44403c;">Khách hàng vừa gửi biểu mẫu tư vấn ngày cưới qua website:</p>
              
              <table role="presentation" width="100%" style="border-collapse:collapse;margin-bottom:24px;font-size:14px;">
                <tr style="border-bottom:1px solid #f5f5f4;">
                  <td style="padding:10px 0;color:#78716c;width:130px;vertical-align:top;">Họ và tên</td>
                  <td style="padding:10px 0;color:#1c1917;font-weight:600;">${name}</td>
                </tr>
                <tr style="border-bottom:1px solid #f5f5f4;">
                  <td style="padding:10px 0;color:#78716c;vertical-align:top;">Số điện thoại</td>
                  <td style="padding:10px 0;color:#1c1917;">
                    ${inquiry.phone ? `<a href="tel:${phone}" style="color:#2563eb;text-decoration:none;font-weight:600;">${phone}</a> (Bấm để gọi)` : '<em>Chưa cung cấp</em>'}
                  </td>
                </tr>
                <tr style="border-bottom:1px solid #f5f5f4;">
                  <td style="padding:10px 0;color:#78716c;vertical-align:top;">Email</td>
                  <td style="padding:10px 0;color:#1c1917;">
                    ${inquiry.email ? `<a href="mailto:${email}" style="color:#2563eb;text-decoration:none;">${email}</a>` : '<em>Chưa cung cấp</em>'}
                  </td>
                </tr>
                <tr style="border-bottom:1px solid #f5f5f4;">
                  <td style="padding:10px 0;color:#78716c;vertical-align:top;">Dịch vụ</td>
                  <td style="padding:10px 0;color:#1c1917;font-weight:500;">${service}</td>
                </tr>
                <tr style="border-bottom:1px solid #f5f5f4;">
                  <td style="padding:10px 0;color:#78716c;vertical-align:top;">Ngày dự kiến</td>
                  <td style="padding:10px 0;color:#1c1917;">${date}</td>
                </tr>
                <tr style="border-bottom:1px solid #f5f5f4;">
                  <td style="padding:10px 0;color:#78716c;vertical-align:top;">Ngân sách</td>
                  <td style="padding:10px 0;color:#1c1917;">${budget}</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;color:#78716c;vertical-align:top;">Lời nhắn</td>
                  <td style="padding:10px 0;color:#1c1917;white-space:pre-wrap;">${message}</td>
                </tr>
              </table>

              <div style="margin:28px 0 12px;text-align:center;">
                <a href="${adminUrl}" style="display:inline-block;padding:12px 28px;background:#1c1917;color:#faf8f5;text-decoration:none;border-radius:6px;font-size:14px;font-weight:500;">Mở trang Quản trị Studio</a>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px;background:#faf8f5;border-top:1px solid #e7e5e4;font-size:12px;color:#a8a29e;text-align:center;">
              Email này được tạo tự động khi khách gửi biểu mẫu tại <a href="${siteUrl}" style="color:#78716c;">${siteUrl}</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `YÊU CẦU TƯ VẤN MỚI (#${reference})
----------------------------------------
Họ và tên: ${inquiry.name}
Số điện thoại: ${inquiry.phone || 'Chưa cung cấp'}
Email: ${inquiry.email || 'Chưa cung cấp'}
Dịch vụ: ${inquiry.service || 'Chưa chọn'}
Ngày dự kiến: ${inquiry.date || 'Chưa chốt ngày'}
Ngân sách: ${inquiry.budget || 'Chưa cung cấp'}
Lời nhắn: ${inquiry.message || 'Không có'}

Xem trong Quản trị: ${adminUrl}
`;

  return { subject, html, text };
}

export function buildClientEmail({ inquiry, reference, settings, siteUrl = 'https://chicongphoto.vn' }) {
  const brand = escapeHtml(settings?.brand || 'ChiCong');
  const name = escapeHtml(inquiry.name);
  const service = escapeHtml(inquiry.service || 'Tư vấn ngày cưới');
  const date = escapeHtml(inquiry.date || 'Chưa chốt ngày');
  const responseNote = escapeHtml(settings?.responseNote || 'Chí Công sẽ liên hệ lại qua Số điện thoại / Zalo trong thời gian sớm nhất để lắng nghe và trao đổi chi tiết.');
  const phone = escapeHtml(settings?.phone || '0969910198');
  const zalo = settings?.zalo || (settings?.phone ? `https://zalo.me/${settings.phone}` : 'https://zalo.me/0969910198');
  const facebook = settings?.facebook || 'https://facebook.com/chicongphoto';

  const subject = `${brand} đã nhận lời nhắn của bạn (Mã: #${reference})`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#faf8f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1917;line-height:1.6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#faf8f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e4;overflow:hidden;">
          <!-- Top bar -->
          <tr>
            <td style="padding:32px 32px 20px;text-align:center;border-bottom:1px solid #f5f5f4;">
              <h1 style="margin:0;font-family:Georgia,serif;font-size:24px;font-weight:400;letter-spacing:0.04em;color:#1c1917;">${brand}</h1>
              <p style="margin:4px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;color:#a8a29e;">Wedding Photography</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;color:#1c1917;">Chào <strong>${name}</strong>,</p>
              
              <p style="margin:0 0 18px;font-size:14px;color:#44403c;">
                Cảm ơn hai bạn đã ghé thăm portfolio và gửi lời nhắn cho Chí Công Studio! Mình đã nhận được thông tin yêu cầu tư vấn:
              </p>

              <div style="background:#faf8f5;border-radius:8px;padding:16px 20px;margin-bottom:20px;border-left:3px solid #1c1917;">
                <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Mã tham chiếu: <strong style="color:#1c1917;">#${reference}</strong></p>
                <p style="margin:0 0 8px;font-size:13px;color:#78716c;">Dịch vụ quan tâm: <strong style="color:#1c1917;">${service}</strong></p>
                <p style="margin:0;font-size:13px;color:#78716c;">Ngày dự kiến: <strong style="color:#1c1917;">${date}</strong></p>
              </div>

              <p style="margin:0 0 20px;font-size:14px;color:#44403c;line-height:1.6;">
                ${responseNote}
              </p>

              <p style="margin:0 0 24px;font-size:14px;color:#44403c;">
                Nếu cần trao đổi gấp hoặc gửi thêm hình ảnh phong cách yêu thích, hai bạn có thể nhắn trực tiếp cho mình qua Zalo hoặc gọi số hotline bên dưới nhé.
              </p>

              <div style="text-align:center;margin-bottom:12px;">
                <a href="${zalo}" style="display:inline-block;padding:10px 24px;background:#1c1917;color:#faf8f5;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500;margin-right:8px;">Nhắn tin qua Zalo</a>
                <a href="tel:${phone}" style="display:inline-block;padding:10px 20px;background:#f5f4f0;color:#1c1917;text-decoration:none;border-radius:6px;font-size:13px;font-weight:500;">Gọi ${phone}</a>
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:#faf8f5;border-top:1px solid #e7e5e4;font-size:12px;color:#78716c;text-align:center;line-height:1.7;">
              <p style="margin:0;"><strong>${brand} · Vietnam Wedding Photographer</strong></p>
              <p style="margin:4px 0 0;">Điện thoại: ${phone} · <a href="${siteUrl}" style="color:#1c1917;text-decoration:none;">${siteUrl}</a></p>
              <p style="margin:4px 0 0;"><a href="${facebook}" style="color:#78716c;">Facebook Fanpage</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Chào ${inquiry.name},

Cảm ơn hai bạn đã gửi lời nhắn cho Chí Công Studio! Mình đã nhận được thông tin yêu cầu tư vấn:
- Mã tham chiếu: #${reference}
- Dịch vụ: ${inquiry.service || 'Tư vấn ngày cưới'}
- Ngày dự kiến: ${inquiry.date || 'Chưa chốt ngày'}

${settings?.responseNote || 'Chí Công sẽ liên hệ lại qua Số điện thoại / Zalo trong thời gian sớm nhất.'}

Liên hệ trực tiếp:
- Hotline: ${phone}
- Zalo: ${zalo}
- Website: ${siteUrl}

Thân mến,
Chí Công Studio
`;

  return { subject, html, text };
}

export function createMailer(env = process.env, options = {}) {
  const resendApiKey = options.resendApiKey || env.RESEND_API_KEY || '';
  const smtpHost = options.smtpHost || env.SMTP_HOST || '';
  const emailFrom = options.emailFrom || env.EMAIL_FROM || 'ChiCong Studio <onboarding@resend.dev>';
  const notificationEmail = options.notificationEmail || env.NOTIFICATION_EMAIL || env.STUDIO_EMAIL || '';

  let provider = 'none';
  if (options.send) {
    provider = 'custom';
  } else if (resendApiKey) {
    provider = 'resend';
  } else if (smtpHost) {
    provider = 'smtp';
  }

  const isEnabled = provider !== 'none';

  async function sendEmail({ to, subject, html, text, from = emailFrom, replyTo }) {
    if (!isEnabled) {
      return { success: false, skipped: true, reason: 'no_provider' };
    }

    if (options.send) {
      return options.send({ to, subject, html, text, from, replyTo });
    }

    if (provider === 'resend') {
      const payload = {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {})
      };

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Resend API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      return { success: true, provider: 'resend', id: data?.id };
    }

    if (provider === 'smtp') {
      const nodemailer = (await import('nodemailer')).default;
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(env.SMTP_PORT || 587),
        secure: env.SMTP_SECURE === 'true' || Number(env.SMTP_PORT) === 465,
        auth: env.SMTP_USER && env.SMTP_PASS ? {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS
        } : undefined
      });

      const info = await transporter.sendMail({
        from,
        to,
        subject,
        html,
        text,
        ...(replyTo ? { replyTo } : {})
      });

      return { success: true, provider: 'smtp', messageId: info.messageId };
    }

    return { success: false, skipped: true };
  }

  async function notifyNewInquiry({ inquiry, reference, settings, siteUrl = 'https://chicongphoto.vn' }) {
    if (!isEnabled) {
      return { studio: { skipped: true }, client: { skipped: true } };
    }

    const studioRecipient = notificationEmail || settings?.email || 'info@chicongphoto.vn';
    const studioMail = buildStudioEmail({ inquiry, reference, settings, siteUrl });

    const results = {};

    // 1. Send alert to studio
    try {
      results.studio = await sendEmail({
        to: studioRecipient,
        subject: studioMail.subject,
        html: studioMail.html,
        text: studioMail.text,
        replyTo: inquiry.email || undefined
      });
    } catch (err) {
      console.error('[mailer] Failed to send studio alert:', err?.message || err);
      results.studio = { success: false, error: err?.message || String(err) };
    }

    // 2. Send confirmation to client if valid email provided
    const validClientEmail = inquiry.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email);
    if (validClientEmail) {
      const clientMail = buildClientEmail({ inquiry, reference, settings, siteUrl });
      try {
        results.client = await sendEmail({
          to: inquiry.email,
          subject: clientMail.subject,
          html: clientMail.html,
          text: clientMail.text,
          replyTo: studioRecipient
        });
      } catch (err) {
        console.error('[mailer] Failed to send client confirmation:', err?.message || err);
        results.client = { success: false, error: err?.message || String(err) };
      }
    } else {
      results.client = { skipped: true, reason: 'no_valid_client_email' };
    }

    return results;
  }

  return {
    provider,
    enabled: isEnabled,
    sendEmail,
    notifyNewInquiry
  };
}
