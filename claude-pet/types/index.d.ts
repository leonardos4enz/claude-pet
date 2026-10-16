export type Mood =
  | 'sleep' | 'idle' | 'think' | 'write' | 'work' | 'sad' | 'dizzy' | 'happy' | 'attention' | 'love'   // attention = te necesita · love = lo felicitaste
  | 'vibe' | 'fine' | 'cinema' | 'walk'   // momentos meme

export type View = {
  mood: Mood
  base: Mood          // a qué estado vuelve tras uno momentáneo
  until: number       // ms del reloj en que termina el momentáneo (0 = no hay)
  say: string
  baseSay: string     // lo que dice el estado de base (vuelve tras un momentáneo)
  talking: boolean    // la boca se mueve (Claude está escribiendo)
  lastActivity: number
  // metadatos de la sesión
  project: string
  branch: string
  model: string       // «Opus 5.5»
  tokens: number      // tokens en contexto (-1 = desconocido)
  window: number
  pct: number         // % de contexto (-1 = desconocido)
  cost: number        // USD de la sesión (-1 = desconocido)
  limit5h: number     // % usado del límite de 5 h (-1 = desconocido)
  reset5h: string     // a qué hora se reinicia el límite de 5 h («18:40»; '' = desconocido)
  week: number        // % usado del límite semanal (-1 = desconocido)
  tasksDone: number   // tareas de Claude completadas
  tasksTotal: number  // tareas de Claude en total (0 = no hay lista)
  taskNow: string     // la tarea en curso («Implementando el radar»)
  agents: number      // subagentes trabajando ahora
  agentNow: string    // lo que hace el último subagente lanzado
  background: number  // procesos que Claude dejó corriendo en segundo plano
  wakeAt: string      // a qué hora se despierta solo («18:40»; '' = no)
  quip: string        // comentario corto de la IA (solo con «/pet comentarios on»)
  shiny: boolean      // easter egg: 1 de cada 256 conversaciones sale dorado
}

/** Otra conversación abierta, como la ve el radar. */
export type Other = {
  id: string
  project: string
  topic: string       // el inicio del primer mensaje de esa conversación
  mood: Mood
  say: string
  at: number          // última señal de vida (ms)
  busySince: number   // desde cuándo trabaja en el turno actual (0 = no trabaja)
  doneAt: number      // cuándo terminó su último turno sin que le hayas vuelto a escribir (0 = nada pendiente)
  activeAt: number    // la última vez que pasó algo en ella (mensaje, herramienta, respuesta)
}

/** Una fila del radar, lista para dibujar. */
export type RadarItem = {
  id: string
  kind: 'need' | 'busy' | 'done' | 'idle'
  title: string       // de qué trata
  project: string
  status: string      // «escribiendo · 3m», «terminó hace 5m»
  color: string
}

/** Lo que el usuario personaliza con /pet (se guarda entre sesiones). */
export type Accessory = 'ninguno' | 'gorro' | 'corona' | 'moño' | 'audifonos' | 'fiesta'
  | 'paja' | 'ninja' | 'saiyan' | 'neko' | 'pirata'   // estilo anime
  | 'calabaza' | 'santa'                              // de temporada (solo en su fecha, no se eligen)
export type Prefs = {
  name: string        // cómo se llama tu pet
  color: string       // color del cuerpo y de la red neuronal (#rrggbb)
  accessory: Accessory
  sound: boolean      // campanita cuando te necesita o termina un turno largo
  memes: boolean      // momentos meme (vibe coding, this is fine…)
  radar: boolean      // mostrar las otras conversaciones
  permissions: boolean // alerta «necesita tu permiso» (apágala si usas el modo auto)
  comments: boolean   // comentarios de la IA sobre lo que hace Claude (gasta tokens; apagado por defecto)
}

/** Evolución: crece con lo que haces (se guarda entre sesiones). */
export type StageId = 'huevo' | 'cria' | 'aprendiz' | 'hacker' | 'ninja' | 'samurai' | 'sensei' | 'maestro' | 'leyenda' | 'deidad' | 'singularidad'
export type Progress = {
  xp: number          // (versión vieja, ya no se usa)
  tokens: number      // tokens trabajados juntos: definen la etapa
  turns: number
  edits: number
  tools: number
  agents: number
  praises: number
  streak: number      // días seguidos usándolo
  lastDay: string     // «2026-10-16»
  achievements: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'claude-pet': { view: View; hidden: boolean; others: RadarItem[]; prefs: Prefs; progress: Progress }
  }
}
