const encoder = new TextEncoder();

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const subtle = () => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('WebCrypto is not available for local auth');
  }
  return crypto.subtle;
};

export const generateSalt = () => {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return toBase64(salt.buffer);
};

export const hashPassword = async (password: string, saltBase64?: string) => {
  const saltBytes = saltBase64 ? fromBase64(saltBase64) : fromBase64(generateSalt());
  const key = await subtle().importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derivedBits = await subtle().deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return {
    hash: toBase64(derivedBits),
    salt: toBase64(saltBytes.buffer),
  };
};

export const verifyPassword = async (password: string, hash: string, salt: string) => {
  const next = await hashPassword(password, salt);
  return next.hash === hash;
};

export const generateLocalToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return toBase64(bytes.buffer);
};

