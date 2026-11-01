/**
 * Iluminación por estación y atmósfera (fases 6.6-6.7). La estación es la que muestra el
 * follaje (el ciclo de hojas independiente o la biológica): sol más alto y blanco en
 * verano, dorado y bajo en otoño, frío y débil en invierno; cielo y bruma acordes.
 * Solo presentación. Funciones puras de color y dirección para poder probarlas.
 */
export interface SeasonLook {
  /** Elevación (rad) y acimut (rad) del sol. */
  sunElevation: number;
  sunAzimuth: number;
  sunColor: [number, number, number];
  sunIntensity: number;
  skyColor: [number, number, number];
  groundColor: [number, number, number];
  hemiIntensity: number;
  background: [number, number, number];
}

type Key = { phase: number } & SeasonLook;

const hex = (h: number): [number, number, number] => [
  ((h >> 16) & 255) / 255,
  ((h >> 8) & 255) / 255,
  (h & 255) / 255,
];

/** Fotogramas clave del año (fase 0 = 1 de enero), con valores artísticos. */
const KEYS: Key[] = [
  {
    phase: 0.04, // invierno
    sunElevation: 0.42,
    sunAzimuth: 0.9,
    sunColor: hex(0xe6ecf6),
    sunIntensity: 1.7,
    skyColor: hex(0xe3e8ee),
    groundColor: hex(0x5e5a55),
    hemiIntensity: 1.0,
    background: hex(0xd5d8db),
  },
  {
    phase: 0.3, // primavera
    sunElevation: 0.85,
    sunAzimuth: 0.75,
    sunColor: hex(0xfaf6e6),
    sunIntensity: 2.3,
    skyColor: hex(0xf2f3ea),
    groundColor: hex(0x67604f),
    hemiIntensity: 1.1,
    background: hex(0xdcdcd2),
  },
  {
    phase: 0.55, // verano
    sunElevation: 1.05,
    sunAzimuth: 0.7,
    sunColor: hex(0xfff3e0),
    sunIntensity: 2.6,
    skyColor: hex(0xf4f1ea),
    groundColor: hex(0x6b5f52),
    hemiIntensity: 1.1,
    background: hex(0xd9d6cf),
  },
  {
    phase: 0.8, // otoño
    sunElevation: 0.62,
    sunAzimuth: 0.95,
    sunColor: hex(0xffd8a6),
    sunIntensity: 2.2,
    skyColor: hex(0xf1e6d6),
    groundColor: hex(0x6e5a44),
    hemiIntensity: 1.0,
    background: hex(0xdcd3c6),
  },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Aspecto de la escena en la fase del año `phase`, interpolado entre estaciones. */
export function seasonLook(phase: number): SeasonLook {
  const p = ((phase % 1) + 1) % 1;
  let i = KEYS.findIndex((k) => k.phase > p);
  if (i < 0) i = 0;
  const b = KEYS[i]!;
  const a = KEYS[(i + KEYS.length - 1) % KEYS.length]!;
  let span = b.phase - a.phase;
  let x = p - a.phase;
  if (span <= 0) span += 1;
  if (x < 0) x += 1;
  const t0 = Math.max(0, Math.min(1, x / span));
  const t = t0 * t0 * (3 - 2 * t0);
  return {
    sunElevation: lerp(a.sunElevation, b.sunElevation, t),
    sunAzimuth: lerp(a.sunAzimuth, b.sunAzimuth, t),
    sunColor: lerp3(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    skyColor: lerp3(a.skyColor, b.skyColor, t),
    groundColor: lerp3(a.groundColor, b.groundColor, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
    background: lerp3(a.background, b.background, t),
  };
}

/** Distancias de la niebla según la bruma [0, 1] (0 = aire limpio de estudio). */
export function fogRange(haze01: number): { near: number; far: number } {
  const h = Math.max(0, Math.min(1, haze01));
  return { near: lerp(3, 0.6, h), far: lerp(9, 3.2, h) };
}
