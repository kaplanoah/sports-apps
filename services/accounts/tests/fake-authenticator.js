// A made-up passkey that answers as a phone's does: an ES256 key, attestation "none", and the
// user present and verified, so a test can register and sign in without a browser.
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

const encoder = new TextEncoder();

/** @param {Uint8Array[]} parts */
const joinBytes = (parts) => {
  const joined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
};

/** @param {string} text */
const hashText = async (text) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));

const writeCounter = (counter) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, counter);
  return bytes;
};

const encodeClientData = (type, challenge, origin) =>
  encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

// WebCrypto signs as r and s side by side, and WebAuthn wants them as a DER sequence.
/** @param {Uint8Array} raw */
function convertSignatureToDer(raw) {
  const encodeInteger = (bytes) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
    const trimmed = bytes.slice(start);
    const padded = trimmed[0] & 0x80 ? joinBytes([new Uint8Array([0]), trimmed]) : trimmed;
    return joinBytes([new Uint8Array([0x02, padded.length]), padded]);
  };
  const body = joinBytes([encodeInteger(raw.slice(0, 32)), encodeInteger(raw.slice(32))]);
  return joinBytes([new Uint8Array([0x30, body.length]), body]);
}

// User present, user verified, and, on registration, attested credential data.
const REGISTER_FLAGS = 0x45;
const SIGN_IN_FLAGS = 0x05;

/** @param {{ rpId: string, origin: string }} site */
export async function createFakeAuthenticator({ rpId, origin }) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const { x, y } = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const credentialId = crypto.getRandomValues(new Uint8Array(16));
  const id = isoBase64URL.fromBuffer(credentialId);
  let counter = 0;
  let userHandle = null;

  const coseKey = isoCBOR.encode(
    new Map(
      /** @type {[number, number | Uint8Array][]} */ ([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, isoBase64URL.toBuffer(x)],
        [-3, isoBase64URL.toBuffer(y)],
      ]),
    ),
  );

  /** @param {{ challenge: string, user: { id: string } }} options */
  async function register(options) {
    userHandle = options.user.id;
    counter += 1;
    const credentialLength = new Uint8Array([0, credentialId.length]);
    const authData = joinBytes([
      await hashText(rpId),
      new Uint8Array([REGISTER_FLAGS]),
      writeCounter(counter),
      new Uint8Array(16),
      credentialLength,
      credentialId,
      coseKey,
    ]);
    const attestationObject = isoCBOR.encode(
      new Map(
        /** @type {[string, string | Map<never, never> | Uint8Array][]} */ ([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      ),
    );
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(
          encodeClientData("webauthn.create", options.challenge, origin),
        ),
        attestationObject: isoBase64URL.fromBuffer(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  /** @param {{ challenge: string }} options */
  async function signIn(options) {
    counter += 1;
    const clientData = encodeClientData("webauthn.get", options.challenge, origin);
    const authenticatorData = joinBytes([
      await hashText(rpId),
      new Uint8Array([SIGN_IN_FLAGS]),
      writeCounter(counter),
    ]);
    const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientData));
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      joinBytes([authenticatorData, clientDataHash]),
    );
    return {
      id,
      rawId: id,
      type: "public-key",
      response: {
        clientDataJSON: isoBase64URL.fromBuffer(clientData),
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(convertSignatureToDer(new Uint8Array(signature))),
        userHandle,
      },
      clientExtensionResults: {},
    };
  }

  return { id, register, signIn };
}
