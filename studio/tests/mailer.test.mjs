import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStudioEmail,buildClientEmail,createMailer} from '../server/mailer.mjs';
import {createApp} from '../server/app.mjs';
import {openDatabase} from '../server/db.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('Email templates format, escape and include essential consultation details', () => {
  const inquiry = {
    name: 'Nguyễn Văn A & Trần Thị B <script>alert(1)</script>',
    phone: '0912345678',
    email: 'couple@example.com',
    service: 'Pre-wedding & Phóng sự cưới',
    date: '2026-11-20',
    budget: '25.000.000đ - 35.000.000đ',
    message: 'Chào Chí Công, tụi mình muốn chụp phóng sự ngày cưới tại TP.HCM.'
  };
  const settings = {
    brand: 'ChiCong',
    email: 'info@chicongphoto.vn',
    phone: '0969910198',
    responseNote: 'Chí Công phản hồi trong 24 giờ.'
  };

  // Studio notification
  const studio = buildStudioEmail({ inquiry, reference: 'a1b2c3d4', settings, siteUrl: 'https://chicongphoto.vn' });
  assert.match(studio.subject, /\[ChiCong\] Yêu cầu tư vấn mới từ Nguyễn Văn A/);
  assert.match(studio.subject, /#a1b2c3d4/);
  assert.ok(!studio.html.includes('<script>alert(1)</script>'), 'HTML must escape malicious script tag');
  assert.ok(studio.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.match(studio.html, /0912345678/);
  assert.match(studio.html, /couple@example.com/);
  assert.match(studio.html, /https:\/\/chicongphoto.vn\/admin/);
  assert.match(studio.text, /YÊU CẦU TƯ VẤN MỚI/);
  assert.match(studio.text, /#a1b2c3d4/);

  // Client confirmation
  const client = buildClientEmail({ inquiry, reference: 'a1b2c3d4', settings, siteUrl: 'https://chicongphoto.vn' });
  assert.match(client.subject, /ChiCong đã nhận lời nhắn của bạn/);
  assert.match(client.subject, /#a1b2c3d4/);
  assert.ok(!client.html.includes('<script>alert(1)</script>'));
  assert.match(client.html, /Chí Công phản hồi trong 24 giờ/);
  assert.match(client.html, /zalo\.me\/0969910198/);
  assert.match(client.text, /Mã yêu cầu: #a1b2c3d4/);
  for(const body of [client.html,client.text])assert.match(body,/chưa có nghĩa là đã giữ lịch chụp/);
  const special=buildStudioEmail({inquiry,reference:'a1b2c3d4',settings:{brand:'A & B'},siteUrl:'https://example.com'});
  assert.match(special.subject,/A & B/);
  assert.match(special.html,/A &amp; B/);
});

test('createMailer detects configuration and supports mock transports', async () => {
  // Disabled when no keys provided
  const disabledMailer = createMailer({});
  assert.equal(disabledMailer.enabled, false);
  assert.equal(disabledMailer.provider, 'none');
  const disabledRes = await disabledMailer.sendEmail({ to: 'test@example.com', subject: 'hi' });
  assert.equal(disabledRes.skipped, true);

  // Enabled with Resend key
  const resendMailer = createMailer({ RESEND_API_KEY: 're_test_key_123' });
  assert.equal(resendMailer.enabled, true);
  assert.equal(resendMailer.provider, 'resend');

  // Enabled with SMTP host
  const smtpMailer = createMailer({ SMTP_HOST: 'smtp.example.com' });
  assert.equal(smtpMailer.enabled, true);
  assert.equal(smtpMailer.provider, 'smtp');

  // Custom mock transport for testing
  const sent = [];
  const mockMailer = createMailer({}, {
    send: async (mail) => {
      sent.push(mail);
      return { success: true, id: 'mock-' + sent.length };
    }
  });
  assert.equal(mockMailer.enabled, true);
  assert.equal(mockMailer.provider, 'custom');

  // Notify inquiry with both email and phone: sends 2 emails
  const results = await mockMailer.notifyNewInquiry({
    inquiry: {
      name: 'Khách hàng A',
      phone: '0901234567',
      email: 'khachhang@example.com',
      service: 'Pre-wedding'
    },
    reference: 'ref12345',
    settings: { email: 'studio@chicongphoto.vn' }
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'studio@chicongphoto.vn');
  assert.equal(sent[0].replyTo, 'khachhang@example.com');
  assert.equal(sent[1].to, 'khachhang@example.com');
  assert.equal(sent[1].replyTo, 'studio@chicongphoto.vn');
  assert.equal(results.studio.success, true);
  assert.equal(results.client.success, true);

  // Notify inquiry with phone only: sends 1 email to studio only
  sent.length = 0;
  const phoneOnlyRes = await mockMailer.notifyNewInquiry({
    inquiry: {
      name: 'Khách hàng B',
      phone: '0909999999',
      email: '',
      service: 'Phóng sự cưới'
    },
    reference: 'ref67890',
    settings: { email: 'studio@chicongphoto.vn' }
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'studio@chicongphoto.vn');
  assert.equal(phoneOnlyRes.studio.success, true);
  assert.equal(phoneOnlyRes.client.skipped, true);
});

test('Inquiry API triggers notification on submission, skips replay and survives mailer failure', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chicong-mailer-test-'));
  const db = await openDatabase(dir);
  const sentEmails = [];
  let shouldFail = false;

  const mockMailer = createMailer({}, {
    send: async (mail) => {
      if (shouldFail) throw new Error('Simulated mail network timeout');
      sentEmails.push(mail);
      return { success: true };
    }
  });

  const { app } = await createApp({
    db,
    dataDir: dir,
    mailer: mockMailer,
    env: { SITE_URL: 'https://chicongphoto.vn' },
    origin: 'http://localhost'
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    const validPayload = {
      name: 'Dâu & Rể',
      phone: '0988776655',
      email: 'daure@example.com',
      service: 'Pre-wedding',
      date: '',
      budget: '',
      message: 'Xin tư vấn gói film.',
      requestKey: '11112222333344445555666677778888'
    };

    // 1. Initial valid submission triggers notification
    const res1 = await fetch(base + '/api/inquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost'
      },
      body: JSON.stringify(validPayload)
    });
    assert.equal(res1.status, 201);
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.ok(data1.reference);

    // Wait short tick for non-blocking notification promise
    await new Promise(r => setTimeout(r, 60));
    assert.equal(sentEmails.length, 2, 'Should send 2 emails (studio + client)');
    assert.match(sentEmails[0].subject, /Dâu & Rể/);
    assert.match(sentEmails[1].to, /daure@example.com/);

    // 2. Replay with identical requestKey does NOT re-send emails
    const res2 = await fetch(base + '/api/inquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost'
      },
      body: JSON.stringify(validPayload)
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();
    assert.equal(data2.reference, data1.reference);

    await new Promise(r => setTimeout(r, 60));
    assert.equal(sentEmails.length, 2, 'Replay must not trigger duplicate emails');

    // 3. Mailer failure does not break inquiry creation response
    shouldFail = true;
    const failPayload = {
      name: 'Khách hàng Mới',
      phone: '0911223344',
      email: 'new@example.com',
      service: 'Pre-wedding',
      message: 'Muốn trao đổi chi tiết về ngày cưới sắp tới.',
      requestKey: '99998888777766665555444433332222'
    };
    const res3 = await fetch(base + '/api/inquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost'
      },
      body: JSON.stringify(failPayload)
    });
    assert.equal(res3.status, 201, 'Inquiry must succeed even if mail provider throws');
    const data3 = await res3.json();
    assert.equal(data3.success, true);

  } finally {
    await new Promise(r => server.close(r));
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
