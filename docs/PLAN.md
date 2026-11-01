# Silvum: plan de desarrollo por fases

Simulador 3D de crecimiento de árboles en el navegador (three.js + WebGPU), presentado en una maceta de estilo bonsái.
El árbol crece libre: la maceta es solo presentación. Objetivo: experiencia visual rica asentada en principios científicos.

- Última actualización: 2026-11-01
- Estado: fases 0, 1, 2 y 4 completadas; la fase 3 queda pendiente (se saltó a la 4 por decisión del 1 nov 2026).
- Leyenda: `[x]` hecho · `[ ]` pendiente · `[~]` en curso
- Documentos relacionados:
  - Especificación de partida: `Bases_crecimiento_arboles_WebGPU.docx` (v0.1, 31 oct 2026)
  - Paquete de referencia: `tree-growth-foundation` v0.1
  - Análisis y decisiones: [Silvum: análisis y dudas](https://claude.ai/artifact/6RRDDPuvE218uPuaLFiLUm)

---

## Decisiones de alcance (1 nov 2026)

| #   | Tema           | Decisión                                                                                                                                                                          |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Paquete base   | `tree-growth-foundation` como referencia; se rehace con mayor calidad                                                                                                             |
| 2   | Bonsái         | Árbol libre; la maceta es solo diseño                                                                                                                                             |
| 3   | Prioridad      | Visual rica sobre base científica                                                                                                                                                 |
| 4   | Especies v1    | Abeto, roble y almendro                                                                                                                                                           |
| 5   | Interacción    | Tiempo, semilla, viento, luz, atmósfera, ratón sobre ramas. Sin alambrado                                                                                                         |
| 6   | Rango temporal | Semilla a 30-50 años simulados, velocidad ajustable                                                                                                                               |
| 7   | Rebobinar      | Sí, con instantáneas                                                                                                                                                              |
| 8   | Nebari         | Sí, solo visual                                                                                                                                                                   |
| 9   | Estilo         | Realista suave                                                                                                                                                                    |
| 10  | Dispositivos   | Escritorio con WebGPU; aviso si cae a WebGL 2                                                                                                                                     |
| 11  | Build          | Vite + TypeScript                                                                                                                                                                 |
| 12  | Entorno        | Fondo neutro, luz por estación, viento desde el inicio; lluvia y nieve en el futuro                                                                                               |
| 13  | Diagnóstico    | Sí, panel ocultable                                                                                                                                                               |
| 14  | Estética       | (1 nov 2026, tarde) Árboles visualmente icónicos por encima de la fidelidad científica: se admiten guías artísticas (envolvente de copa, ramas madre dirigidas, manojos de hojas) |
| —   | Rigging        | Rig de ramas con masa y rigidez: combadura por peso, mecimiento por viento, interacción con ratón                                                                                 |
| —   | Hojas          | Formas y morfologías distintas por especie; caducas o perennes; caída visible ocasional, por viento (trayectoria coherente con él) y estacional; cambio de color no uniforme      |

---

## Fase 0. Análisis y diseño

- [x] 0.1 Localizar y leer la especificación científica
- [x] 0.2 Analizar las referencias (S01-S12, T01-T05) y su utilidad para el proyecto
- [x] 0.3 Revisar `tree-growth-foundation` (41 tests OK, `tsc --noEmit` estricto OK)
- [x] 0.4 Identificar brechas entre especificación y requisitos (fenología, viento, maceta, especies)
- [x] 0.5 Plantear dudas de diseño y alcance
- [x] 0.6 Registrar decisiones y requisito de rigging
- [x] 0.7 Plan por fases en el repo (este documento)

## Fase 1. Infraestructura del proyecto

- [x] 1.1 Proyecto Vite + TypeScript estricto; scripts `dev`, `build`, `preview`, `test`, `typecheck`, `lint`
- [x] 1.2 three.js con versión fijada (0.186.1); `WebGPURenderer` y detección del backend efectivo (WebGPU o WebGL 2) con aviso
- [x] 1.3 Vitest para el núcleo; ESLint + Prettier
- [x] 1.4 Estructura de carpetas: `src/sim` (núcleo), `src/worker`, `src/render`, `src/ui`, `src/presets`, `docs/`
- [x] 1.5 Escena base: cámara orbital, iluminación de estudio, fondo neutro, maceta y sustrato provisionales
- [x] 1.6 CI en GitHub Actions (typecheck, tests, build)

## Fase 2. Núcleo de simulación (reescritura de tree-growth-foundation)

- [x] 2.1 Tipos y contratos revisados (ejes, unidades de crecimiento, nodos, entrenudos, yemas, cohortes de hojas)
- [x] 2.2 Aleatoriedad por evento con semilla (`eventHash`, `eventUniform`)
- [x] 2.3 Reparto Borchert-Honda y reparto ponderado conservativos
- [x] 2.4 Activación de yemas por hazard con umbral persistente por episodio
- [x] 2.5 Crédito fraccionario de crecimiento y conversión explícita a metros
- [x] 2.6 Orientación: nacimiento de laterales, inclinación objetivo, tropismos con límite de giro por longitud
- [x] 2.7 Engrosamiento monotónico con objetivo tipo pipe y demanda cambial terminal
- [x] 2.8 Reloj biológico fijo (1 semana por tick) separado del render
- [x] 2.9 Ciclo de tick completo: instantánea, señales puntas a base, reparto base a puntas, propuestas, confirmación (luz provisional por propagación de sombra de Pałubicki; la definitiva es la fase 3)
- [x] 2.10 Supervivencia por déficit sostenido; estados living / deadRetained / detached
- [x] 2.11 Ejecución en Worker con publicación de instantáneas de render (vista provisional de esqueleto con cilindros y panel mínimo)
- [x] 2.12 Tests estructurales: sin ciclos, IDs estables, presupuesto conservado, radios no decrecientes, sin NaN, replay determinista

## Fase 3. Luz y competencia

- [ ] 3.1 Rejilla de densidad foliar (32³ / 64³) construida en Worker
- [ ] 3.2 Muestreo de cielo y sol con atenuación exponencial (CPU de referencia)
- [~] 3.3 Señal de espacio libre separada de la de luz (incluye evitar la maceta y el suelo: hecho el suelo; faltan la maceta y el espacio libre)
- [ ] 3.4 Control de luz por el usuario (dirección e intensidad) como evento en el instante actual
- [ ] 3.5 Kernel compute WebGPU (TSL) equivalente a la referencia CPU, con comparación de tolerancias

## Fase 4. Especies y fenología

- [x] 4.1 Esquema de presets de especie sobre los arquetipos (filotaxis explícita, tipo de hoja, caducidad, escala artística declarada)
- [x] 4.2 Preset abeto (cónica, perenne, aguja, crecimiento rítmico por pisos)
- [x] 4.3 Preset roble (copa amplia, caduco, hoja plana, ejes estructurales competidores)
- [x] 4.4 Preset almendro (caduco, floración antes de la brotación, fruto)
- [x] 4.5 Calendario estacional: reposo, brotación, expansión de hojas, engrosamiento, senescencia
- [x] 4.6 Hojas: morfología y ciclo de vida
  - [x] 4.6.1 Catálogo de formas por especie (aguja, escama, lobulada, lanceolada, ovada...) con contorno, nervadura, tamaño y variación por individuo
  - [x] 4.6.2 Hábito caduco o perenne por especie; perennes con renovación escalonada (vida de la hoja en años)
  - [x] 4.6.3 Cohortes con edad, salud y fecha propia de senescencia
  - [x] 4.6.4 Cambio de color otoñal no uniforme: cada hoja con su desfase y velocidad (por luz recibida, posición y aleatoriedad por semilla)
  - [x] 4.6.5 Caída ocasional de fondo durante todo el año (renovación, daño)
  - [x] 4.6.6 Caída por viento: probabilidad según intensidad de ráfaga y estado de la hoja
  - [x] 4.6.7 Caída estacional (abscisión masiva en otoño para caducas)
  - [x] 4.6.8 Física de la hoja que cae: arrastre, giro y balanceo, trayectoria coherente con el campo de viento
  - [x] 4.6.9 Hojas en el suelo y en la maceta, con desvanecimiento progresivo
- [x] 4.7 Flores: yemas florales, apertura, pétalos y caída
- [x] 4.8 Frutos: cuajado, crecimiento, masa como carga, caída
- [x] 4.9 Tipos `FlowerCohort` y `FruitState` en el núcleo

Notas de la fase 4:

- Presets en `src/presets/species.ts` (abeto `Abies alba`, roble `Quercus robur`, almendro `Prunus dulcis`); cada arquetipo conserva una especie genérica (`archetype:<id>`) con el calendario de la fase 2.
- Hojas como cohortes por entrenudo; los rasgos de cada hoja se derivan de (semilla, cohorte, índice). Caducas con brotes cortos (rosetas en yemas latentes) para una densidad creíble; roble con marcescencia parcial.
- La sombra usa las hojas como oclusores (más las yemas); en caducas cuenta el follaje de la temporada anterior durante la brotación.
- El viento (`src/sim/wind.ts`) es un evento del entorno en el estado: cambia la caída de hojas, nunca la madera de una caduca (test).
- Dibujo provisional (hasta la fase 6): hojas, flores y frutos instanciados con geometría por forma y color por hoja calculado en el Worker. Partículas visuales (`src/fx/falling.ts`) para hojas, pétalos y frutos que caen.
- Morfología del roble revisada contra su canon (Quercus robur aislado; modelo de Rauh con hábito de bifurcación): pérdida de dominancia del líder hacia los 7-11 años con reiteración en ramas madre, aborto de yemas terminales (ramificación aparentemente simpodial y sinuosa), acrotonía, plagiotropía creciente hacia la base de la copa, poda natural de las ramas juveniles bajas (fuste limpio) y cielo lateral en la luz provisional. Métricas de silueta en `tests/crown-metrics.ts` y canon en `tests/oak-canon.test.ts` (40 años: anchura/altura ≈ 0,7-1,0, base de copa ≈ 25-30 %, ≥ 3 ramas madre, sin flecha).
- Correcciones del motor: el déficit de luz de un eje se mide sobre su subárbol (antes una rama madre sin yemas propias moría con todas sus ramillas vivas); ningún entrenudo crece por debajo del sustrato (adelanto de 3.3); fuera dos costes cuadráticos (conteo de yemas y desprendimiento de ejes).
- Dirección de arte del roble (decisión 14): envolvente de copa en cúpula que guía la señal de las yemas y curva los brotes hacia dentro (`src/sim/envelope.ts`), 3-5 ramas madre repartidas en azimut al perder el líder y una que lo releva en vertical, aclareo del interior, saturación de madera (≈ 13.000 entrenudos estables de 40 a 80 años), exponente de tuberías 2,35 (tronco ≈ 7-10 cm a 40-80 años) y manojos de 4 hojas por instancia.
- Pendiente para otras fases: la forma del abeto aún no es cónica y no hay conos; los mecanismos de arquitectura (`architecture` en el preset) están listos para aplicarlos al abeto y al almendro.

## Fase 5. Rig de ramas, peso y viento

- [ ] 5.1 Rig jerárquico: un hueso por eje (o tramo de eje) con pivote, masa y rigidez dependiente del radio
- [ ] 5.2 Masa acumulada por subárbol: madera, hojas, flores y frutos
- [ ] 5.3 Combadura estática por peso (momento acumulado, aproximación de ángulo pequeño, EI artístico declarado)
- [ ] 5.4 Mecimiento dinámico por viento: resortes amortiguados por nivel de rama, ráfagas con ruido coherente
- [ ] 5.5 Interacción con el ratón: seleccionar, empujar y tirar de una rama sobre el mismo rig
- [ ] 5.6 Memoria lenta de forma: solo la combadura sostenida modifica la curvatura de referencia en ticks biológicos
- [ ] 5.7 Garantía: la pose del rig (viento, ratón) no altera la historia biológica (test)
- [ ] 5.8 Datos del rig en GPU (pivote, rigidez, nivel) y deformación en el shader de vértices

## Fase 6. Render realista suave

- [~] 6.1 Tubos con transporte paralelo, subdivisión por curvatura y distancia (hecho el tubo continuo por eje con ensanchamiento basal; falta la subdivisión)
- [ ] 6.2 Uniones de ramas sin costuras visibles (parches o mezcla local)
- [ ] 6.3 Material de corteza PBR con madurez de corteza por edad
- [ ] 6.4 Hojas instanciadas por cohortes con LOD que preserve el área; agujas para coníferas
- [ ] 6.5 Maceta de bonsái, sustrato y nebari (raíces superficiales visuales)
- [ ] 6.6 Iluminación por estación y hora; sombras
- [ ] 6.7 Atmósfera: niebla y tono de cielo controlables
- [ ] 6.8 Postprocesado suave (tone mapping, AO)

## Fase 7. Interfaz y control del tiempo

- [ ] 7.1 Selector de especie y semilla (cambiar reconstruye desde la semilla)
- [ ] 7.2 Línea de tiempo: reproducir, pausar, velocidad, salto a año
- [ ] 7.3 Rebobinado con instantáneas anuales y repetición de eventos
- [ ] 7.4 Controles de viento, luz y atmósfera
- [ ] 7.5 Indicadores de edad simulada, estación y etapa morfológica
- [ ] 7.6 Panel de diagnóstico ocultable: esqueleto, mapa de luz, vigor, registro de eventos

## Fase 8. Postura activa y mecánica avanzada

- [ ] 8.1 Controlador AC planar sobre ejes (Bastien 2013) con subpasos
- [ ] 8.2 Extensión 3D en marco material transportado, validada contra casos planos
- [ ] 8.3 Equilibrio cuasiestático ramificado 3D con memoria de deposición
- [ ] 8.4 Pruebas: inclinar un eje joven y estabilizar; cargar y descargar sin deformación espuria

## Fase 9. Rendimiento y calidad

- [ ] 9.1 Presupuestos de capacidad preasignados con pausa legible al alcanzarlos
- [ ] 9.2 Medición de FPS y coste por tick en hardware de referencia
- [ ] 9.3 Pruebas de convergencia (dt frente a dt/2, resolución de rejilla)
- [ ] 9.4 Pruebas de comportamiento: luz lateral, quitar ápice, sombra prolongada, misma semilla

## Fase 10. Ampliaciones futuras

- [ ] 10.1 Más especies: encina, secuoya, pino piñonero, columnar, péndulo
- [ ] 10.2 Lluvia y nieve (con carga de nieve sobre el rig)
- [ ] 10.3 Poda interactiva como evento
- [ ] 10.4 Calibración de especies con datos medidos
