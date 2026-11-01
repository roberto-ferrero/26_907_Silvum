/**
 * Presets de especie v1 (fases 4.2-4.4): abeto, roble y almendro.
 *
 * Valores ILUSTRATIVOS, no calibrados: tamaños a escala de maceta (artísticos) y fechas
 * orientativas de un clima templado del hemisferio norte (fase 0 = 1 de enero).
 * Las referencias botánicas solo guían el orden y el carácter de cada proceso.
 */
import type { SpeciesPreset } from '../sim/species.ts';

/**
 * Abeto (Abies alba). Cónica, perenne, acículas planas en dos filas (pectinadas) sobre las
 * ramas y en espiral en el líder. Crecimiento rítmico: un brote al año que termina en un
 * piso de ramas (cohorte del arquetipo cónico). Brota tarde (mayo). Acículas de 7-11 años.
 */
const ABIES_ALBA: SpeciesPreset = {
  id: 'abies-alba',
  name: 'Abeto',
  taxon: 'Abies alba',
  status: 'illustrative-not-calibrated',
  description: 'Conífera cónica perenne con pisos de ramas y acículas pectinadas.',
  archetypeId: 'conical-conifer',
  scale: { maxMetamersPerShoot: 6, apicalInhibition: 0.25, maturityYears: 45 },
  phyllotaxis: { mode: 'spiral', divergenceDeg: 137.5 },
  morphology: { inclinationOffsetDeg: { branch: 4 }, branchingFactor: 1 },
  phenology: {
    budRelease: [0.36, 0.42],
    elongation: [0.37, 0.52],
    radialGrowth: [0.35, 0.72],
    survivalAt: 0.8,
    leafExpansionYears: 0.07,
    senescence: [0.62, 0.8],
  },
  leaves: {
    form: {
      shape: 'needle',
      lengthM: 0.012,
      widthRatio: 0.11,
      lobes: 0,
      lobeDepth: 0,
      teeth: 0,
      toothDepth: 0,
      veinPairs: 0,
      foldDeg: 0,
      curl: 0.12,
      petioleRatio: 0,
    },
    habit: 'evergreen',
    perMetamer: 2,
    insertionDeg: 62,
    arrangement: 'pectinate',
    shortShoots: null,
    lifespanYears: 8,
    lifespanJitter: 0.25,
    senescenceSpreadYears: 0.5,
    marcescence: 0,
    backgroundDropPerYear: 0.02,
    windFragility: 0.25,
    shadeWeight: 0.14,
    sunRedness: 0,
    colors: {
      young: '#9cc25c',
      mature: '#2c4a2a',
      senescent: ['#b9a648', '#a8783c'],
      dead: '#7a5634',
    },
  },
  flowering: null,
  fruiting: null,
};

/**
 * Roble común (Quercus robur). Copa amplia con ejes estructurales que compiten (control
 * apical débil), caduco, hoja lobulada casi sésil con aurículas. Color otoñal ocre a
 * marrón rojizo; marcescencia parcial en ejemplares jóvenes (hojas secas hasta la
 * brotación). Flores femeninas discretas en el brote del año; bellotas en otoño.
 */
const QUERCUS_ROBUR: SpeciesPreset = {
  id: 'quercus-robur',
  name: 'Roble',
  taxon: 'Quercus robur',
  status: 'illustrative-not-calibrated',
  description: 'Caducifolio de copa amplia, hoja lobulada y bellotas en otoño.',
  archetypeId: 'broad-crown-broadleaf',
  scale: { apicalInhibition: 0.04, budViabilityYears: 6, maturityYears: 45 },
  phyllotaxis: { mode: 'spiral', divergenceDeg: 144 },
  morphology: { inclinationOffsetDeg: { scaffold: 4, branch: 3 }, branchingFactor: 1.05 },
  phenology: {
    budRelease: [0.28, 0.36],
    elongation: [0.29, 0.47],
    radialGrowth: [0.27, 0.75],
    survivalAt: 0.8,
    leafExpansionYears: 0.06,
    senescence: [0.77, 0.87],
  },
  leaves: {
    form: {
      shape: 'lobed',
      lengthM: 0.032,
      widthRatio: 0.56,
      lobes: 5,
      lobeDepth: 0.42,
      teeth: 0,
      toothDepth: 0,
      veinPairs: 5,
      foldDeg: 10,
      curl: 0.12,
      petioleRatio: 0.05,
    },
    habit: 'deciduous',
    perMetamer: 1,
    insertionDeg: 48,
    arrangement: 'node',
    shortShoots: { probability: 0.5, leaves: 4 },
    lifespanYears: 1,
    lifespanJitter: 0,
    senescenceSpreadYears: 0.06,
    marcescence: 0.3,
    backgroundDropPerYear: 0.1,
    windFragility: 0.9,
    shadeWeight: 0.25,
    sunRedness: 0.45,
    colors: {
      young: '#b2b55a',
      mature: '#4c6a2d',
      senescent: ['#b89a3c', '#a9682f', '#8c4c2a'],
      dead: '#7d5c3b',
    },
  },
  flowering: {
    position: 'currentShoot',
    inductionPhase: 0.34,
    bloom: [0.34, 0.39],
    flowerLifeYears: 0.03,
    firstFloweringYear: 8,
    intensity: 0.08,
    maxPerNode: 2,
    petals: 0,
    sizeM: 0.003,
    colors: { bud: '#8f9a4c', petal: '#a6a85a', center: '#7d6a3a' },
  },
  fruiting: {
    kind: 'acorn',
    setProbability: 0.45,
    earlyDrop: { phase: 0.45, probability: 0.35 },
    ripenPhase: 0.72,
    drop: [0.73, 0.85],
    massKg: 0.004,
    sizeM: 0.014,
    colors: { young: '#8ea24c', ripe: '#8a6232' },
  },
};

/**
 * Almendro (Prunus dulcis). Caduco de copa abierta en vaso; flor blanca rosada a finales
 * del invierno, ANTES de la brotación, sobre ramos del año anterior. Hoja lanceolada
 * aserrada. Drupa verde aterciopelada que madura y abre el pericarpio en verano.
 */
const PRUNUS_DULCIS: SpeciesPreset = {
  id: 'prunus-dulcis',
  name: 'Almendro',
  taxon: 'Prunus dulcis',
  status: 'illustrative-not-calibrated',
  description: 'Caducifolio en vaso, floración invernal antes de la hoja y almendras en verano.',
  archetypeId: 'broad-crown-broadleaf',
  scale: { apicalInhibition: 0.08, budViabilityYears: 4, maturityYears: 35 },
  phyllotaxis: { mode: 'spiral', divergenceDeg: 144 },
  morphology: { inclinationOffsetDeg: { scaffold: -12, branch: -6 }, branchingFactor: 0.95 },
  phenology: {
    budRelease: [0.19, 0.28],
    elongation: [0.2, 0.45],
    radialGrowth: [0.2, 0.72],
    survivalAt: 0.8,
    leafExpansionYears: 0.06,
    senescence: [0.74, 0.84],
  },
  leaves: {
    form: {
      shape: 'lanceolate',
      lengthM: 0.03,
      widthRatio: 0.26,
      lobes: 0,
      lobeDepth: 0,
      teeth: 14,
      toothDepth: 0.04,
      veinPairs: 7,
      foldDeg: 18,
      curl: 0.2,
      petioleRatio: 0.18,
    },
    habit: 'deciduous',
    perMetamer: 1,
    insertionDeg: 45,
    arrangement: 'node',
    shortShoots: { probability: 0.55, leaves: 4 },
    lifespanYears: 1,
    lifespanJitter: 0,
    senescenceSpreadYears: 0.05,
    marcescence: 0,
    backgroundDropPerYear: 0.14,
    windFragility: 1.1,
    shadeWeight: 0.22,
    sunRedness: 0.2,
    colors: {
      young: '#b6cf6c',
      mature: '#5b7c3c',
      senescent: ['#d2b84a', '#c9923e'],
      dead: '#8e6c42',
    },
  },
  flowering: {
    position: 'previousShoot',
    inductionPhase: 0.55,
    bloom: [0.09, 0.17],
    flowerLifeYears: 0.03,
    firstFloweringYear: 3,
    intensity: 0.55,
    maxPerNode: 2,
    petals: 5,
    sizeM: 0.016,
    colors: { bud: '#d98ea3', petal: '#f7e9ec', center: '#c4627e' },
  },
  fruiting: {
    kind: 'drupe',
    setProbability: 0.35,
    earlyDrop: { phase: 0.4, probability: 0.3 },
    ripenPhase: 0.6,
    drop: [0.62, 0.74],
    massKg: 0.006,
    sizeM: 0.02,
    colors: { young: '#7f9b4b', ripe: '#a68a5f' },
  },
};

export const SPECIES_PRESETS: readonly SpeciesPreset[] = [ABIES_ALBA, QUERCUS_ROBUR, PRUNUS_DULCIS];
