# Silvum

Simulador 3D del crecimiento, la ramificación y la morfología de árboles en el navegador,
con three.js y WebGPU. El árbol crece libre y se presenta en una maceta de estilo bonsái.

El plan por fases y su estado están en [docs/PLAN.md](docs/PLAN.md).

## Requisitos

- Node.js 22.12 o superior
- Navegador de escritorio con WebGPU (Chrome o Edge recientes). Si no hay WebGPU, la app
  cae a WebGL 2 y lo avisa.

## Scripts

| Comando             | Qué hace                                       |
| ------------------- | ---------------------------------------------- |
| `npm install`       | Instala dependencias                           |
| `npm run dev`       | Servidor de desarrollo con recarga en caliente |
| `npm run build`     | Comprueba tipos y genera `dist/`               |
| `npm run preview`   | Sirve la build de producción                   |
| `npm test`          | Tests (Vitest)                                 |
| `npm run typecheck` | Comprobación de tipos estricta                 |
| `npm run lint`      | ESLint                                         |
| `npm run format`    | Formatea con Prettier                          |

Parámetros de URL útiles para depurar:

| Parámetro                    | Efecto                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `?backend=webgl`             | Fuerza el backend WebGL 2                                                                                             |
| `?species=quercus-robur`     | Especie inicial (`abies-alba`, `quercus-robur`, `prunus-dulcis`)                                                      |
| `?archetype=conical-conifer` | Arquetipo sin especie (`broad-crown-broadleaf`, `conical-conifer`, `parasol-pine`, `columnar-tree`, `pendulous-tree`) |
| `?seed=42`                   | Semilla inicial                                                                                                       |
| `?years=20`                  | Año inicial, por defecto 25 (admite fracciones: `20.8` es finales de octubre)                                         |
| `?wind=0.6`                  | Intensidad inicial del viento (0-1)                                                                                   |
| `?skeleton=1`                | Vista de diagnóstico con un cilindro por entrenudo en lugar de la corteza continua                                    |
| `?leafSeconds=20`            | Segundos reales por año del ciclo de hojas independiente                                                              |
| `?leafCycle=coupled`         | Ciclo de hojas ligado al crecimiento                                                                                  |
| `?haze=0.4`                  | Bruma inicial de la atmósfera (0-1)                                                                                   |
| `?post=0`                    | Sin postprocesado (oclusión ambiental y FXAA)                                                                         |
| `?leafPlay=1`                | Arranca con las estaciones de las hojas en marcha (por defecto, en pausa y en primavera)                              |

## Estructura

```text
src/
  main.ts         arranque
  render/         renderer, escena, maceta, esqueleto, hojas, flores y frutos instanciados
  fx/             partículas visuales: hojas, pétalos y frutos que caen
  sim/            núcleo de simulación botánica: grafo, yemas, reparto, luz, madera, órganos
  worker/         ejecución de ticks en Worker y protocolo de mensajes
  presets/        arquetipos morfológicos y presets de especie (abeto, roble, almendro)
  ui/             interfaz
tests/            tests de Vitest
docs/PLAN.md      plan por fases
```

## Convenciones

Metros, años de tiempo biológico, radianes en el motor y sistema derecho con +Y arriba.
El reloj biológico es independiente del reloj de render.
