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

Para forzar el backend WebGL 2 y comparar, abre la app con `?backend=webgl`.

## Estructura

```text
src/
  main.ts         arranque
  render/         renderer, detección de backend, escena y maceta
  sim/            núcleo de simulación botánica (fase 2)
  worker/         ejecución de ticks en Worker (fase 2)
  presets/        especies y fenología (fase 4)
  ui/             interfaz
tests/            tests de Vitest
docs/PLAN.md      plan por fases
```

## Convenciones

Metros, años de tiempo biológico, radianes en el motor y sistema derecho con +Y arriba.
El reloj biológico es independiente del reloj de render.
