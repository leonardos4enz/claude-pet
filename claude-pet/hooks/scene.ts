// scene.ts — Clawd en SVG animado (SMIL) para la banda de arriba del chat. Funciones puras:
// estado -> markup. Un solo diseño: Clawd mini con su red neuronal circular y los datos de la sesión.
import type { Accessory, Mood, Other, Prefs, Progress, RadarItem, StageId, View } from '../types'

const ORANGE = '#d97757'
const TRANSIENT: Partial<Record<Mood, number>> = {
  happy: 2500, sad: 3500, dizzy: 3000, vibe: 4200, fine: 4500, cinema: 3600, walk: 4300, love: 3000,
}
const DEFAULT_SAY: Partial<Record<Mood, string>> = {
  think: 'Pensando…', write: 'Escribiendo respuesta…', work: 'Trabajando…', sad: 'Algo falló',
  dizzy: 'Compactando memoria…',
}
const SLEEP_AFTER_MS = 90_000

export function initialView(): View {
  return {
    mood: 'idle', base: 'idle', until: 0, say: '', baseSay: '', talking: false, lastActivity: 0,
    project: '', branch: '', model: '', tokens: -1, window: 0, pct: -1, cost: -1, limit5h: -1,
    reset5h: '', week: -1, tasksDone: 0, tasksTotal: 0, taskNow: '', agents: 0, agentNow: '', background: 0, wakeAt: '', quip: '', shiny: false,
  }
}

/** Cambia de estado; los momentáneos (memes, errores) vuelven solos al estado de base. */
export function setMood(v: View, m: Mood, now: number, text?: string): View {
  const isTransient = m in TRANSIENT
  const say = text ?? DEFAULT_SAY[m] ?? ''
  return {
    ...v, mood: m, base: isTransient ? v.base : m, until: isTransient ? now + (TRANSIENT[m] ?? 0) : 0,
    say, baseSay: isTransient ? v.baseSay : say, talking: isTransient ? false : m === 'write', lastActivity: now,
  }
}

/** El paso del tiempo: los estados momentáneos terminan y, sin actividad, Clawd se duerme. */
export function tick(v: View, now: number): View {
  if (v.until && now > v.until) return { ...v, mood: v.base, until: 0, say: v.baseSay, talking: v.base === 'write' }
  if (v.mood === 'idle' && v.lastActivity && now - v.lastActivity > SLEEP_AFTER_MS) return { ...v, mood: 'sleep', base: 'sleep', say: '', baseSay: '' }
  return v
}

/** Qué está haciendo Claude con esta herramienta. */
export function describeTool(tool: string, e: Record<string, unknown>): [Mood, string] {
  const base = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
  const text = tool === 'Edit' ? `Editando ${base(e.file_path)}`
    : tool === 'Write' ? `Creando ${base(e.file_path)}`
    : tool === 'Read' ? `Leyendo ${base(e.file_path)}`
    : tool === 'Bash' || tool === 'PowerShell' ? `$ ${String(e.command ?? '').split('\n')[0]}`
    : tool === 'Grep' ? `Buscando '${e.pattern ?? ''}'`
    : tool === 'Glob' ? `Buscando ${e.pattern ?? ''}`
    : tool === 'WebSearch' ? `Investigando: ${e.query ?? ''}`
    : tool === 'WebFetch' ? 'Leyendo una página web'
    : tool === 'Agent' ? `Subagente: ${e.description ?? ''}`
    : tool === 'Skill' ? `Skill: ${e.skill ?? ''}`
    : tool.startsWith('mcp__') ? tool.split('__').slice(1).join(': ') : tool
  // todas las herramientas usan la misma animación: alternar leer/editar no la reinicia
  return ['work', text.length > 70 ? text.slice(0, 69) + '…' : text]
}

// ======================= personalización (/pet) =======================
export const ACCESSORIES: Accessory[] = ['ninguno', 'paja', 'ninja', 'saiyan', 'neko', 'pirata', 'gorro', 'corona', 'moño', 'audifonos', 'fiesta']
export const COLOR_NAMES: Record<string, string> = {
  naranja: '#d97757', azul: '#5b8def', cian: '#29d3ff', verde: '#5cc98a', morado: '#a77bf3',
  rosa: '#ef7bb8', rojo: '#e5484d', amarillo: '#f5c451', gris: '#9a968d', blanco: '#e8e4da',
}

export function defaultPrefs(): Prefs {
  return { name: 'Claude', color: '#d97757', accessory: 'ninguno', sound: false, memes: true, radar: true, permissions: true, stageLook: true, comments: false }
}

/** «azul» o «#5b8def» → '#5b8def'; '' si no es un color. */
export function parseColor(text: string): string {
  const t = text.trim().toLowerCase()
  if (COLOR_NAMES[t]) return COLOR_NAMES[t]
  const m = t.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/)
  if (!m) return ''
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return '#' + h
}

/** Una preferencia guardada (de una versión vieja o editada a mano) siempre queda completa y válida. */
export function cleanPrefs(raw: unknown): Prefs {
  const d = defaultPrefs(), r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Prefs>
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 20) : d.name,
    color: typeof r.color === 'string' && parseColor(r.color) ? parseColor(r.color) : d.color,
    accessory: ACCESSORIES.includes(r.accessory as Accessory) ? r.accessory as Accessory : d.accessory,
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
    memes: typeof r.memes === 'boolean' ? r.memes : d.memes,
    radar: typeof r.radar === 'boolean' ? r.radar : d.radar,
    comments: typeof r.comments === 'boolean' ? r.comments : d.comments,
    permissions: typeof r.permissions === 'boolean' ? r.permissions : d.permissions,
    stageLook: typeof r.stageLook === 'boolean' ? r.stageLook : d.stageLook,
  }
}

/** «/pet nombre Pixel», «/pet color azul»…: [preferencias nuevas, respuesta] o null si no se entiende. */
export function applyPetCommand(p: Prefs, args: string): [Prefs, string] | null {
  const [cmd = '', ...rest] = args.trim().split(/\s+/)
  const val = rest.join(' ').trim()
  const onOff = (v: string) => /^(on|si|sí|1|true|encender|activar)$/i.test(v) ? true : /^(off|no|0|false|apagar|desactivar)$/i.test(v) ? false : null
  switch (cmd.toLowerCase()) {
    case 'nombre': case 'name':
      if (!val) return [p, `Se llama ${p.name}. Usa: /pet nombre <nombre>`]
      return [{ ...p, name: val.slice(0, 20) }, `¡Ahora me llamo ${val.slice(0, 20)}!`]
    case 'color': {
      const c = parseColor(val)
      if (!c) return [p, `Colores: ${Object.keys(COLOR_NAMES).join(', ')} o un #rrggbb`]
      return [{ ...p, color: c }, `Nuevo color: ${val}`]
    }
    case 'accesorio': case 'accessory': {
      const a = val.toLowerCase().replace('mono', 'moño').replace('audífonos', 'audifonos') as Accessory
      if (!ACCESSORIES.includes(a)) return [p, `Accesorios: ${ACCESSORIES.join(', ')}`]
      return [{ ...p, accessory: a }, a === 'ninguno' ? 'Sin accesorio' : `Me puse: ${a}`]
    }
    case 'sonido': case 'memes': case 'radar': case 'comentarios': case 'permisos': case 'atuendo': {
      const v = onOff(val)
      const key = cmd.toLowerCase() as 'sonido' | 'memes' | 'radar' | 'comentarios' | 'permisos' | 'atuendo'
      const field = key === 'sonido' ? 'sound' : key === 'comentarios' ? 'comments' : key === 'permisos' ? 'permissions' : key === 'atuendo' ? 'stageLook' : key
      if (v === null) return [p, `Usa: /pet ${key} on | off (ahora: ${p[field] ? 'on' : 'off'})`]
      return [{ ...p, [field]: v }, `${key[0].toUpperCase() + key.slice(1)}: ${v ? 'activado' : 'desactivado'}`]
    }
  }
  return null
}

export const PET_HELP = [
  '/pet — muestra u oculta',
  '/pet demo — todas las animaciones',
  '/pet nombre <nombre>',
  `/pet color <${Object.keys(COLOR_NAMES).join('|')}|#rrggbb>`,
  `/pet accesorio <${ACCESSORIES.join('|')}>`,
  '/pet sonido on|off · /pet memes on|off · /pet radar on|off',
  '/pet permisos on|off — alerta de permiso (apágala si usas el modo auto)',
  '/pet atuendo on|off — bufanda, capa, alas… de las etapas (off: se ve como el nivel 4)',
  '/pet comentarios on|off — la IA comenta lo que hace Claude (gasta tokens; apagado por defecto)',
  '/pet nivel — evolución y logros · /pet tarjeta — imagen para compartir',
].join('\n')

// ======================= tono de tu mensaje (local: no gasta tokens) =======================
const PRAISE = /\b(gracias|thanks|thank you|thx|genial|perfecto|excelente|incre[ií]ble|buen[ií]simo|buen trabajo|good job|great job|awesome|amazing|te amo|te quiero|eres (el|la|un|una) (mejor|crack|genio)|crack|g[eé]nio|me encanta|chido|chid[ií]simo|ching[oó]n|bravo|hermoso|lo amo|love (it|you)|well done|nice)\b/i
const INSULT = /\b(idiota|in[uú]til|est[uú]pido|pendejo|tonto|imb[eé]cil|baboso|no sirves|otra vez mal|de nuevo mal|mal hecho|qu[eé] asco|mierda|carajo|wtf|stupid|useless|dumb|idiot|terrible|horrible|you suck|apestas|cagaste|la cagaste)\b/i

/** «gracias» → 'praise'; insultos o GRITAR EN MAYÚSCULAS → 'insult'; lo demás → null. */
export function toneOf(text: string): 'praise' | 'insult' | null {
  const letters = text.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '')
  const shouting = letters.length >= 12 && letters === letters.toUpperCase()
  if (INSULT.test(text) || shouting) return 'insult'
  if (PRAISE.test(text)) return 'praise'
  return null
}

/** Frases secretas: [logro, estado, texto] o null. */
export function easterEgg(text: string): [string, Mood, string] | null {
  const t = text.trim().toLowerCase()
  if (/^\s*42\s*[?¿!.]*\s*$/.test(t) || /sentido de la vida|meaning of life/.test(t)) return ['respuesta', 'happy', '42. La respuesta a todo.']
  if (/^sudo\b/.test(t)) return ['capitan', 'vibe', '¡Sí, mi capitán!']
  if (/^(hola mundo|hello,? world)\b/.test(t)) return ['hola', 'happy', '¡Hola, mundo! :)']
  return null
}

/** Accesorio de temporada para hoy (si no lleva otro): Halloween y Navidad. */
export function seasonal(month: number, day: number): Accessory | null {
  if (month === 10 && day === 31) return 'calabaza'
  if (month === 12 && (day === 24 || day === 25)) return 'santa'
  return null
}

// ======================= evolución y logros =======================
/** Las 10 etapas: cada una pide más tokens trabajados juntos (input + output + caché escrita). */
export const STAGES: { id: StageId; name: string; min: number; secret?: boolean }[] = [
  { id: 'huevo', name: 'Huevo', min: 0 },
  { id: 'cria', name: 'Cría', min: 100_000 },
  { id: 'aprendiz', name: 'Aprendiz', min: 1_000_000 },
  { id: 'hacker', name: 'Hacker', min: 5_000_000 },
  { id: 'ninja', name: 'Ninja', min: 15_000_000 },
  { id: 'samurai', name: 'Samurái', min: 40_000_000 },
  { id: 'sensei', name: 'Sensei', min: 90_000_000 },
  { id: 'maestro', name: 'Maestro', min: 160_000_000 },
  { id: 'leyenda', name: 'Leyenda', min: 260_000_000 },
  { id: 'deidad', name: 'Deidad del Código', min: 400_000_000 },
  { id: 'singularidad', name: 'Singularidad', min: 10_000_000_000_000, secret: true },   // 10T: el secreto
]
export const ACHIEVEMENTS: { id: string; name: string; desc: string; secret?: boolean }[] = [
  { id: 'hola', name: 'Hola mundo', desc: 'Tu primer turno juntos' },
  { id: 'eclosion', name: 'Eclosión', desc: 'Salió del huevo' },
  { id: 'manos', name: 'Mil manos', desc: '100 archivos editados' },
  { id: 'jefe', name: 'Jefe de equipo', desc: 'Tu primer subagente' },
  { id: 'ejercito', name: 'Ejército', desc: '4 subagentes a la vez' },
  { id: 'buho', name: 'Búho nocturno', desc: 'Un turno entre las 0 y las 5 h' },
  { id: 'maraton', name: 'Maratón', desc: 'Un turno de más de 10 minutos' },
  { id: 'vibe', name: 'Vibe coder', desc: '15 pasos seguidos sin errores' },
  { id: 'querido', name: 'Querido', desc: 'Le diste las gracias 10 veces' },
  { id: 'racha', name: 'Constancia', desc: '3 días seguidos' },
  { id: 'leyenda', name: 'Deidad', desc: 'Llegó a Deidad del Código' },
  { id: 'singularidad', name: 'Singularidad', desc: '10 billones de tokens. Ya no eres humano.', secret: true },
  { id: 'shiny', name: 'Shiny', desc: 'Te tocó un pet dorado (1 de cada 256)', secret: true },
  { id: 'respuesta', name: 'La respuesta', desc: 'Le preguntaste por el 42', secret: true },
  { id: 'capitan', name: 'Mi capitán', desc: 'Usaste sudo con tu pet', secret: true },
  { id: 'bailarin', name: 'Bailarín', desc: 'Lo pusiste a bailar', secret: true },
]

export function defaultProgress(): Progress {
  return { xp: 0, tokens: 0, turns: 0, edits: 0, tools: 0, agents: 0, praises: 0, streak: 0, lastDay: '', achievements: [] }
}

export function cleanProgress(raw: unknown): Progress {
  const d = defaultProgress(), r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Progress>
  const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0
  return {
    xp: n(r.xp), tokens: n(r.tokens), turns: n(r.turns), edits: n(r.edits), tools: n(r.tools), agents: n(r.agents), praises: n(r.praises),
    streak: n(r.streak), lastDay: typeof r.lastDay === 'string' ? r.lastDay : d.lastDay,
    achievements: Array.isArray(r.achievements) ? r.achievements.filter(a => typeof a === 'string') : [],
  }
}

export function stageOf(tokens: number) {
  let st = STAGES[0]
  for (const x of STAGES) if (tokens >= x.min) st = x
  return st
}
/** El nivel es la etapa: 1 (Huevo) a 10 (Deidad del Código); 11 es secreto. */
export const levelOf = (tokens: number) => STAGES.indexOf(stageOf(tokens)) + 1

/** 1234567 → «1.2M», 54321 → «54k». */
export function fmtBig(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

/** Lo que pasó y cuánto vale. */
export type ProgressEvent =
  | { type: 'tool' } | { type: 'edit' } | { type: 'agent'; concurrent: number } | { type: 'praise' }
  | { type: 'turn'; day: string; hour: number; ms: number } | { type: 'vibe' } | { type: 'tokens'; n: number } | { type: 'secret'; id: string }

/** Suma experiencia y desbloquea logros: [progreso nuevo, logros nuevos]. */
export function award(p: Progress, e: ProgressEvent): [Progress, { id: string; name: string; desc: string }[]] {
  const q: Progress = { ...p, achievements: [...p.achievements] }
  const before = stageOf(q.tokens).id
  const got: string[] = []
  const unlock = (id: string) => { if (!q.achievements.includes(id)) { q.achievements.push(id); got.push(id) } }
  switch (e.type) {
    case 'tool': q.tools++; q.xp += 1; break
    case 'edit': q.edits++; q.xp += 3; if (q.edits >= 100) unlock('manos'); break
    case 'agent': q.agents++; q.xp += 4; unlock('jefe'); if (e.concurrent >= 4) unlock('ejercito'); break
    case 'praise': q.praises++; q.xp += 5; if (q.praises >= 10) unlock('querido'); break
    case 'vibe': q.xp += 10; unlock('vibe'); break
    case 'tokens': q.tokens += Math.max(0, Math.floor(e.n)); break
    case 'secret': unlock(e.id); break
    case 'turn': {
      q.turns++; q.xp += 5; unlock('hola')
      if (e.hour >= 0 && e.hour < 5) unlock('buho')
      if (e.ms >= 600_000) unlock('maraton')
      if (q.lastDay !== e.day) {
        const yesterday = new Date(Date.parse(e.day + 'T12:00:00') - 86_400_000).toISOString().slice(0, 10)
        q.streak = q.lastDay === yesterday ? q.streak + 1 : 1
        q.lastDay = e.day
        if (q.streak >= 3) unlock('racha')
      }
      break
    }
  }
  const after = stageOf(q.tokens).id
  if (before === 'huevo' && after !== 'huevo') unlock('eclosion')
  if (after === 'deidad' || after === 'singularidad') unlock('leyenda')
  if (after === 'singularidad') unlock('singularidad')
  return [q, got.map(id => ACHIEVEMENTS.find(a => a.id === id)!).filter(Boolean)]
}

// ======================= formatos =======================
/** «claude-opus-5-5» → «Opus 5.5»; «claude-sonnet-4-5-20250929» → «Sonnet 4.5». */
export function prettyModel(id: string): string {
  const m = id.match(/(opus|sonnet|haiku|fable)[-_ ]?(\d+)(?:[-.](\d{1,2})(?!\d))?/i)
  if (!m) return id.replace(/^claude-/, '').slice(0, 14)
  return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? '.' + m[3] : ''}`
}

export function fmtTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`
}

/** Los datos útiles, en orden de importancia: [texto, color]. */
export function metaParts(v: View): [string, string][] {
  const out: [string, string][] = []
  if (v.pct >= 0) {
    const pc = v.pct >= 85 ? HEART : v.pct >= 70 ? YELLOW : MUTED
    out.push([`ctx ${v.pct}%${v.tokens >= 0 && v.window ? ` · ${fmtTokens(v.tokens)}/${fmtTokens(v.window)}` : ''}`, pc])
    if (v.pct >= 85) out.push(['compacta pronto', HEART])              // aviso antes de que se compacte solo
  }
  if (v.limit5h >= 0) {
    const lc = v.limit5h >= 85 ? HEART : v.limit5h >= 60 ? YELLOW : MUTED
    out.push([`5h ${Math.round(v.limit5h)}%${v.reset5h ? ` · reinicia ${v.reset5h}` : ''}`, lc])
  }
  if (v.week >= 60) out.push([`semana ${Math.round(v.week)}%`, v.week >= 85 ? HEART : YELLOW])   // solo si ya importa
  return out
}

/** «3/7 · Implementando el radar»: el progreso de la lista de tareas de Claude. */
export function taskLine(v: View): string {
  if (!v.tasksTotal) return ''
  if (v.tasksDone >= v.tasksTotal) return `${v.tasksTotal}/${v.tasksTotal} tareas listas`
  return `${v.tasksDone}/${v.tasksTotal}${v.taskNow ? ` · ${cut(v.taskNow, 40)}` : ''}`
}

/** Los archivos del turno, con límite: «register.tsx, scene.ts +3». */
export function filesLine(paths: string[], max = 2): string {
  const names = paths.map(p => p.split(/[\\/]/).filter(Boolean).pop() ?? p)
  return names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max}`
}

/** «18:40» desde una fecha ISO o epoch; '' si no se entiende. */
export function clockAt(when: string | number | undefined): string {
  if (when === undefined || when === '') return ''
  const n = typeof when === 'number' ? (when < 1e12 ? when * 1000 : when) : Date.parse(when)
  if (!Number.isFinite(n)) return ''
  const d = new Date(n)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ======================= dibujo =======================
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
function mix(hex: string, to: string, k: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16)
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * k) << s
  return '#' + (ch(16) | ch(8) | ch(0)).toString(16).padStart(6, '0')
}
const CREAM = '#f0eee6', MUTED = '#9a968d', EYE = '#16120f', YELLOW = '#f5c451', HEART = '#e5484d', FIRE = '#ff7a2f'
const rnd = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const cut = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '…' : s

/** La red neuronal circular: anillos que giran con nodos orbitando (la esfera del Core2). */
function mind(color: string, tier: number, talking: boolean, busy: boolean): string {
  const shells = tier === 1 ? [48, 78] : [44, 70, 96]
  const speed = busy ? 0.5 : 1
  let s = '<g transform="translate(160 104)">'
  // el corazón de la red: late suave, más rápido cuando trabaja
  s += `<circle r="9" fill="${color}" opacity="0.10"><animate attributeName="r" values="7;11;7" dur="${busy ? 1.1 : 2.8}s" repeatCount="indefinite"/></circle>`
  shells.forEach((r, k) => {
    const tilts = [0.32, 0.55, 0.22]
    for (let ring = 0; ring < 2; ring++) {
      const ry = r * tilts[(k + ring) % 3], ang = k * 37 + ring * 70, dur = ((14 + k * 6 + ring * 4) * speed).toFixed(1)
      const dir = (k + ring) % 2 ? -360 : 360
      const path = `M ${r} 0 A ${r} ${ry.toFixed(1)} 0 1 1 ${-r} 0 A ${r} ${ry.toFixed(1)} 0 1 1 ${r} 0`
      s += `<g transform="rotate(${ang})"><animateTransform attributeName="transform" type="rotate" from="${ang}" to="${ang + dir}" dur="${(+dur * 3).toFixed(1)}s" repeatCount="indefinite"/>`
      s += `<ellipse rx="${r}" ry="${ry.toFixed(1)}" fill="none" stroke="${color}" stroke-width="1" opacity="${talking ? 0.5 : 0.3}">`
      if (talking || busy) s += `<animate attributeName="opacity" values="0.22;0.7;0.3;0.6;0.22" dur="${talking ? 0.8 : 1.6}s" repeatCount="indefinite"/>`
      s += `</ellipse>`
      const nodes = 4 + k * 2
      for (let i = 0; i < nodes; i++) {
        s += `<circle r="${i % 3 ? 1.6 : 2.3}" fill="${i % 3 ? color : mix(color, '#ffffff', 0.35)}"><animateMotion dur="${dur}s" begin="-${((+dur * i) / nodes).toFixed(2)}s" repeatCount="indefinite" path="${path}"/></circle>`
      }
      s += '</g>'
    }
  })
  return s + '</g>'
}

// ---- animación suave: SMIL con curvas (como resortes, no en línea recta) ----
const EASE = '0.45 0 0.55 1'          // entra y sale suave
const OUT = '0.2 0.7 0.35 1'          // sale rápido y frena
const IN = '0.65 0 0.8 0.35'          // arranca lento y acelera
const BOUNCE = '0.15 0.85 0.3 1'      // llega rápido y se asienta; SMIL solo admite 0..1

/** Un animateTransform con curvas: `frames` son [valor, curva hacia el siguiente]. */
function tween(type: 'translate' | 'scale' | 'rotate', frames: [string, string?][], dur: number, extra = ''): string {
  const n = frames.length
  const times = frames.map((_, i) => (i / (n - 1)).toFixed(3)).join(';')
  const splines = frames.slice(0, -1).map(f => f[1] ?? EASE).join(';')
  const repeat = extra.includes('repeatCount') ? '' : ' repeatCount="indefinite"'
  return `<animateTransform attributeName="transform" type="${type}" values="${frames.map(f => f[0]).join(';')}" keyTimes="${times}" calcMode="spline" keySplines="${splines}" dur="${dur}s"${repeat}${extra}/>`
}

/** Clawd en coordenadas de piso (0,0 = centro del piso); c = tamaño de celda. */
function clawd(v: View, c: number, body: string, acc: Accessory = 'ninguno', wear = ''): string {
  const bodyL = mix(body, '#ffffff', 0.22), bodyD = mix(body, '#000000', 0.25)
  const X = (gx: number) => ((gx - 8) * c).toFixed(1), Y = (gy: number) => ((gy - 9) * c).toFixed(1)
  const R = (gx: number, gy: number, gw: number, gh: number, fill: string, extra = '') =>
    `<rect x="${X(gx)}" y="${Y(gy)}" width="${(gw * c).toFixed(1)}" height="${(gh * c).toFixed(1)}" fill="${fill}"${extra}/>`
  const m = v.mood
  const y = (k: number) => `0 ${(k * c).toFixed(1)}`

  // brazos: dónde está cada uno (en celdas; negativo = arriba) y cómo se mueve
  const arm = (side: number): string => {
    const alt = (a: number, b: number, dur: number, curve = BOUNCE) =>
      tween('translate', side ? [[y(a), curve], [y(b), curve], [y(a)]] : [[y(b), curve], [y(a), curve], [y(b)]], dur)
    switch (m) {
      case 'work': return alt(0.3, -0.7, 0.32)                      // teclea, una mano y la otra
      case 'write': return alt(0.2, -0.5, 0.24)                     // teclea más rápido: escribe la respuesta
      case 'walk': return alt(0.2, -0.6, 0.42, EASE)
      case 'love': return tween('translate', [[y(-1.5), EASE], [y(-1.9), EASE], [y(-1.5)]], 1.2)
      case 'attention': return alt(-3.2, -0.9, 0.6)                 // agita los brazos: te necesita
      case 'dizzy': return alt(-2, 1.5, 1.1, EASE)
      case 'happy': return tween('translate', [[y(-2.6), EASE], [y(-2), EASE], [y(-2.6)]], 0.5)
      case 'cinema': return tween('translate', [[y(-3.4), EASE], [y(-3.0), EASE], [y(-3.4)]], 0.9)   // «absolute cinema»
      case 'fine': return side ? tween('translate', [[y(-1.2), EASE], [y(-1.5), EASE], [y(-1.2)]], 2.2) : tween('translate', [[y(0.2)], [y(0.2)]], 1)
      case 'vibe': return tween('translate', [[y(0.1), EASE], [y(-0.3), EASE], [y(0.1)]], 0.5)
      case 'think': return side ? tween('translate', [[y(-2.2), EASE], [y(-2.6), EASE], [y(-2.2)]], 2.4) : tween('translate', [[y(0.2)], [y(0.2)]], 1)
      case 'sad': return tween('translate', [[y(1)], [y(1)]], 1)
      case 'sleep': return tween('translate', [[y(0.6), EASE], [y(0.75), EASE], [y(0.6)]], 4)
      default: return tween('translate', [[y(0), EASE], [y(-0.35), EASE], [y(0.15), EASE], [y(0)]], side ? 5.3 : 4.7)  // vaivén tranquilo
    }
  }

  // ojos según el estado
  const eye = (cx: number): string => {
    const px = (rows: string[], col: string, dy = 0) => rows.map((r, j) => [...r].map((ch, i) => ch === 'X'
      ? R(cx - r.length / 4 + i * 0.5, 3 - rows.length / 4 + j * 0.5 + dy, 0.5, 0.5, col) : '').join('')).join('')
    switch (m) {
      case 'happy': case 'fine': return px(['.XX.', 'X..X'], EYE)
      case 'love': return px(['.X.X.', 'XXXXX', '.XXX.', '..X..'], HEART)
      case 'sleep': return px(['XXX'], EYE, 0.6)
      case 'dizzy': return px(['X.X', '.X.', 'X.X'], EYE)
      case 'sad': return px(['XX', 'XX'], EYE, 0.5)
      default: {
        const wide = m === 'cinema' || m === 'attention'
        const w = wide ? 1.2 : 1, h = wide ? 2.4 : m === 'work' || m === 'write' ? 1.5 : 2
        const top = 4 - h + (m === 'work' || m === 'write' ? 0.3 : 0)
        // parpadeo: el párpado baja y sube rápido cada pocos segundos
        return `<rect x="${X(cx - w / 2)}" y="${Y(top)}" width="${(w * c).toFixed(1)}" height="${(h * c).toFixed(1)}" fill="${EYE}">` +
          `<animate attributeName="height" values="${(h * c).toFixed(1)};${(h * c).toFixed(1)};${(0.2 * c).toFixed(1)};${(h * c).toFixed(1)}" keyTimes="0;0.94;0.965;1" dur="4.6s" repeatCount="indefinite"/>` +
          `<animate attributeName="y" values="${Y(top)};${Y(top)};${Y(top + h - 0.2)};${Y(top)}" keyTimes="0;0.94;0.965;1" dur="4.6s" repeatCount="indefinite"/></rect>`
      }
    }
  }

  // salto: se agacha, sube frenando, cae acelerando y se aplasta al aterrizar (squash & stretch)
  const jump = (height: number, period: number, idle = 0): string => {
    const total = period + idle
    const k = (t: number) => (t / total).toFixed(3)
    const a = 0.07, up = period * 0.42, down = period * 0.42
    const t = [0, idle, idle + a, idle + a + up, idle + a + up + down, total]
    const hop = `<animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 2;0 ${-height};0 0;0 0" keyTimes="${t.map(k).join(';')}" calcMode="spline" keySplines="0 0 1 1;${EASE};${OUT};${IN};${OUT}" dur="${total}s" repeatCount="indefinite"/>`
    const squash = `<animateTransform attributeName="transform" type="scale" values="1 1;1 1;1.12 0.86;0.94 1.1;1.14 0.84;1 1" keyTimes="${t.map(k).join(';')}" calcMode="spline" keySplines="0 0 1 1;${EASE};${OUT};${IN};${BOUNCE}" dur="${total}s" repeatCount="indefinite"/>`
    return hop + '|' + squash
  }
  const jumps: Record<string, string> = {
    happy: jump(18, 0.6, 0.5), cinema: jump(10, 0.5, 1.4), love: jump(10, 0.45, 1.6), idle: jump(10, 0.5, 9), attention: jump(16, 0.5, 0.9),
  }
  const [hop, squash] = (jumps[m] ?? '|').split('|')
  const breath = m === 'sleep'
    ? tween('scale', [['1 0.93', EASE], ['1.02 0.9', EASE], ['1 0.93']], 4)
    : tween('scale', [['1 1', EASE], ['1.012 0.985', EASE], ['1 1']], m === 'work' || m === 'write' ? 1.2 : 2.6)
  const swayFrames = (dx: number, dur: number) => tween('translate', [[`${-dx} 0`, EASE], [`${dx} 0`, EASE], [`${-dx} 0`]], dur)
  // caminar: se va a la derecha (a las montañas, como el pingüino nihilista) y regresa por la izquierda
  const sway = m === 'dizzy' ? swayFrames(14, 1.3) : m === 'love' ? swayFrames(8, 2.2) : m === 'think' ? swayFrames(6, 5) : m === 'vibe' ? swayFrames(2, 0.5)
    : m === 'walk' ? `<animateTransform attributeName="transform" type="translate" values="0 0;175 0;-175 0;0 0" keyTimes="0;0.55;0.56;1" calcMode="spline" keySplines="0.4 0 0.9 0.6;0 0 1 1;0.1 0.4 0.4 1" dur="4.2s" fill="freeze"/>` : ''
  const look = m === 'idle' ? tween('translate', [['0 0', EASE], [`${c * 0.4} 0`, EASE], [`${c * 0.4} 0`, EASE], [`${-c * 0.4} 0`, EASE], ['0 0']], 7)
    : m === 'walk' ? tween('translate', [[`${c * 0.5} 0`], [`${c * 0.5} 0`]], 1) : ''
  const mouth = v.talking ? `<rect x="${X(7.4)}" y="${Y(4.6)}" width="${(1.2 * c).toFixed(1)}" height="${(0.4 * c).toFixed(1)}" fill="${EYE}">` +
    `<animate attributeName="height" values="${[0.3, 1, 0.5, 0.9, 0.2, 0.7, 0.3].map(k => (k * c).toFixed(1)).join(';')}" calcMode="spline" keyTimes="0;0.17;0.33;0.5;0.67;0.83;1" keySplines="${Array(6).fill(EASE).join(';')}" dur="0.75s" repeatCount="indefinite"/></rect>`
    : m === 'fine' || m === 'cinema' ? R(7.2, 4.8, 1.6, 0.5, EYE) : ''
  const blush = m === 'happy' || m === 'fine' || m === 'cinema' || m === 'love' ? R(2.5, 4.2, 1.5, 0.5, '#f3a48e') + R(12, 4.2, 1.5, 0.5, '#f3a48e') : ''
  // lentes «deal with it»: caen desde arriba y se quedan puestos
  const shades = m === 'vibe' ? `<g>${tween('translate', [[`0 ${(-9 * c).toFixed(1)}`, BOUNCE], ['0 0']], 0.8, ' repeatCount="1" fill="freeze"')}` +
    R(2.4, 2.1, 11.2, 0.6, '#000') + R(2.8, 2.1, 3.6, 2.1, '#000') + R(9.6, 2.1, 3.6, 2.1, '#000') +
    R(3.3, 2.5, 0.9, 0.5, '#ffffff') + R(10.1, 2.5, 0.9, 0.5, '#ffffff') + '</g>' : ''
  // patitas: al trabajar o caminar, pasitos alternados; quietas en lo demás
  const steps = m === 'work' || m === 'write' || m === 'walk'
  const legs = [3, 5, 10, 12].map((lx, i) => steps
    ? `<g>${tween('translate', [['0 0', OUT], [`0 ${(-0.6 * c).toFixed(1)}`, IN], ['0 0'], ['0 0']], m === 'walk' ? 0.5 : 0.64, ` begin="${(i * (m === 'walk' ? 0.25 : 0.16)).toFixed(2)}s"`)}${R(lx, 7, 1, 2, bodyD)}</g>`
    : R(lx, 7, 1, 2, bodyD)).join('')

  return `<g>${sway}<ellipse cx="0" cy="3" rx="${(c * 7).toFixed(1)}" ry="5" fill="#000" opacity="0.3"/>` +
    `<g>${hop}<g>${squash}<g>${breath}` +
    `<g>${arm(0)}${R(0, 4, 2.2, 2, body)}</g><g>${arm(1)}${R(13.8, 4, 2.2, 2, body)}</g>${legs}` +
    R(2, 0, 12, 7, body) + R(2, 0, 12, 0.5, bodyL) + R(2, 6.5, 12, 0.5, bodyD) + blush +
    `<g>${look}${eye(4.5)}${eye(11.5)}</g>${mouth}${shades}${wear}${accessory(acc, c, body)}</g></g></g></g>`
}

/** Un sprite de pixel art sobre la cuadrícula de Clawd: cada carácter es medio cuadrito (0.5 celda);
 *  '.' es transparente. Cada fila se centra sobre la cabeza, salvo que se dé `left` (en celdas). */
function sprite(rows: string[], top: number, pal: Record<string, string>, c: number, left?: number): string {
  let s = ''
  rows.forEach((row, r) => {
    const x0 = left ?? 8 - row.length / 4
    // une los pixeles iguales seguidos en un solo rect (menos markup)
    for (let i = 0; i < row.length;) {
      const ch = row[i]
      let j = i
      while (j < row.length && row[j] === ch) j++
      if (ch !== '.' && pal[ch]) {
        s += `<rect x="${((x0 + i * 0.5 - 8) * c).toFixed(1)}" y="${((top + r * 0.5 - 9) * c).toFixed(1)}" width="${((j - i) * 0.5 * c).toFixed(1)}" height="${(0.5 * c).toFixed(1)}" fill="${pal[ch]}"/>`
      }
      i = j
    }
  })
  return s
}

/** Los accesorios: sprites de pixel art con contorno, base, brillo y sombra (como Clawd). */
function accessory(a: Accessory, c: number, body: string): string {
  // el color de gorro y gorrito se elige para contrastar con el cuerpo
  const dist = (x: string, y: string) => [16, 8, 0].reduce((d, sh) => d + Math.abs(((parseInt(x.slice(1), 16) >> sh) & 255) - ((parseInt(y.slice(1), 16) >> sh) & 255)), 0)
  const pick = (cands: string[]) => cands.reduce((best, k) => dist(k, body) > dist(best, body) ? k : best)
  const main = pick(['#4a6fd8', '#e5484d', '#4fbf7f', '#9b6cf0'])
  const bow = pick(['#ef6fae', '#5b8def', '#f2c14e'])
  switch (a) {
    case 'paja':       // sombrero de paja: copa con cinta roja y ala ancha
      return sprite([
        'oooooooooooooooooo',
        'ohhhyyyyyyyyyyyyso',
        'ohyyyyyyyyyyyyyyso',
        'orrrrrrrrrrrrrrrRo',
        'oRRRRRRRRRRRRRRRRo',
        'ooyyyyyyyyyyyyyyyyyyyyyyyyyyyyoo',
        'ohyyyyyyyyyyyyyyyyyyyyyyyyyyysso',
        '.oooooooooooooooooooooooooooooo.',
      ], -4, { o: '#6b4a14', y: '#f0c95c', h: '#fbe7a1', s: '#c99a3a', r: '#d8392e', R: '#a2241d' }, c)
    case 'ninja': {    // banda en la frente con placa metálica grabada y las cintas al viento
      const band = { o: '#16203d', b: '#2f4a8c', B: '#22366a', m: '#d3d8df', p: '#8d949f', l: '#5d6470', h: '#f4f6f8' }
      return sprite([
        'oooooooooooooooooooooooooo',
        'obbbbbbbbphhmmmmpbbbbbbbbo',
        'oBBBBBBBBpmmlllmpBBBBBBBBo',
        'oooooooooppppppppooooooooo',
      ], 0.5, band, c) + sprite([
        'ooooo..',
        'obbbbo.',
        '.oBBbbo',
        '..ooooo',
      ], 1, band, c, 14.6)
    }
    case 'saiyan':     // pelo dorado en picos, alto e inclinado, con brillo y sombra
      return sprite([
        '......o.......o.........o.....',
        '.....oo......oyo.......oo.....',
        '.....oyo....oyyo......oyo.....',
        '..o..oyyo...oyhyo....oyyo.....',
        '..oo.oyhyo.oyhyyo...oyyyo..o..',
        '...oyoyhyyoyhyyyyo.oyyyyo.oo..',
        '...oyyyhyyyyhyyyyyoyyyyyoyyo..',
        '..oyyyhyyyyyhyyyyyyyyyyyyyyo..',
        '.oyyyhyyyyyyyyyyyyyyyyyyysso..',
        '.oyyhyyyyyyyyyyyyyyyyyyyysssoo',
        'oyyyyyyyyyyyyyyyyyyyyyyyyyssso',
        'oyysyyyysyyyyyyysyyyyyysysssso',
        '.oso.oso..........oso..oso.os.',
      ], -5.5, { o: '#8a5a00', y: '#ffd83d', h: '#fff4a8', s: '#e0a614' }, c)
    case 'neko': {     // orejas de gato del color del cuerpo, con interior rosa
      const dark = mix(body, '#000000', 0.45)
      return sprite([
        '.oo..................oo.',
        '.obo................obo.',
        '.obbo..............obbo.',
        '.obpbo............obpbo.',
        '.obppbo..........obppbo.',
        '.obpppbo........obpppbo.',
      ], -3, { o: dark, b: mix(body, '#ffffff', 0.08), p: '#f6a5b5' }, c)
    }
    case 'pirata':     // sombrero de tres picos con calavera y borde dorado
      return sprite([
        '..........oooooooooo..........',
        '........ookkkkkkkkkkoo........',
        '......ookkkkkwwwwkkkkkoo......',
        '....ookkkkkkwewwewkkkkkkoo....',
        '..ookkkkkkkkkwwwwkkkkkkkkkoo..',
        '.okkkkkkkkkkkkwwkkkkkkkkkkkko.',
        'oggggggggggggggggggggggggggggo',
        'oooooooooooooooooooooooooooooo',
      ], -4, { o: '#0b0a09', k: '#2a2724', w: '#efeee8', e: '#0b0a09', g: '#e3b94a' }, c)
    case 'gorro':      // gorro de lana con pompón y puño tejido
      return sprite([
        '...........oooo...........',
        '..........owwwwo..........',
        '......oooooowwoooooo......',
        '....ooaaaaaaaaaaaaaaoo....',
        '..ooahaaaaaaaaaaaaaaaaoo..',
        '.oahaaaaaaaaaaaaaaaaaaaao.',
        'owAwAwAwAwAwAwAwAwAwAwAwAo',
        'oooooooooooooooooooooooooo',
      ], -3.5, { o: mix(main, '#000000', 0.55), a: main, A: mix(main, '#000000', 0.25), h: mix(main, '#ffffff', 0.35), w: '#f1ede4' }, c)
    case 'corona':
      return sprite([
        'o..........oo..........o',
        'oo........oyyo........oo',
        'oyo......oyhyyo......oyo',
        'oyyo....oyyyyyyo....oyyo',
        'oyyyooooyyyrryyyooooyyyo',
        'oyybyyyyyyyrryyyyyyybyyo',
        'osssssssssssssssssssssso',
        'oooooooooooooooooooooooo',
      ], -3.5, { o: '#7a4f00', y: '#ffd23f', h: '#fff2a0', s: '#d99a12', r: '#e5484d', b: '#4f8df5' }, c)
    case 'moño':
      return sprite([
        'oo........oo',
        'obbo....obbo',
        'obhboooobbbo',
        'obbbokkobbbo',
        'obbboooobbso',
        'obbo....obso',
        'oo........oo',
      ], -2.5, { o: mix(bow, '#000000', 0.55), b: bow, h: mix(bow, '#ffffff', 0.45), s: mix(bow, '#000000', 0.2), k: mix(bow, '#000000', 0.35) }, c, 10)
    case 'audifonos':
      return sprite([
        '........oooooooooooooooooo........',
        '......ookkkkkkkkkkkkkkkkkkoo......',
        '.....okkoooooooooooooooooookko....',
        '....oko....................oko....',
        'ooooo.ko..................ok.ooooo',
        'occcco......................occcco',
        'ochcco......................ochcco',
        'occcco......................occcco',
        'oooooo......................oooooo',
      ], -1.5, { o: '#141312', k: '#3d3a37', c: '#29d3ff', h: '#a8f0ff' }, c)
    case 'calabaza':   // Halloween: calabaza con carita
      return sprite([
        '.........oo..........',
        '........ogg..........',
        '...oooooogoooooo.....',
        '..oaaahaaaaaaahaao...',
        '.oaahaaaaaaaaaaaaao..',
        '.oaaaeeaaaaaaeeaaao..',
        '.oaaaaaaaaaaaaaaaao..',
        '.oaaeaeaeaeaeaeaaao..',
        '..oaaaaaaaaaaaaaao...',
        '...oooooooooooooo....',
      ].map(r => r.padEnd(22, '.')), -5, { o: '#6b2f00', a: '#f08a24', h: '#ffc27a', e: '#2a1400', g: '#3f7a2a' }, c)
    case 'santa':      // Navidad: gorro de Santa
      return sprite([
        '....................oooo',
        '..........ooooooooo.owwo',
        '........oorrrrrrrrrooowo',
        '......oorrrhrrrrrrrrro..',
        '....oorrrhrrrrrrrrrrro..',
        '..oorrrrrrrrrrrrrrrrro..',
        'owwwwwwwwwwwwwwwwwwwwwwo',
        'owwwwwwwwwwwwwwwwwwwwwwo',
        'oooooooooooooooooooooooo',
      ], -4, { o: '#5c1410', r: '#d8392e', h: '#f26a5e', w: '#f6f3ec' }, c)
    case 'fiesta':     // gorrito de fiesta con rayas y pompón
      return sprite([
        '......oo......',
        '.....owwo.....',
        '......oo......',
        '.....oaao.....',
        '.....oyyo.....',
        '....oaaaao....',
        '....oyyyyo....',
        '...oaaaaaao...',
        '...oyyyyyyo...',
        '..oaaaaaaaao..',
        '..oooooooooo..',
      ], -5.5, { o: mix(main, '#000000', 0.55), a: main, y: '#ffd23f', w: '#f1ede4' }, c)
  }
  return ''
}

/** Burbujas y partículas de cada estado (en coordenadas de pantalla). */
function effects(v: View, headX: number, headY: number, cx: number, ground: number, accent: string): string {
  const r = rnd(7)
  let s = ''
  const rise = (x: number, y: number, dy: number, dur: number, begin: number, inner: string) =>
    `<g opacity="0" transform="translate(${x.toFixed(0)} ${y.toFixed(0)})">${inner}` +
    `<animateTransform attributeName="transform" type="translate" values="${x.toFixed(0)} ${y.toFixed(0)};${x.toFixed(0)} ${(y + dy).toFixed(0)}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>` +
    `<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.7;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></g>`
  switch (v.mood) {
    case 'think':
      s += `<circle cx="${headX + 4}" cy="${headY - 4}" r="3" fill="${CREAM}"/><circle cx="${headX + 12}" cy="${headY - 14}" r="5" fill="${CREAM}"/>` +
        `<rect x="${Math.min(headX + 16, 222)}" y="${headY - 44}" width="52" height="26" rx="10" fill="${CREAM}"/>` +
        [0, 1, 2].map(i => `<circle cx="${Math.min(headX + 16, 222) + 13 + i * 13}" cy="${headY - 31}" r="3.5" fill="${accent}"><animate attributeName="opacity" values="0.25;1;0.25" dur="1.2s" begin="${i * 0.25}s" repeatCount="indefinite"/></circle>`).join('')
      break
    case 'write': {
      // una hoja que se va llenando renglón por renglón: está escribiendo la respuesta
      const bx = Math.min(headX + 8, 214), by = headY - 50
      s += `<rect x="${bx}" y="${by}" width="62" height="40" rx="7" fill="${CREAM}"/>` +
        `<path d="M ${bx + 8} ${by + 40} l -6 9 l 14 -9 z" fill="${CREAM}"/>`
      ;[40, 30, 44].forEach((w, i) => {
        const t0 = (i / 3).toFixed(3), t1 = ((i + 1) / 3).toFixed(3)
        s += `<rect x="${bx + 9}" y="${by + 9 + i * 9}" width="0" height="4" rx="2" fill="${i === 1 ? accent : '#6b665e'}">` +
          `<animate attributeName="width" values="0;0;${w};${w};0" keyTimes="0;${t0};${t1};0.92;1" dur="2.4s" repeatCount="indefinite"/></rect>`
      })
      break
    }
    case 'work':
      for (let i = 0; i < 7; i++) s += rise(cx - 90 + r() * 180, 175, -60, 1.6, i * 0.23, `<text font-family="monospace" font-size="13" font-weight="bold" fill="${i % 2 ? CREAM : mix(accent, '#ffffff', 0.25)}">${esc(['{ }', '</>', '01', '=>', '( )', 'fn', '&&'][i])}</text>`)
      break
    case 'sleep':
      for (let i = 0; i < 3; i++) s += rise(headX + 6 + i * 8, headY - 4, -50, 3.9, i * 1.3, `<text font-family="monospace" font-weight="bold" font-size="${12 + i * 5}" fill="${CREAM}">z</text>`)
      break
    case 'love':
      for (let i = 0; i < 6; i++) s += rise(cx - 80 + r() * 160, headY, -70, 2, i * 0.33, `<path d="M3 1h3v3h3V1h3v3h3v6h-3v3h-3v3H6v-3H3v-3H0V4h3z" transform="scale(0.8)" fill="${HEART}"/>`)
      break
    case 'sad':
      for (let i = 0; i < 2; i++) s += rise(i ? cx + 42 : cx - 46, headY + 56, 30, 1.2, i * 0.55, `<rect width="4" height="6" fill="#6aa5e0"/>`)
      break
    case 'happy':
      for (let i = 0; i < 8; i++) s += rise(cx - 80 + r() * 160, headY + 10, -40, 1.4, i * 0.18, `<path d="M0 -4h2v3h3v2h-3v3h-2v-3h-3v-2h3z" fill="${i % 2 ? YELLOW : accent}"/>`)
      break
    case 'fine': {
      // «this is fine»: Clawd, tranquilo, con su taza de café (las llamas van al fondo)
      const mx = headX + 14, my = headY + 22
      s += `<rect x="${mx}" y="${my}" width="11" height="12" fill="${CREAM}"/><rect x="${mx + 11}" y="${my + 3}" width="4" height="6" fill="none" stroke="${CREAM}" stroke-width="2"/>`
      for (let i = 0; i < 2; i++) s += rise(mx + 2 + i * 5, my - 2, -16, 1.6, i * 0.7, `<rect width="2" height="5" fill="${MUTED}"/>`)
      break
    }
    case 'cinema': {
      // «absolute cinema»: el reflector cae sobre Clawd con los brazos arriba
      for (let i = 0; i < 6; i++) s += rise(cx - 90 + r() * 180, headY + 20, -30, 1.8, i * 0.3, `<path d="M0 -4h2v3h3v2h-3v3h-2v-3h-3v-2h3z" fill="${YELLOW}"/>`)
      break
    }
    case 'attention': {
      // «!» amarillo que rebota sobre la cabeza: te necesita
      const bx = Math.min(headX + 6, 236)
      s += `<g><animateTransform attributeName="transform" type="translate" values="0 -3;0 3;0 -3" dur="0.7s" repeatCount="indefinite"/>` +
        `<rect x="${bx}" y="${headY - 46}" width="30" height="36" rx="8" fill="${YELLOW}"/>` +
        `<rect x="${bx + 12}" y="${headY - 40}" width="6" height="16" fill="${EYE}"/><rect x="${bx + 12}" y="${headY - 21}" width="6" height="6" fill="${EYE}"/></g>`
      break
    }
    case 'vibe':
      for (let i = 0; i < 4; i++) s += rise(headX - 50 + i * 26, headY + 6, -24, 1.5, i * 0.35, `<path d="M0 -3h2v2h2v2h-2v2h-2v-2h-2v-2h2z" fill="${CREAM}"/>`)
      break
    case 'dizzy':
      for (let i = 0; i < 3; i++) s += `<path d="M-1 -5h3v4h4v3h-4v4h-3v-4h-4v-3h4z" fill="${YELLOW}"><animateMotion dur="1.25s" begin="-${(i * 0.42).toFixed(2)}s" repeatCount="indefinite" path="M ${cx + 70} ${headY - 14} A 70 9 0 1 1 ${cx - 70} ${headY - 14} A 70 9 0 1 1 ${cx + 70} ${headY - 14}"/></path>`
      break
  }
  return s
}

/** Lo que va detrás de Clawd: llamas, reflector, montañas. */
function backdrop(v: View, ground: number): string {
  const r = rnd(11)
  let s = ''
  switch (v.mood) {
    case 'fine':
      // «this is fine»: todo arde alrededor
      for (let i = 0; i < 12; i++) {
        const fx = 50 + i * 20 + r() * 8, fh = 16 + r() * 22, d = (0.35 + r() * 0.3).toFixed(2)
        s += `<rect x="${fx.toFixed(0)}" y="${(ground - fh).toFixed(0)}" width="9" height="${fh.toFixed(0)}" fill="${i % 3 ? FIRE : YELLOW}" opacity="0.85">` +
          `<animate attributeName="height" values="${fh.toFixed(0)};${(fh * 0.6).toFixed(0)};${fh.toFixed(0)}" dur="${d}s" repeatCount="indefinite"/>` +
          `<animate attributeName="y" values="${(ground - fh).toFixed(0)};${(ground - fh * 0.6).toFixed(0)};${(ground - fh).toFixed(0)}" dur="${d}s" repeatCount="indefinite"/></rect>`
      }
      break
    case 'cinema':
      s += `<polygon points="148,8 172,8 230,${ground} 90,${ground}" fill="${YELLOW}" opacity="0.12"><animate attributeName="opacity" values="0.08;0.2;0.08" dur="1.8s" repeatCount="indefinite"/></polygon>`
      break
    case 'walk':
      // las montañas al fondo
      s += `<polygon points="196,${ground} 234,${ground - 44} 262,${ground} " fill="#3a3734"/><polygon points="236,${ground} 262,${ground - 30} 290,${ground}" fill="#2f2c29"/>` +
        `<polygon points="226,${ground - 32} 234,${ground - 44} 242,${ground - 32}" fill="${CREAM}" opacity="0.7"/>`
      break
  }
  return s
}

/** Los subagentes: mini-Clawds de colores que orbitan la red neuronal, cada uno a su ritmo. */
function minions(n: number): string {
  if (n <= 0) return ''
  const cols = ['#6ac4e0', '#b59cf5', '#7fd67f', '#f5c451']
  // una corona: giran alrededor de la cabeza de Clawd, más grandes que la red para que se lean en mini
  const R = 96, RY = 20, dur = 7
  const path = `M ${R} 0 A ${R} ${RY} 0 1 1 ${-R} 0 A ${R} ${RY} 0 1 1 ${R} 0`
  let s = '<g transform="translate(160 54)">'
  for (let i = 0; i < Math.min(n, 4); i++) {
    const col = cols[i], dark = mix(col, '#000000', 0.3)
    // cuerpo pixel de 8×5 con ojitos y patitas; rebota mientras orbita
    s += `<g><animateMotion dur="${dur}s" begin="-${((dur * i) / Math.min(n, 4)).toFixed(2)}s" repeatCount="indefinite" path="${path}"/>` +
      `<g transform="scale(1.7)"><g>${tween('translate', [['0 0', OUT], ['0 -4', IN], ['0 0']], 0.5, ` begin="${(i * 0.13).toFixed(2)}s"`)}` +
      `<rect x="-8" y="-10" width="16" height="9" fill="${col}"/><rect x="-11" y="-6" width="3" height="3" fill="${col}"/><rect x="8" y="-6" width="3" height="3" fill="${col}"/>` +
      `<rect x="-4" y="-7" width="2" height="3" fill="${EYE}"/><rect x="2" y="-7" width="2" height="3" fill="${EYE}"/>` +
      `<rect x="-6" y="-1" width="2" height="3" fill="${dark}"/><rect x="-2" y="-1" width="2" height="3" fill="${dark}"/><rect x="2" y="-1" width="2" height="3" fill="${dark}"/><rect x="6" y="-1" width="2" height="3" fill="${dark}"/>` +
      `</g></g></g>`
  }
  return s + '</g>'
}

/** El huevo: pixel art generado (elipse con contorno, manchas del color del pet, brillo y grieta). */
function egg(body: string, c: number, cracked: boolean): string {
  const W = 14, H = 18, rows: string[] = []   // 7×9 celdas: como el cuerpo de Clawd
  for (let j = 0; j < H; j++) {
    let row = ''
    for (let i = 0; i < W; i++) {
      const x = (i + 0.5 - W / 2) / (W / 2), yy = (j + 0.5 - H * 0.56) / (H * 0.56)
      const k = x * x + (yy < 0 ? yy * yy * 0.78 : yy * yy)   // más angosto arriba
      const edge = x * x + (yy < 0 ? yy * yy * 0.78 : yy * yy) > 0.78
      if (k > 1) row += '.'
      else if (edge) row += 'o'
      else if ((i - 4) ** 2 + (j - 10) ** 2 < 3 || (i - 9) ** 2 + (j - 6) ** 2 < 2.5 || (i - 9) ** 2 + (j - 13) ** 2 < 2) row += 'b'
      else if ((i - 4) ** 2 + (j - 4) ** 2 < 2) row += 'h'
      else if (x > 0.45 && yy > 0) row += 's'
      else row += 'e'
    }
    if (cracked && j >= 6 && j <= 8) row = row.split('').map((ch, i) => ch === 'e' && Math.abs(i - (7 + (j % 2 ? 1 : -1))) < 1 ? 'k' : ch).join('')
    rows.push(row)
  }
  return sprite(rows, 9 - H * 0.5, { o: '#5c5040', e: '#f3ead8', s: '#d9ccb2', h: '#ffffff', b: body, k: '#5c5040' }, c)
}

/** Sensei: una capa morada con borde dorado que ondea detrás del cuerpo. */
function cape(c: number): string {
  const rows: string[] = []
  for (let j = 0; j < 13; j++) {
    const w = 28 + Math.round(j * 0.5) * 2                 // se abre hacia abajo; termina a la altura del cuerpo
    rows.push(j === 12 ? 'g'.repeat(w) : 'o' + (j % 4 === 1 ? 'C' : 'c').repeat(w - 2) + 'o')
  }
  const g = sprite(rows, 1, { o: '#1f1438', c: '#4b2f8f', C: '#5a3aa6', g: '#e3b94a' }, c)
  return `<g>${tween('scale', [['1 1', EASE], ['1.04 1', EASE], ['1 1']], 1.8)}${g}</g>`
}

/** Deidad del Código: alas que aletean (detrás) y aureola dorada (encima). */
function wings(c: number): string {
  const L = [
    '..........oooo..',
    '......oooowwwwo.',
    '...oooowwwwwwwo.',
    '.oowwwwwwwwwwwo.',
    'owwwwwwwwwwwwwo.',
    'owwswwwswwwwwwo.',
    '.owwswwwswwwwo..',
    '..owwswwwswwo...',
    '...oowwswwo.....',
    '.....ooooo......',
  ]
  const pal = { o: '#8a6a1c', w: '#fbf6e6', s: '#e2c97a' }
  const px = (gx: number) => ((gx - 8) * c).toFixed(1), py = ((3 - 9) * c).toFixed(1)
  const flap = (pivot: number, dir: number) =>
    `<animateTransform attributeName="transform" type="rotate" values="0 ${px(pivot)} ${py};${dir * 14} ${px(pivot)} ${py};0 ${px(pivot)} ${py}" dur="1.1s" calcMode="spline" keySplines="${EASE};${EASE}" keyTimes="0;0.5;1" repeatCount="indefinite"/>`
  return `<g>${flap(2, 1)}${sprite(L, 0.5, pal, c, -6)}</g>` +
    `<g>${flap(14, -1)}${sprite(L.map(r => [...r].reverse().join('')), 0.5, pal, c, 14)}</g>`
}

function halo(c: number): string {
  const y = ((-2.6 - 9) * c).toFixed(1)
  return `<g>${tween('translate', [['0 0', EASE], ['0 -3', EASE], ['0 0']], 2.4)}` +
    `<ellipse cx="0" cy="${y}" rx="${(4.4 * c).toFixed(1)}" ry="${(1.1 * c).toFixed(1)}" fill="none" stroke="#8a6a1c" stroke-width="${(0.9 * c).toFixed(1)}"/>` +
    `<ellipse cx="0" cy="${y}" rx="${(4.4 * c).toFixed(1)}" ry="${(1.1 * c).toFixed(1)}" fill="none" stroke="#ffd23f" stroke-width="${(0.5 * c).toFixed(1)}"><animate attributeName="stroke" values="#ffd23f;#fff2a0;#ffd23f" dur="1.6s" repeatCount="indefinite"/></ellipse></g>`
}

/** Ninja y Samurái: bufanda roja con las puntas al viento (se mueve con el cuerpo). */
function scarf(c: number): string {
  const pal = { o: '#5c1410', r: '#d8392e', R: '#a2241d' }
  const band = sprite([
    'oooooooooooooooooooooooooo',
    'orrrrrrrrrrrrrrrrrrrrrrrro',
    'oRRRRRRRRRRRRRRRRRRRRRRRRo',
    'oooooooooooooooooooooooooo',
  ], 4.6, pal, c)
  const tails = sprite([
    'oooooo..',
    'orrrrroo',
    '.oRRrrro',
    '..oooooo',
    '...orrro',
    '....oooo',
  ], 5, pal, c, -1.8)
  const pivot = `${((1 - 8) * c).toFixed(1)} ${((5.5 - 9) * c).toFixed(1)}`
  return band + `<g><animateTransform attributeName="transform" type="rotate" values="0 ${pivot};-12 ${pivot};0 ${pivot}" dur="0.9s" repeatCount="indefinite"/>${tails}</g>`
}

/** Hacker: lluvia de código verde, tenue, detrás. */
function codeRain(): string {
  const r = rnd(5)
  let s = ''
  for (let i = 0; i < 9; i++) {
    const x = 70 + i * 22, d = (1.6 + r() * 1.6).toFixed(2), b = (r() * 2).toFixed(2)
    s += `<text x="${x}" font-family="monospace" font-size="11" fill="#5cff8a" opacity="0">${['1', '0', '{', '}', ';', '<', '>', '$', '#'][i]}` +
      `<animate attributeName="y" values="20;180" dur="${d}s" begin="${b}s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0;0.55;0" dur="${d}s" begin="${b}s" repeatCount="indefinite"/></text>`
  }
  return s
}

/** Samurái en adelante: orbes de energía de su color que giran a su alrededor. */
function orbs(color: string, ground: number): string {
  // órbita más ancha que el cuerpo y orbes chicos: brillan alrededor sin taparle la cara
  const path = `M 100 0 A 100 20 0 1 1 -100 0 A 100 20 0 1 1 100 0`
  return `<g transform="translate(160 ${ground - 24})">` + [0, 1, 2, 3].map(i =>
    `<circle r="4" fill="${mix(color, '#ffffff', 0.55)}" stroke="${color}" stroke-width="1.5" opacity="0.95"><animateMotion dur="3.2s" begin="-${(i * 0.8).toFixed(2)}s" repeatCount="indefinite" path="${path}"/>` +
    `<animate attributeName="r" values="3.5;5;3.5" dur="1.2s" repeatCount="indefinite"/></circle>`).join('') + '</g>'
}

/** Maestro y Deidad: rayos de luz que giran detrás. */
function rays(color: string, ground: number): string {
  let s = `<g transform="translate(160 ${ground - 32})" opacity="0.18"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="24s" repeatCount="indefinite" additive="sum"/>`
  for (let i = 0; i < 12; i++) s += `<polygon points="0,0 -6,-96 6,-96" fill="${color}" transform="rotate(${i * 30})"/>`
  return s + '</g>'
}

/** La escena de 320×240: mente circular, Clawd y efectos. */
function stage(v: View, prefs: Prefs = defaultPrefs(), st: StageId = 'aprendiz'): string {
  const body = v.shiny ? '#f2c14e' : prefs.color   // shiny: dorado
  const ground = 138
  // con «/pet atuendo off» desde el nivel 5 se ve como el 4: sin bufanda, orbes, capa, rayos, alas ni aureola
  const n = Math.min(STAGES.findIndex(x => x.id === st) + 1, prefs.stageLook === false ? 4 : 99)    // 1..11
  const c = st === 'cria' ? 5 : 7                    // la cría es más chiquita
  const busy = v.mood === 'think' || v.mood === 'work' || v.mood === 'write'
  const tier = /opus|fable/i.test(v.model) ? 2 : 1   // el modelo define el tamaño de la mente
  if (st === 'huevo') {
    // el huevo se tambalea; con actividad se agrieta un poco
    return `<g shape-rendering="geometricPrecision">${mind(body, tier, v.talking, busy)}</g>` +
      `<g transform="translate(160 ${ground})"><ellipse cx="0" cy="3" rx="${(c * 4).toFixed(1)}" ry="4" fill="#000" opacity="0.3"/><g>` +
      `<animateTransform attributeName="transform" type="rotate" values="0;-6;0;6;0;0" keyTimes="0;0.1;0.2;0.3;0.4;1" dur="${busy ? 1.6 : 3.4}s" repeatCount="indefinite"/>` +
      `${egg(body, c, busy || v.mood === 'attention')}</g></g>` +
      `<g shape-rendering="geometricPrecision">${effects(v, 160 + 4 * c, ground - 9 * c, 160, ground, body)}</g>`
  }
  // lo que se suma por etapa: 4 código · 5 aura · 6 orbes · 7 capa · 8 rayos · 9 alas doradas · 10 aureola y destellos · 11 arcoíris
  const gold = n >= 9
  const auraCol = gold ? '#ffd23f' : body
  const aura = n >= 5
    ? `<circle cx="160" cy="${ground - 32}" r="58" fill="${auraCol}" opacity="0.14"><animate attributeName="r" values="52;62;52" dur="2.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="${n >= 7 ? '0.12;0.26;0.12' : '0.06;0.16;0.06'}" dur="2.6s" repeatCount="indefinite"/></circle>`
    : ''
  const sparkles = n >= 10 || v.shiny ? [0, 1, 2, 3, 4].map(i => `<path d="M0 -4h2v3h3v2h-3v3h-2v-3h-3v-2h3z" fill="#ffe680" opacity="0"><animateTransform attributeName="transform" type="translate" values="${110 + i * 24} ${ground - 10};${116 + i * 24} ${ground - 80}" dur="2.2s" begin="${i * 0.4}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="2.2s" begin="${i * 0.4}s" repeatCount="indefinite"/></path>`).join('') : ''
  const back = (n === 4 ? codeRain() : '') + (n >= 8 ? rays(gold ? '#ffd23f' : body, ground) : '') + aura
  const behind = n >= 9 ? wings(c) : n >= 7 ? cape(c) : ''
  const scene = `<g shape-rendering="geometricPrecision">${back}${mind(body, tier, v.talking, busy)}${backdrop(v, ground)}</g>` +
    `<g transform="translate(160 ${ground})" shape-rendering="crispEdges">${behind}</g>` +
    `<g transform="translate(160 ${ground})">${clawd(v, c, body, prefs.accessory, n === 5 || n === 6 ? scarf(c) : '')}</g>` +
    (n >= 10 ? `<g transform="translate(160 ${ground})">${halo(c)}</g>` : '') +
    (n >= 6 ? `<g shape-rendering="geometricPrecision">${orbs(gold ? '#ffd23f' : body, ground)}</g>` : '') +
    `<g shape-rendering="crispEdges">${minions(v.agents)}</g>` +
    `<g shape-rendering="geometricPrecision">${sparkles}${effects(v, 160 + 6 * c, ground - 9 * c, 160, ground, body)}</g>`
  if (n < 11) return scene
  return `<defs><filter id="rainbow"><feColorMatrix type="hueRotate" values="0"><animate attributeName="values" values="0;360" dur="4s" repeatCount="indefinite"/></feColorMatrix></filter></defs><g filter="url(#rainbow)">${scene}</g>`
}

export const COLORS = { ORANGE, CREAM, MUTED }

// ======================= radar: las otras conversaciones =======================
// Las últimas 3 conversaciones con actividad REAL en la última hora (le escribiste, usó herramientas
// o terminó un turno), con su estado. Las recién abiertas, sin nada aún, no aparecen.
export const ALIVE_MS = 45_000        // sin señal en este tiempo, la conversación se da por cerrada
export const RECENT_MS = 3_600_000    // ventana de actividad: una hora
export const RADAR_MAX = 3
const GREEN = '#7fd67f', VIOLET = '#b59cf5'

/** «ahora», «4m», «1h 05m». */
export function fmtAgo(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'ahora' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

const hace = (ms: number) => { const t = fmtAgo(ms); return t === 'ahora' ? 'ahora' : `hace ${t}` }

/** Las 3 conversaciones más recientes (actividad en la última hora), ya con su texto. */
export function radarItems(others: Other[], now: number, selfId: string): RadarItem[] {
  const recent = others
    .map(o => ({ ...o, activeAt: o.activeAt || Math.max(o.busySince || 0, o.doneAt || 0) }))
    .filter(o => o.id !== selfId && now - o.at < ALIVE_MS && o.activeAt > 0 && now - o.activeAt < RECENT_MS)
    .sort((a, b) => Number(b.mood === 'attention') - Number(a.mood === 'attention') || b.activeAt - a.activeAt)
    .slice(0, RADAR_MAX)
  return recent.map(o => {
    const title = cut(o.topic || 'Conversación nueva', 30), project = cut(o.project || 'Claude', 16)
    if (o.mood === 'attention') return { id: o.id, kind: 'need' as const, title, project, status: `te necesita · ${cut(o.say || 'revisa', 26)}`, color: YELLOW }
    if (o.busySince > 0) {
      const [what, color] = o.mood === 'think' ? ['pensando', VIOLET]
        : o.mood === 'write' ? ['escribiendo', ORANGE]
        : o.mood === 'sad' || o.mood === 'fine' ? ['con errores', HEART]
        : o.mood === 'dizzy' ? ['compactando', MUTED]
        : [o.say ? cut(o.say.replace(/^\$ /, ''), 24) : 'trabajando', YELLOW]
      return { id: o.id, kind: 'busy' as const, title, project, status: `${what} · ${fmtAgo(now - o.busySince)}`, color }
    }
    if (o.doneAt > 0) return { id: o.id, kind: 'done' as const, title, project, status: `te espera · terminó ${hace(now - o.doneAt)}`, color: GREEN }
    return { id: o.id, kind: 'idle' as const, title, project, status: `en pausa · ${hace(now - o.activeAt)}`, color: MUTED }
  })
}

/** Lo que cambia el dibujo de Clawd: si no cambia, el Svg no se toca y su animación sigue corriendo. */
export function petKey(v: View, prefs: Prefs = defaultPrefs(), st: StageId = 'aprendiz'): string {
  return `${v.mood}|${v.talking ? 1 : 0}|${/opus|fable/i.test(v.model) ? 2 : 1}|${Math.min(v.agents, 4)}|${prefs.color}|${prefs.accessory}|${st}|${v.shiny ? 1 : 0}|${prefs.stageLook === false ? 0 : 1}`
}

/** Clawd con su red neuronal circular, solo (los textos van aparte, como texto nativo). */
export function petScene(v: View, prefs: Prefs = defaultPrefs(), st: StageId = 'aprendiz'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 12 240 186" width="110" height="84" shape-rendering="crispEdges" overflow="hidden">${stage(v, prefs, st)}</svg>`
}

/** La tarjeta para compartir (1200×630, el formato de imagen de X): tu pet, su nivel, estadísticas y logros. */
export function cardSvg(v: View, prefs: Prefs, p: Progress): string {
  const st = stageOf(p.tokens), lvl = levelOf(p.tokens)
  const next = STAGES.find(x => x.min > p.tokens && !x.secret)
  const prevMin = st.min, span = next ? next.min - prevMin : 1
  const frac = next ? Math.min(1, (p.tokens - prevMin) / span) : 1
  const inner = stage({ ...v, mood: 'idle', say: '', talking: false, agents: 0 }, prefs, st.id)
  const stat = (x: number, label: string, val: string | number) =>
    `<text x="${x}" y="430" font-size="44" font-weight="700" fill="#f0eee6">${esc(String(val))}</text><text x="${x}" y="462" font-size="20" fill="#9a968d">${esc(label)}</text>`
  const got = ACHIEVEMENTS.filter(a => p.achievements.includes(a.id))
  const visible = ACHIEVEMENTS.filter(a => !a.secret).length
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" font-family="Segoe UI, system-ui, sans-serif">`
  s += `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#211f1d"/><stop offset="1" stop-color="#151413"/></linearGradient></defs>`
  s += `<rect width="1200" height="630" fill="url(#bg)"/><rect x="0" y="0" width="1200" height="8" fill="${prefs.color}"/>`
  s += `<svg x="40" y="70" width="520" height="440" viewBox="40 12 240 186" shape-rendering="crispEdges">${inner}</svg>`
  s += `<text x="600" y="150" font-size="76" font-weight="800" fill="${prefs.color}">${esc(prefs.name)}</text>`
  s += `<text x="604" y="200" font-size="30" fill="#f0eee6">Nivel ${lvl}${lvl > 10 ? '' : '/10'} · ${esc(st.name)}${v.shiny ? ' · shiny' : ''}${prefs.accessory !== 'ninguno' && st.id !== 'huevo' ? ` · ${esc(prefs.accessory)}` : ''}</text>`
  s += `<rect x="604" y="226" width="520" height="12" rx="6" fill="#33302c"/><rect x="604" y="226" width="${(520 * frac).toFixed(0)}" height="12" rx="6" fill="${prefs.color}"/>`
  s += `<text x="604" y="268" font-size="20" fill="#9a968d">${fmtBig(p.tokens)} tokens${next ? ` · ${fmtBig(next.min - p.tokens)} para ${esc(next.name)}` : ' · forma final'}</text>`
  s += stat(604, 'turnos', p.turns) + stat(784, 'archivos', p.edits) + stat(964, 'subagentes', p.agents)
  s += `<text x="604" y="356" font-size="22" fill="#9a968d">racha: ${p.streak} día${p.streak === 1 ? '' : 's'} · ${p.tools} herramientas · ${p.praises} gracias</text>`
  s += `<text x="604" y="516" font-size="20" fill="#9a968d">Logros (${got.length}/${visible})</text>`
  got.slice(0, 6).forEach((a, i) => {
    const x = 604 + (i % 3) * 180, y = 562 + Math.floor(i / 3) * 40
    s += `<rect x="${x}" y="${y - 22}" width="170" height="30" rx="15" fill="#2c2926"/><text x="${x + 14}" y="${y - 1}" font-size="17" fill="#f5c451">★ ${esc(cut(a.name, 16))}</text>`
  })
  s += `<text x="40" y="600" font-size="22" fill="#6b665e">Claude Pet · mi compañero de Claude Code</text>`
  return s + '</svg>'
}
