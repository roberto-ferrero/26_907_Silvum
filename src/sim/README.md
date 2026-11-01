# src/sim

Núcleo de simulación botánica, sin dependencias de three.js ni del DOM. Determinista por
semilla; unidades SI (metros, años, radianes) con +Y arriba.

| Módulo            | Contenido                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`        | Estado persistente: ejes, entrenudos, yemas, cohortes de hojas y flores, frutos, entorno       |
| `tree.ts`         | `TreeSimulation`: ciclo de tick semanal (liberación, elongación, engrosamiento, supervivencia) |
| `allocation.ts`   | Borchert-Honda, reparto ponderado, hazard con umbral persistente, crédito fraccionario         |
| `orientation.ts`  | Dirección de nacimiento, inclinación objetivo, dirección de nuevos entrenudos                  |
| `wood.ts`         | Objetivo tipo pipe y engrosamiento monotónico                                                  |
| `light.ts`        | Campo de luz provisional (propagación de sombra) tras la interfaz `LightField`                 |
| `morphotype.ts`   | Arquetipos del catálogo y escala artística declarada                                           |
| `clock.ts`        | Reloj biológico (1 semana por tick) y ventanas estacionales                                    |
| `random.ts`       | Aleatoriedad por identidad de evento                                                           |
| `species.ts`      | Esquema de presets de especie sobre los arquetipos (datos en `src/presets/species.ts`)         |
| `phenology.ts`    | Calendario fenológico por especie y nombre de la fase del año                                  |
| `organs.ts`       | Ciclo de vida de hojas, flores y frutos dentro del tick; desprendimientos visuales             |
| `leaves.ts`       | Rasgos por hoja, senescencia y color no uniforme, forma individual y pose de dibujo            |
| `reproduction.ts` | Calendario por flor, crecimiento y masa del fruto, poses                                       |
| `wind.ts`         | Campo de viento compartido (ráfagas semanales del núcleo y velocidad para partículas)          |
| `snapshot.ts`     | Instantánea de dibujo (no altera el estado)                                                    |

Las decisiones de ingeniería y sus fuentes están comentadas en cada módulo y en
`docs/PLAN.md`. Los arquetipos no están calibrados; la escala es artística.
