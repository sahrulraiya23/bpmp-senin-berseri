const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const {
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  validatePassword,
  generateTempPassword,
  isBcryptHash
} = require('../utils/password');
const MultiEventService = require('../services/multiEventService');

const db = require('../supabase-adapter');

test('Password Security Suite', async (t) => {
  await t.test('hashPassword produces valid bcrypt hash with cost 12', async () => {
    const raw = 'RahasiaKu123!';
    const hash = await hashPassword(raw);
    assert.ok(isBcryptHash(hash), 'Hash should be recognized as bcrypt');
    assert.ok(hash.startsWith('$2a$12$') || hash.startsWith('$2b$12$'), 'Salt cost should be 12');
    
    const isValid = await verifyPassword(raw, hash);
    assert.equal(isValid, true, 'verifyPassword should return true for correct password');

    const isWrong = await verifyPassword('SalahPassword!', hash);
    assert.equal(isWrong, false, 'verifyPassword should return false for incorrect password');
  });

  await t.test('validatePassword rejects short passwords (< 8 characters)', () => {
    const res = validatePassword('Short1!', { nip: '198501012010011001' });
    assert.equal(res.valid, false);
    assert.match(res.message, /minimal.*8/i);
  });

  await t.test('validatePassword rejects password matching NIP or username', () => {
    const nip = '198501012010011001';
    const resNip = validatePassword(nip, { nip, username: 'admin123' });
    assert.equal(resNip.valid, false);
    assert.match(resNip.message, /NIP/i);

    const resUser = validatePassword('admin123', { nip, username: 'admin123' });
    assert.equal(resUser.valid, false);
    assert.match(resUser.message, /username/i);
  });

  await t.test('validatePassword rejects password matching birthdate in NIP', () => {
    const nip = '198501012010011001'; // Birthdate: 1985-01-01 -> 19850101
    const res = validatePassword('19850101', { nip });
    assert.equal(res.valid, false);
    assert.match(res.message, /tanggal lahir/i);
  });

  await t.test('validatePassword accepts compliant password', () => {
    const res = validatePassword('BpmpSultra2026!#', { nip: '198501012010011001', username: 'admin' });
    assert.equal(res.valid, true);
  });

  await t.test('generateTempPassword generates unpredictable 10+ character complex password', () => {
    const p1 = generateTempPassword();
    const p2 = generateTempPassword();
    assert.ok(p1.length >= 10);
    assert.notEqual(p1, p2, 'Generated temporary passwords must be random');
    assert.match(p1, /[A-Z]/, 'Must include uppercase');
    assert.match(p1, /[a-z]/, 'Must include lowercase');
    assert.match(p1, /[0-9]/, 'Must include digits');
  });

  await t.test('multiEventService.recordAuditLog sanitizes password fields', async () => {
    const multiEventService = new MultiEventService(db);
    await multiEventService.init();

    const log = await multiEventService.recordAuditLog({
      userId: 'test_admin',
      aksi: 'TEST_AUDIT',
      entitas: 'user',
      entitasId: '1',
      sebelum: { password: 'oldPlainPassword', password_hash: 'oldHash', role: 'asn' },
      sesudah: { password_hash: 'newHash', tempPassword: 'tempPass123!', role: 'superadmin' }
    });

    const parsedSebelum = JSON.parse(log.sebelum_json);
    const parsedSesudah = JSON.parse(log.sesudah_json);

    assert.equal(parsedSebelum.password, undefined);
    assert.equal(parsedSebelum.password_hash, undefined);
    assert.equal(parsedSebelum.role, 'asn');

    assert.equal(parsedSesudah.password_hash, undefined);
    assert.equal(parsedSesudah.tempPassword, undefined);
    assert.equal(parsedSesudah.role, 'superadmin');
  });
});
