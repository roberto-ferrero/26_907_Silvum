# src/sim

Núcleo de simulación botánica, sin dependencias de three.js ni del DOM. Determinista por
semilla; unidades SI (metros, años, radianes) con +Y arriba.

| Módulo           | Contenido                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`       | Estado persistente: ejes, unidades de crecimiento, entrenudos, yemas, eventos                  |
| `tree.ts`        | `TreeSimulation`: ciclo de tick semanal (liberación, elongación, engrosamiento, supervivencia) |
| `allocation.ts`  | Borchert-Honda, reparto ponderado, hazard con umbral persistente, crédito fraccionario         |
| `orientation.ts` | Dirección de nacimiento, inclinación objetivo, dirección de nuevos entrenudos                  |
| `wood.ts`        | Objetivo tipo pipe y engrosamiento monotónico                                                  |
| `light.ts`       | Campo de luz provisional (propagación de sombra) tras la interfaz `LightField`                 |
| `morphotype.ts`  | Arquetipos del catálogo y escala artística declarada                                           |
| `clock.ts`       | Reloj biológico (1 semana por tick) y ventanas estacionales                                    |
| `random.ts`      | Aleatoriedad por identidad de evento                                                           |
| `snapshot.ts`    | Instantánea de dibujo (no altera el estado)                                                    |

Las decisiones de ingeniería y sus fuentes están comentadas en cada módulo y en
`docs/PLAN.md`. Los arquetipos no están calibrados; la escala es artística.
