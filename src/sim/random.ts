/**
 * Aleatoriedad reproducible por identidad de evento.
 *
 * Cada muestra depende solo de (semilla, órgano, evento, canal), nunca del orden de
 * recorrido ni del número de fotogramas. Hash de 32 bits no criptográfico.
 * Los identificadores de órganos se asignan en CPU en orden estable.
 */
function uint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${label} debe ser un uint32`);
  }
  return value;
}

function mix(value: number): number {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function eventHash(seed: number, organId: number, eventId: number, channel = 0): number {
  let x = mix(uint32(seed, 'seed') ^ 0x9e3779b9);
  x = mix(x ^ uint32(organId, 'organId'));
  x = mix(x ^ uint32(eventId, 'eventId'));
  return mix(x ^ uint32(channel, 'channel'));
}

/** Muestra uniforme en el intervalo abierto (0, 1), apta para -ln(U). */
export function eventUniform(seed: number, organId: number, eventId: number, channel = 0): number {
  return (eventHash(seed, organId, eventId, channel) + 0.5) / 4294967296;
}

/** Muestra uniforme en (-1, 1). */
export function eventSigned(seed: number, organId: number, eventId: number, channel = 0): number {
  return eventUniform(seed, organId, eventId, channel) * 2 - 1;
}

/**
 * Ruido 1D suave y persistente: interpolación de valores por identidad en enteros.
 * Sirve para variaciones correlacionadas a lo largo de un eje (no ruido por muestra).
 */
export function smoothNoise1D(seed: number, organId: number, x: number, channel = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = eventSigned(seed, organId, i >>> 0, channel);
  const b = eventSigned(seed, organId, (i + 1) >>> 0, channel);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

/** Canales con nombre para no reutilizar muestras entre procesos distintos. */
export const Channel = Object.freeze({
  activationThreshold: 1,
  mortalityThreshold: 2,
  azimuthJitter: 3,
  headingNoiseX: 4,
  headingNoiseZ: 5,
  lengthJitter: 6,
  phyllotaxisStart: 7,
  terminalAbortion: 8,
  leaderLoss: 9,
  interiorThinning: 10,
});
