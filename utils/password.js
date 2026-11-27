/**
 * BPMP Senin Berseri — Password Hashing & Security Utilities
 * Standar keamanan menggunakan bcrypt (cost 12) murni JavaScript (kompatibel penuh dengan Vercel & Node.js).
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BCRYPT_ROUNDS = 12;

/**
 * Memeriksa apakah sebuah string sudah merupakan hash bcrypt yang valid
 */
function isBcryptHash(str) {
  if (typeof str !== 'string') return false;
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(str);
}

/**
 * Hash password menggunakan bcrypt dengan cost 12
 * @param {string} password 
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  if (!password) {
    throw new Error('Password tidak boleh kosong untuk di-hash.');
  }
  const cleanPass = String(password).trim();
  if (isBcryptHash(cleanPass)) {
    return cleanPass; // Idempoten: jika sudah di-hash, jangan re-hash
  }
  return await bcrypt.hash(cleanPass, BCRYPT_ROUNDS);
}

/**
 * Sinkronus hash jika dibutuhkan dalam inisialisasi / migration cepat
 */
function hashPasswordSync(password) {
  if (!password) {
    throw new Error('Password tidak boleh kosong untuk di-hash.');
  }
  const cleanPass = String(password).trim();
  if (isBcryptHash(cleanPass)) {
    return cleanPass;
  }
  return bcrypt.hashSync(cleanPass, BCRYPT_ROUNDS);
}

/**
 * Verifikasi password menggunakan library bcrypt
 * @param {string} password - Password polos yang dimasukkan pengguna
 * @param {string} storedHash - Hash yang tersimpan di kolom password_hash
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const cleanPass = String(password).trim();
  const cleanHash = String(storedHash).trim();

  // 1. Jika tersimpan dalam format bcrypt standar
  if (isBcryptHash(cleanHash)) {
    return await bcrypt.compare(cleanPass, cleanHash);
  }

  // 2. Legacy fallback PBKDF2 (salt:hash format lama) untuk transisi mulus sebelum migrasi
  if (cleanHash.includes(':')) {
    try {
      const [salt, key] = cleanHash.split(':');
      const testHash = crypto.pbkdf2Sync(cleanPass, salt, 10000, 64, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(key, 'hex'));
    } catch (_) {
      return false;
    }
  }

  // 3. Legacy fallback plain text (hanya untuk transisi pra-migrasi)
  return cleanPass === cleanHash;
}

/**
 * Validasi kekuatan password sesuai aturan:
 * - Minimal 8 karakter
 * - Tolak password yang sama dengan NIP
 * - Tolak password yang sama dengan tanggal lahir (dari NIP atau konteks)
 * - Tolak password yang sama dengan username
 * @param {string} password 
 * @param {object} userContext - { nip, username, birthdate }
 * @returns {{ valid: boolean, message?: string }}
 */
function validatePassword(password, userContext = {}) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password wajib diisi.' };
  }

  const cleanPass = password.trim();

  // 1. Minimal 8 karakter
  if (cleanPass.length < 8) {
    return { valid: false, message: 'Password minimal harus 8 karakter.' };
  }

  const cleanNip = String(userContext.nip || '').trim();
  const cleanUsername = String(userContext.username || '').trim();

  // 2. Tolak jika sama dengan NIP
  if (cleanNip && cleanPass === cleanNip) {
    return { valid: false, message: 'Password tidak boleh sama dengan NIP.' };
  }

  // 3. Tolak jika sama dengan username
  if (cleanUsername && cleanPass.toLowerCase() === cleanUsername.toLowerCase()) {
    return { valid: false, message: 'Password tidak boleh sama dengan Username.' };
  }

  // 4. Tolak jika sama dengan tanggal lahir
  // Standar NIP BKN 18-digit: 8 digit pertama adalah YYYYMMDD (Tahun, Bulan, Tanggal lahir)
  const birthDatesToCheck = new Set();

  if (cleanNip.length >= 8 && /^\d+$/.test(cleanNip)) {
    const yyyymmdd = cleanNip.substring(0, 8);
    const yyyy = yyyymmdd.substring(0, 4);
    const mm = yyyymmdd.substring(4, 6);
    const dd = yyyymmdd.substring(6, 8);

    birthDatesToCheck.add(yyyymmdd); // 19950823
    birthDatesToCheck.add(`${dd}${mm}${yyyy}`); // 23081995
    birthDatesToCheck.add(`${yyyy}-${mm}-${dd}`); // 1995-08-23
    birthDatesToCheck.add(`${dd}-${mm}-${yyyy}`); // 23-08-1995
    birthDatesToCheck.add(`${yyyy}/${mm}/${dd}`); // 1995/08/23
    birthDatesToCheck.add(`${dd}/${mm}/${yyyy}`); // 23/08/1995
  }

  // Konteks tanggal lahir eksplisit jika ada
  if (userContext.birthdate || userContext.tgl_lahir || userContext.tanggal_lahir) {
    const explicitDate = String(userContext.birthdate || userContext.tgl_lahir || userContext.tanggal_lahir).trim();
    birthDatesToCheck.add(explicitDate);
    const numericOnly = explicitDate.replace(/\D/g, '');
    if (numericOnly.length === 8) {
      birthDatesToCheck.add(numericOnly);
    }
  }

  for (const bDate of birthDatesToCheck) {
    if (bDate && cleanPass === bDate) {
      return { valid: false, message: 'Password tidak boleh menggunakan tanggal lahir.' };
    }
  }

  return { valid: true };
}

/**
 * Menghasilkan password sementara acak 10-12 karakter
 * Memadukan huruf kapital, huruf kecil, angka, dan karakter khusus
 */
function generateTempPassword() {
  const lettersUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Tanpa I, O ambigu
  const lettersLower = 'abcdefghijkmnpqrstuvwxyz'; // Tanpa l, o ambigu
  const digits = '23456789'; // Tanpa 0, 1 ambigu
  const symbols = '!@#$%^&*';

  let pass = '';
  // Pastikan minimal satu dari setiap jenis
  pass += lettersUpper[crypto.randomInt(lettersUpper.length)];
  pass += lettersLower[crypto.randomInt(lettersLower.length)];
  pass += digits[crypto.randomInt(digits.length)];
  pass += symbols[crypto.randomInt(symbols.length)];

  const allChars = lettersUpper + lettersLower + digits + symbols;
  for (let i = 0; i < 6; i++) {
    pass += allChars[crypto.randomInt(allChars.length)];
  }

  // Shuffle hasil agar urutan acak
  return pass.split('').sort(() => 0.5 - Math.random()).join('');
}

module.exports = {
  BCRYPT_ROUNDS,
  isBcryptHash,
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  validatePassword,
  generateTempPassword
};
