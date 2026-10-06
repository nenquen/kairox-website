/* one-time setup: creates admin credentials + webhook secret, prints once */
const fs = require('fs');
const crypto = require('crypto');
const DATA = '/opt/admin-panel/data';
fs.mkdirSync(DATA, { recursive: true });
const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
let pass = '';
for (let i = 0; i < 24; i++) pass += abc[crypto.randomInt(abc.length)];
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(pass, Buffer.from(salt, 'hex'), 64).toString('hex');
const raw = crypto.randomBytes(20);
const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let totp = '', bits = '';
const bytes = Array.from(raw);
let acc = 0, accBits = 0;
for (const b of bytes) {
  acc = (acc << 8) | b;
  accBits += 8;
  while (accBits >= 5) {
    accBits -= 5;
    totp += b32[(acc >> accBits) & 31];
  }
}
if (accBits > 0) totp += b32[(acc << (5 - accBits)) & 31];
fs.writeFileSync(DATA + '/auth.json', JSON.stringify({ user: 'admin', salt, hash, totp }, null, 2), { mode: 0o600 });
const hook = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(DATA + '/hook.secret', hook + '\n', { mode: 0o600 });
if (!fs.existsSync(DATA + '/apps.json')) fs.writeFileSync(DATA + '/apps.json', '[]');
console.log('USER: admin');
console.log('PASS: ' + pass);
console.log('TOTP-URL: otpauth://totp/KairoxAdmin:admin?secret=' + totp + '&issuer=KairoxAdmin');
console.log('HOOK_SECRET: ' + hook);
