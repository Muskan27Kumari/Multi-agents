const http = require('http');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const https = require('https');


const PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Simple helper to load variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const data = fs.readFileSync(envPath, 'utf8');
    data.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index > 0) {
        const key = trimmed.substring(0, index).trim();
        let value = trimmed.substring(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  } catch (err) {
    console.error('Error loading .env file:', err.message);
  }
}

// Auto-append SMTP config if not present
function ensureSmtpEnv() {
  const envPath = path.join(__dirname, '.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    try {
      content = fs.readFileSync(envPath, 'utf8');
    } catch (e) {
      console.error('Could not read .env at setup:', e.message);
    }
  }
  if (!content.includes('SMTP_HOST=')) {
    const smtpTemplate = `
# SMTP Email Configuration
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_USER=info@vgiskill.ai
SMTP_PASSWORD=********
SMTP_FROM_EMAIL=info@vgiskill.ai
CONTACT_EMAIL=connect@vgiskill.ai
`;
    try {
      fs.appendFileSync(envPath, smtpTemplate, 'utf8');
      console.log('Appended SMTP template configurations to .env file.');
    } catch (e) {
      console.error('Could not append SMTP template to .env:', e.message);
    }
  }
}

const botUsernamesCache = {
  universe: null,
  rag: null,
  review: null,
  booking: null,
  marketing: null,
  portfolio: null,
  resume: null,
  hr: null,
  drive_rag: null,
};

function getBotUsername(token) {
  return new Promise((resolve) => {
    if (!token || token.includes('your-') || token === '********' || token.trim() === '') {
      return resolve(null);
    }
    const url = `https://api.telegram.org/bot${token}/getMe`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok && parsed.result && parsed.result.username) {
            resolve(parsed.result.username);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => {
      resolve(null);
    });
  });
}

async function populateBotUsernames() {
  const tokens = {
    universe: process.env.TELEGRAM_BOT_TOKEN,
    rag: process.env.TELEGRAM_BOT_TOKEN_RAG,
    review: process.env.TELEGRAM_BOT_TOKEN_REVIEW,
    booking: process.env.TELEGRAM_BOT_TOKEN_BOOKING,
    marketing: process.env.TELEGRAM_BOT_TOKEN_MARKETING,
    portfolio: process.env.TELEGRAM_BOT_TOKEN_PORTFOLIO,
    resume: process.env.TELEGRAM_BOT_TOKEN_RESUME,
    hr: process.env.TELEGRAM_BOT_TOKEN_HR,
    drive_rag: process.env.TELEGRAM_BOT_TOKEN_DRIVE_RAG,
  };

  for (const [key, token] of Object.entries(tokens)) {
    const envKey = `TELEGRAM_BOT_USERNAME_${key.toUpperCase()}`;
    const override = process.env[envKey] || (key === 'universe' ? process.env.TELEGRAM_BOT_USERNAME : null);
    if (override && override.trim()) {
      botUsernamesCache[key] = override.trim().replace(/^@/, "");
      continue;
    }

    if (token) {
      const username = await getBotUsername(token);
      if (username) {
        botUsernamesCache[key] = username;
      }
    }
  }
}

// Initialize environment configuration
ensureSmtpEnv();
loadEnv();
populateBotUsernames().catch(err => console.error('Failed to populate bot usernames:', err));


// Native TLS SMTP Client over SSL (port 465)
function sendEmail(options) {
  return new Promise((resolve, reject) => {
    let resolvedOrRejected = false;
    
    const socket = tls.connect({
      host: options.host,
      port: options.port,
      rejectUnauthorized: false
    });

    socket.setTimeout(15000);

    let state = 'CONNECTING';
    let responseBuffer = '';

    const send = (cmd) => {
      if (socket.writable) {
        socket.write(cmd);
      }
    };

    const done = (err) => {
      if (resolvedOrRejected) return;
      resolvedOrRejected = true;
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    socket.on('secureConnect', () => {
      state = 'GREETING';
    });

    socket.on('timeout', () => {
      done(new Error('SMTP connection timed out'));
    });

    socket.on('data', (data) => {
      responseBuffer += data.toString();
      const lines = responseBuffer.split('\r\n');
      if (lines.length < 2) return;

      const lastLine = lines[lines.length - 2];
      if (lastLine && /^\d{3} /.test(lastLine)) {
        const code = parseInt(lastLine.substring(0, 3), 10);
        responseBuffer = '';
        handleResponse(code, lastLine);
      }
    });

    socket.on('error', (err) => {
      done(err);
    });

    socket.on('close', () => {
      if (state !== 'DONE') {
        done(new Error('SMTP connection closed unexpectedly'));
      }
    });

    function handleResponse(code, line) {
      switch (state) {
        case 'GREETING':
          if (code === 220) {
            state = 'EHLO';
            send(`EHLO localhost\r\n`);
          } else {
            fail(`Expected greeting 220, got: ${line}`);
          }
          break;

        case 'EHLO':
          if (code === 250) {
            state = 'AUTH_LOGIN';
            send(`AUTH LOGIN\r\n`);
          } else {
            fail(`EHLO failed: ${line}`);
          }
          break;

        case 'AUTH_LOGIN':
          if (code === 334) {
            state = 'AUTH_USER';
            send(Buffer.from(options.user).toString('base64') + '\r\n');
          } else {
            fail(`AUTH LOGIN failed: ${line}`);
          }
          break;

        case 'AUTH_USER':
          if (code === 334) {
            state = 'AUTH_PASS';
            send(Buffer.from(options.pass).toString('base64') + '\r\n');
          } else {
            fail(`Username rejected: ${line}`);
          }
          break;

        case 'AUTH_PASS':
          if (code === 235) {
            state = 'MAIL_FROM';
            send(`MAIL FROM:<${options.from}>\r\n`);
          } else {
            fail(`Authentication failed: ${line}`);
          }
          break;

        case 'MAIL_FROM':
          if (code === 250) {
            state = 'RCPT_TO';
            send(`RCPT TO:<${options.to}>\r\n`);
          } else {
            fail(`MAIL FROM rejected: ${line}`);
          }
          break;

        case 'RCPT_TO':
          if (code === 250) {
            state = 'DATA';
            send(`DATA\r\n`);
          } else {
            fail(`RCPT TO rejected: ${line}`);
          }
          break;

        case 'DATA':
          if (code === 354) {
            state = 'SENDING_DATA';
            
            const msgData = [
              `From: ${options.from}`,
              `To: ${options.to}`,
              `Subject: ${options.subject}`,
              `MIME-Version: 1.0`,
              `Content-Type: text/plain; charset=utf-8`,
              `Content-Transfer-Encoding: 7bit`,
              '',
              options.text,
              '.\r\n'
            ].join('\r\n');

            send(msgData);
          } else {
            fail(`DATA command failed: ${line}`);
          }
          break;

        case 'SENDING_DATA':
          if (code === 250) {
            state = 'DONE';
            send(`QUIT\r\n`);
            done(null);
          } else {
            fail(`Data transmission failed: ${line}`);
          }
          break;
      }
    }

    function fail(msg) {
      state = 'ERROR';
      send(`QUIT\r\n`);
      done(new Error(msg));
    }
  });
}

const server = http.createServer((req, res) => {
  // Decode URL in case of special characters
  let safeUrl;
  try {
    safeUrl = decodeURIComponent(req.url);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // Strip query parameters
  const pathname = safeUrl.split('?')[0];

  // Handle Bot Config API request
  if (req.method === 'GET' && pathname === '/api/bot-config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(botUsernamesCache));
    return;
  }

  // Handle Contact API request
  if (req.method === 'POST' && pathname === '/api/contact') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.name || !data.email || !data.biz || !data.wa) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing required fields' }));
          return;
        }

        // Parse environment variables from .env
        loadEnv();

        const smtpHost = process.env.SMTP_HOST || 'smtpout.secureserver.net';
        const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 465;
        const smtpUser = process.env.SMTP_USER || 'info@vgiskill.ai';
        const smtpPass = process.env.SMTP_PASSWORD;
        const smtpFrom = process.env.SMTP_FROM_EMAIL || smtpUser;
        const contactEmail = process.env.CONTACT_EMAIL || 'connect@vgiskill.ai';

        if (!smtpPass || smtpPass === '********') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'SMTP password is not set in the .env file.' }));
          return;
        }

        const emailText = [
          `New Agent Request Form Submission:`,
          `----------------------------------`,
          `Name: ${data.name}`,
          `Business: ${data.biz}`,
          `Email: ${data.email}`,
          `WhatsApp: +91 ${data.wa}`,
          `Agent of Interest: ${data.agent || 'Not specified'}`,
          `Message: ${data.msg || 'None'}`,
          `----------------------------------`,
          `Sent from: VGI Agent Universe Contact Page`
        ].join('\n');

        sendEmail({
          host: smtpHost,
          port: smtpPort,
          user: smtpUser,
          pass: smtpPass,
          from: smtpFrom,
          to: contactEmail,
          subject: `New Contact Request - ${data.name}`,
          text: emailText
        })
        .then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        })
        .catch(err => {
          console.error('[SMTP Send Error]:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'SMTP Error: ' + err.message }));
        });

      } catch (err) {
        console.error('[Parse JSON Error]:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload: ' + err.message }));
      }
    });
    return;
  }

  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

  // Legacy assets folder fallback check (e.g. for assets/logo.png)
  if (pathname.startsWith('/assets/') && !fs.existsSync(filePath)) {
    const legacyPath = path.join(__dirname, pathname);
    if (fs.existsSync(legacyPath)) {
      filePath = legacyPath;
    }
  }

  // Prevent directory traversal attacks
  const relative = path.relative(__dirname, filePath);
  const isSafe = !relative.startsWith('..') && !path.isAbsolute(relative);

  if (!isSafe) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Error: ' + error.code);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
  console.log('Press Ctrl+C to stop.');
});
