function validateUserRegistration({ name, email, password, confirmPassword }) {
  if (!name || !String(name).trim()) {
    return { ok: false, error: 'Informe seu nome.' };
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const hasValidEmail = /^\S+@\S+\.\S+$/.test(normalizedEmail);
  if (!hasValidEmail) {
    return { ok: false, error: 'Informe um e-mail válido.' };
  }

  if (String(password || '').length < 6) {
    return { ok: false, error: 'A senha deve ter 6 ou mais caracteres.' };
  }

  if (String(password) !== String(confirmPassword ?? '')) {
    return { ok: false, error: 'As senhas não coincidem.' };
  }

  return { ok: true, email: normalizedEmail };
}

function stampEditor(record, userName) {
  if (!record || !userName) return record;

  return {
    ...record,
    updatedBy: String(userName).trim(),
    updatedAt: new Date().toISOString()
  };
}

module.exports = { validateUserRegistration, stampEditor };
