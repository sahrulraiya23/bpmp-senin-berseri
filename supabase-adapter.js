/**
 * Supabase Database & Storage Adapter
 * Menyediakan integrasi PostgreSQL dan Cloud Storage untuk aplikasi
 * BPMP Senin Berseri di Vercel Production.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false }
    });
    console.log('✅ Supabase Client berhasil diinisialisasi:', SUPABASE_URL);
  } catch (err) {
    console.warn('⚠️ Gagal inisialisasi Supabase client:', err.message);
  }
}

function isSupabaseAvailable() {
  return Boolean(supabase);
}

// ==============================================================
// FORMATTER HELPERS
// ==============================================================
function formatSupabaseEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    nip: row.nip,
    name: row.name,
    password: row.password || 'Bpmp2026!',
    panggol: row.panggol || '',
    jabatan: row.jabatan || '',
    instansi: row.instansi || 'BPMP Provinsi Sulawesi Tenggara',
    pendidikan: row.pendidikan || '',
    eventId: row.event_id || null,
    eventTitle: row.event_title || null,
    attended: Boolean(row.attended),
    attendedAt: row.attended_at || null,
    accumulatedJp: Number(row.accumulated_jp) || 0,
    lpti: {
      status: row.lpti_status || 'none',
      fileName: row.lpti_file_name || null,
      fileOriginalName: row.lpti_file_original_name || null,
      filePath: row.lpti_file_path || null,
      fileSize: row.lpti_file_size || null,
      uploadedAt: row.lpti_uploaded_at || null,
      revisionNote: row.lpti_revision_note || ''
    },
    certificate: row.certificate_number ? {
      number: row.certificate_number,
      issuedAt: row.certificate_issued_at,
      verifier: row.certificate_verifier || 'Junaiddin Pagala, ST, M.T.',
      verifierTitle: row.certificate_verifier_title || 'Kepala Balai Penjaminan Mutu Pendidikan Sultra'
    } : null
  };
}

function formatSupabaseEvent(row) {
  if (!row) return null;
  const defaultCertSettings = {
    prefix: '800.1.3/SERT-LPTI/2026',
    nomorYRatio: 0.72,
    namaYRatio: 0.50,
    namaFontSize: 26,
    nomorFontSize: 11,
    showUnderline: true,
    showQr: true
  };

  return {
    id: row.id,
    title: row.title,
    jp: row.jp || 32,
    category: row.category || 'Teknis',
    schedule: row.schedule || '',
    location: row.location || 'Auditorium BPMP Sultra',
    organizer: row.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
    active: Boolean(row.active),
    status: row.status || (row.active ? 'active' : 'completed'),
    completedAt: row.completed_at || null,
    certificateTemplate: row.certificate_template || null,
    certSettings: row.cert_settings ? { ...defaultCertSettings, ...row.cert_settings } : defaultCertSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ==============================================================
// EMPLOYEES CRUD
// ==============================================================
async function getAllEmployees() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('id', { ascending: true });

  if (error) {
    console.error('Supabase getAllEmployees error:', error.message);
    return [];
  }
  return (data || []).map(formatSupabaseEmployee);
}

async function getEmployeeByIdOrNip(idOrNip) {
  if (!idOrNip) return null;
  const clean = String(idOrNip).trim();

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .or(`id.eq."${clean}",nip.eq."${clean}"`)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return formatSupabaseEmployee(data);
}

async function markEmployeeAttended(id, eventId, eventTitle) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('employees')
    .update({
      attended: true,
      attended_at: now,
      event_id: eventId || null,
      event_title: eventTitle || null,
      updated_at: now
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Supabase markEmployeeAttended error:', error.message);
    return null;
  }
  return formatSupabaseEmployee(data);
}

async function updateEmployeeLpti(id, lptiData) {
  const now = new Date().toISOString();
  const clean = String(id).trim();

  // Ambil pegawai dulu untuk memastikan id/nip
  const { data: existing } = await supabase
    .from('employees')
    .select('id')
    .or(`id.eq."${clean}",nip.eq."${clean}"`)
    .limit(1)
    .maybeSingle();

  if (!existing) return null;

  const { data, error } = await supabase
    .from('employees')
    .update({
      lpti_status: 'pending',
      lpti_file_name: lptiData.fileName,
      lpti_file_original_name: lptiData.fileOriginalName,
      lpti_file_path: lptiData.filePath,
      lpti_file_size: lptiData.fileSize,
      lpti_uploaded_at: lptiData.uploadedAt || now,
      lpti_revision_note: '',
      updated_at: now
    })
    .eq('id', existing.id)
    .select()
    .single();

  if (error) {
    console.error('Supabase updateEmployeeLpti error:', error.message);
    return null;
  }
  return formatSupabaseEmployee(data);
}

async function verifyEmployeeLpti(id, certData = null, revisionNote = null) {
  const now = new Date().toISOString();
  const clean = String(id).trim();

  const { data: existing } = await supabase
    .from('employees')
    .select('id, accumulated_jp')
    .or(`id.eq."${clean}",nip.eq."${clean}"`)
    .limit(1)
    .maybeSingle();

  if (!existing) return null;

  let updatePayload = { updated_at: now };

  if (certData) {
    const addJp = parseInt(certData.eventJp, 10) || 32;
    updatePayload.lpti_status = 'approved';
    updatePayload.lpti_revision_note = '';
    updatePayload.certificate_number = certData.number;
    updatePayload.certificate_issued_at = certData.issuedAt;
    updatePayload.certificate_verifier = certData.verifier;
    updatePayload.certificate_verifier_title = certData.verifierTitle;
    updatePayload.accumulated_jp = (Number(existing.accumulated_jp) || 0) + addJp;
  } else if (revisionNote !== null) {
    updatePayload.lpti_status = 'revision';
    updatePayload.lpti_revision_note = revisionNote;
    updatePayload.certificate_number = null;
    updatePayload.certificate_issued_at = null;
    updatePayload.certificate_verifier = null;
    updatePayload.certificate_verifier_title = null;
  }

  const { data, error } = await supabase
    .from('employees')
    .update(updatePayload)
    .eq('id', existing.id)
    .select()
    .single();

  if (error) {
    console.error('Supabase verifyEmployeeLpti error:', error.message);
    return null;
  }
  return formatSupabaseEmployee(data);
}

// ==============================================================
// EVENTS CRUD
// ==============================================================
async function getAllEvents() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase getAllEvents error:', error.message);
    return [];
  }
  return (data || []).map(formatSupabaseEvent);
}

async function getActiveEvent() {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    // Fallback: ambil event paling baru jika belum ada yang active
    const fallback = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return fallback.data ? formatSupabaseEvent(fallback.data) : null;
  }
  return formatSupabaseEvent(data);
}

async function getEventById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return formatSupabaseEvent(data);
}

async function saveEvent(eventData, isNew = false) {
  const now = new Date().toISOString();
  const shouldBeNew = Boolean(isNew || eventData.isNew || !eventData.id || eventData.id === 'new');

  let eventId = eventData.id;
  if (shouldBeNew || !eventId || eventId === 'new') {
    const { data: allEvts } = await supabase.from('events').select('id');
    let maxSeq = 0;
    (allEvts || []).forEach(r => {
      const match = (r.id || '').match(/EVT-(\d{4})-(\d+)/);
      if (match) {
        const seq = parseInt(match[2], 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
    eventId = `EVT-${new Date().getFullYear()}-${String(maxSeq + 1).padStart(3, '0')}`;
  }

  const record = {
    id: eventId,
    title: eventData.title,
    jp: parseInt(eventData.jp, 10) || 32,
    category: eventData.category || 'Teknis & Manajerial Kepegawaian',
    schedule: eventData.schedule || 'Jadwal Ditentukan',
    location: eventData.location || 'Auditorium BPMP Sultra & Hybrid',
    organizer: eventData.organizer || 'Balai Penjaminan Mutu Pendidikan Provinsi Sulawesi Tenggara',
    active: true,
    status: 'active',
    updated_at: now
  };

  if (shouldBeNew) {
    record.created_at = now;
    record.certificate_template = null;
    record.cert_settings = {
      prefix: '800.1.3/SERT-LPTI/2026',
      nomorYRatio: 0.72,
      namaYRatio: 0.50,
      namaFontSize: 26,
      nomorFontSize: 11,
      showUnderline: true,
      showQr: true
    };
  }

  // Nonaktifkan event lain terlebih dahulu
  await supabase.from('events').update({ active: false, updated_at: now }).neq('id', eventId);

  const { data, error } = await supabase
    .from('events')
    .upsert(record, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('Supabase saveEvent error:', error.message);
    throw new Error(error.message);
  }
  return formatSupabaseEvent(data);
}

async function activateEventById(eventId) {
  const now = new Date().toISOString();
  // Matikan event lain
  await supabase.from('events').update({ active: false, updated_at: now }).neq('id', eventId);

  const { data, error } = await supabase
    .from('events')
    .update({ active: true, status: 'active', updated_at: now })
    .eq('id', eventId)
    .select()
    .single();

  if (error) {
    console.error('Supabase activateEventById error:', error.message);
    return null;
  }
  return formatSupabaseEvent(data);
}

async function completeEventById(eventId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('events')
    .update({ active: false, status: 'completed', completed_at: now, updated_at: now })
    .eq('id', eventId)
    .select()
    .single();

  if (error) {
    console.error('Supabase completeEventById error:', error.message);
    return null;
  }
  return formatSupabaseEvent(data);
}

async function deleteEventById(eventId) {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId);

  if (error) {
    console.error('Supabase deleteEventById error:', error.message);
    return false;
  }

  // Jika event aktif terhapus, aktifkan event terbaru lainnya jika ada
  const { data: latest } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest) {
    await supabase.from('events').update({ active: true }).eq('id', latest.id);
  }
  return true;
}

async function updateEventTemplate(eventId, templateObj) {
  const now = new Date().toISOString();
  let query = supabase.from('events').update({
    certificate_template: templateObj,
    updated_at: now
  });

  if (eventId) {
    query = query.eq('id', eventId);
  } else {
    query = query.eq('active', true);
  }

  const { data, error } = await query.select().maybeSingle();
  if (error) {
    console.error('Supabase updateEventTemplate error:', error.message);
  }
  return data ? formatSupabaseEvent(data) : await getActiveEvent();
}

async function updateEventCertSettings(eventId, certSettings) {
  const now = new Date().toISOString();
  let query = supabase.from('events').update({
    cert_settings: certSettings,
    updated_at: now
  });

  if (eventId) {
    query = query.eq('id', eventId);
  } else {
    query = query.eq('active', true);
  }

  const { data, error } = await query.select().maybeSingle();
  if (error) {
    console.error('Supabase updateEventCertSettings error:', error.message);
  }
  return data ? formatSupabaseEvent(data) : await getActiveEvent();
}

// ==============================================================
// ADMIN AUTH
// ==============================================================
async function verifyAdminCredentials(username, password) {
  const { data, error } = await supabase
    .from('admins')
    .select('*')
    .eq('username', username)
    .eq('password', password)
    .maybeSingle();

  if (error || !data) return null;
  return {
    id: data.id,
    username: data.username,
    name: data.name,
    role: data.role || 'superadmin'
  };
}

// ==============================================================
// STORAGE UPLOAD (SUPABASE BUCKET)
// ==============================================================
async function uploadToStorage(bucketName, fileName, fileBuffer, contentType) {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(fileName, fileBuffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: true
      });

    if (error) {
      console.warn(`Supabase Storage upload (${bucketName}) error:`, error.message);
      return null;
    }

    const { data: pubData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    return pubData?.publicUrl || null;
  } catch (err) {
    console.warn(`Supabase Storage upload exception (${bucketName}):`, err.message);
    return null;
  }
}

// ==============================================================
// RESET TESTING DATA
// ==============================================================
async function resetTestingData() {
  const now = new Date().toISOString();
  // 1. Reset kehadiran & LPTI pegawai
  await supabase
    .from('employees')
    .update({
      attended: false,
      attended_at: null,
      event_id: null,
      event_title: null,
      lpti_status: 'none',
      lpti_file_name: null,
      lpti_file_original_name: null,
      lpti_file_path: null,
      lpti_file_size: null,
      lpti_uploaded_at: null,
      lpti_revision_note: null,
      certificate_number: null,
      certificate_issued_at: null,
      certificate_verifier: null,
      certificate_verifier_title: null,
      updated_at: now
    })
    .neq('id', '');

  return { success: true };
}

module.exports = {
  isSupabaseAvailable,
  getAllEmployees,
  getEmployeeByIdOrNip,
  markEmployeeAttended,
  updateEmployeeLpti,
  verifyEmployeeLpti,
  saveEmployeeLpti: updateEmployeeLpti,
  updateLptiStatus: verifyEmployeeLpti,
  getAllEvents,
  getActiveEvent,
  getEventById,
  saveEvent,
  activateEventById,
  completeEventById,
  deleteEventById,
  updateEventTemplate,
  updateEventCertSettings,
  verifyAdminCredentials,
  uploadToStorage,
  resetTestingData
};
