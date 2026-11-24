const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Root Kepegawaian ECDSA Keypair Storage (Persisted in server directory or generated deterministically)
const KEY_DIR = path.join(__dirname, '.keys');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'bpmp_ecdsa_private.pem');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'bpmp_ecdsa_public.pem');

let bpmpPrivateKey = null;
let bpmpPublicKey = null;

function initEcdsaKeys() {
  if (bpmpPrivateKey && bpmpPublicKey) return;

  try {
    if (!fs.existsSync(KEY_DIR)) {
      fs.mkdirSync(KEY_DIR, { recursive: true });
    }

    if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
      bpmpPrivateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
      bpmpPublicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
    } else {
      // Generate new EC prime256v1 (P-256) keypair
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });

      bpmpPrivateKey = privateKey;
      bpmpPublicKey = publicKey;

      try {
        fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, 'utf8');
        fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf8');
      } catch (wErr) {
        // Fallback in read-only environment like Vercel serverless
      }
    }
  } catch (err) {
    // Ephemeral fallback for serverless
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    bpmpPrivateKey = privateKey;
    bpmpPublicKey = publicKey;
  }
}

// Alfabet 32 karakter bersih tanpa karakter ambigu (tanpa 0, O, 1, I)
const CLEAN_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// Generate clean 12-char alphanumeric ID (Dicoding style e.g. 6RPNYVJL4Z2M)
function generateCertId(certNumber, nip) {
  const seed = `${String(certNumber).trim().toUpperCase()}|${String(nip).trim()}|BPMP-SULTRA-SALT-2026`;
  const hash = crypto.createHash('sha256').update(seed).digest('hex').toUpperCase();
  let certId = '';
  for (let i = 0; i < 12; i++) {
    const byte = parseInt(hash.substr(i * 2, 2), 16);
    certId += CLEAN_ALPHABET[byte % CLEAN_ALPHABET.length];
  }
  return certId;
}

/**
 * Generate 12-char cryptographically random unique certificate ID
 * Optional prefix (e.g. 'TEST' for dummy certificates)
 */
function generateRandomCertId(prefix = '') {
  const targetLen = 12;
  const cleanPrefix = String(prefix || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '');
  const neededRandom = Math.max(0, targetLen - cleanPrefix.length);
  const randomBytes = crypto.randomBytes(neededRandom);
  let id = cleanPrefix;
  for (let i = 0; i < neededRandom; i++) {
    id += CLEAN_ALPHABET[randomBytes[i] % CLEAN_ALPHABET.length];
  }
  return id;
}

/**
 * Validasi format ID sertifikat (12 karakter aman atau format uji coba resmi SUPA-)
 */
function isValidCertIdFormat(id) {
  if (!id || typeof id !== 'string') return false;
  const clean = id.trim().toUpperCase();
  // Standard 12-karakter clean Crockford Base32 (Dicoding-style)
  if (/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/.test(clean)) return true;
  // Format identitas pengujian sistem internal
  if (/^SUPA-[A-Z0-9-]+$/.test(clean)) return true;
  return false;
}

/**
 * URL basis resmi untuk QR (selalu menggunakan domain produksi bukan preview)
 */
function getProductionBaseUrl() {
  const envUrl = process.env.APP_BASE_URL || process.env.BASE_URL;
  if (envUrl && !envUrl.includes('vercel.app/preview') && !envUrl.includes('-git-')) {
    return envUrl.replace(/\/+$/, '');
  }
  return 'https://bpmp-senin-berseri.vercel.app';
}

/**
 * Sign certificate data using ECDSA-SHA256
 */
function signCertificate(certData) {
  initEcdsaKeys();

  const certNumber = String(certData.number || certData.certNumber || '').trim();
  const nip = String(certData.employeeNip || certData.nip || '').trim();
  const name = String(certData.employeeName || certData.name || '').trim();
  const eventTitle = String(certData.eventTitle || '').trim();
  const eventJp = String(certData.eventJp || '4').trim();
  const issuedAt = String(certData.issuedAt || new Date().toISOString()).trim();

  // Canonical string representation for cryptographic hashing
  const canonicalPayload = [
    `ISSUER: BALAI PENJAMINAN MUTU PENDIDIKAN PROVINSI SULAWESI TENGGARA`,
    `CERT_NO: ${certNumber}`,
    `RECIPIENT_NIP: ${nip}`,
    `RECIPIENT_NAME: ${name}`,
    `EVENT: ${eventTitle}`,
    `JP: ${eventJp}`,
    `ISSUED_AT: ${issuedAt}`
  ].join('\n');

  // SHA-256 Digest
  const sha256Digest = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

  // ECDSA Sign
  const signer = crypto.createSign('SHA256');
  signer.update(canonicalPayload);
  const signatureHex = signer.sign(bpmpPrivateKey, 'hex');

  const certId = generateCertId(certNumber, nip);

  return {
    certId,
    canonicalPayload,
    sha256Digest,
    signatureHex,
    algorithm: 'ECDSA (prime256v1 / NIST P-256) with SHA-256',
    curve: 'prime256v1 (secp256r1)',
    signerAuthority: 'Balai Penjaminan Mutu Pendidikan (BPMP) Provinsi Sulawesi Tenggara',
    publicKeyPem: bpmpPublicKey,
    signedAt: issuedAt,
    status: 'VALID & TERVERIFIKASI'
  };
}

/**
 * Verify ECDSA signature of certificate
 */
function verifyCertificateSignature(canonicalPayload, signatureHex) {
  initEcdsaKeys();
  try {
    const verifier = crypto.createVerify('SHA256');
    verifier.update(canonicalPayload);
    return verifier.verify(bpmpPublicKey, signatureHex, 'hex');
  } catch (err) {
    return false;
  }
}

module.exports = {
  signCertificate,
  verifyCertificateSignature,
  generateCertId,
  generateRandomCertId,
  isValidCertIdFormat,
  getProductionBaseUrl,
  CLEAN_ALPHABET,
  getPublicKeyPem: () => { initEcdsaKeys(); return bpmpPublicKey; }
};
