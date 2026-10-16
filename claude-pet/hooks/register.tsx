// claude-pet — Clawd vive arriba del chat: una banda mini con Clawd, su red neuronal circular,
// el proyecto y su rama, los datos útiles de la sesión y lo que está haciendo ahora mismo.
// Radar: cada conversación deja su estado en ~/.claude/claude-pet/sesiones/<id>.json y lee el de
// las demás (las últimas 3 con actividad real; «te necesita» primero). Nada sale de tu PC.
// Personalización con /pet (nombre, color, accesorio, sonido, memes, radar), guardada en $.store.
import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Mood, Other, Prefs, Progress, RadarItem, View } from '../types'
import { ACHIEVEMENTS, ALIVE_MS, COLORS, PET_HELP, STAGES, easterEgg, fmtBig, seasonal, applyPetCommand, award, cardSvg, cleanPrefs, cleanProgress, defaultPrefs, defaultProgress, levelOf, stageOf, toneOf, clockAt, describeTool, filesLine, fmtDuration, taskLine, initialView, metaParts, petKey, petScene, prettyModel, radarItems, setMood, tick } from './scene'

const view = atom({ plugin: 'claude-pet', key: 'view' } as const, initialView())
const hidden = atom({ plugin: 'claude-pet', key: 'hidden' } as const, false)  // /pet lo oculta o lo muestra
const others = atom({ plugin: 'claude-pet', key: 'others' } as const, [] as RadarItem[])
const prefs = atom({ plugin: 'claude-pet', key: 'prefs' } as const, defaultPrefs())
const progress = atom({ plugin: 'claude-pet', key: 'progress' } as const, defaultProgress())

/** Suma experiencia (guardada para todas las conversaciones) y celebra logros y evoluciones. */
async function gain($: Engine, e: Parameters<typeof award>[1]) {
  try {
    const saved = cleanProgress(await $.store.get('progress'))   // la última versión: otras conversaciones también suman
    const before = stageOf(saved.tokens)
    const [np, got] = award(saved, e)
    await $.store.set('progress', np)
    await update($, progress, () => np)
    const after = stageOf(np.tokens)
    const name = (await read($, prefs)).name
    if (after.id !== before.id) {
      await show($, 'happy', `¡${name} evolucionó a ${after.name}!`)
      void chime($, 'listo')
    } else if (got.length) {
      await show($, 'happy', `Logro: ${got[0].name} · ${got[0].desc}`)
      void chime($, 'listo')
    }
  } catch { /* sin almacén: la evolución espera */ }
}

// comentarios de la IA (solo con «/pet comentarios on»): una frase corta, como mucho una por minuto
let quipAt = 0
let recent: string[] = []
const QUIP_EVERY_MS = 60_000
async function comment($: Engine, force = false) {
  try {
    const pr = await read($, prefs)
    if (!pr.comments || !recent.length) return
    const now = await $.clock.now()
    if (!force && now - quipAt < QUIP_EVERY_MS) return
    quipAt = now
    const r = await $.model.complete({
      model: 'haiku',
      maxTokens: 40,
      system: `Eres ${pr.name}, una mascota pixel art que vive arriba del chat de Claude Code. Comentas lo que hace Claude en UNA frase de máximo 9 palabras, en español, graciosa y amable, estilo streamer. Sin emojis, sin comillas.`,
      prompt: `Lo último que hizo Claude:\n${recent.slice(-6).join('\n')}`,
    })
    if (r.isAnswered && r.text.trim()) {
      const quip = r.text.trim().replace(/^["«]|["»]$/g, '').slice(0, 80)
      await update($, view, v => ({ ...v, quip }))
    }
  } catch { /* sin modelo disponible: sin comentarios */ }
}

/** /pet tarjeta: guarda la tarjeta en el Escritorio (PNG en Windows con Edge; si no, SVG). */
async function makeCard($: Engine): Promise<string> {
  const v = await read($, view), pr = await read($, prefs)
  const pg = cleanProgress(await $.store.get('progress'))
  const svg = cardSvg(v, pr, pg)
  const root = String($.plugin.root).replace(/\\/g, '/')
  const home = root.match(/^([A-Za-z]:\/Users\/[^/]+|\/home\/[^/]+|\/Users\/[^/]+)\//)?.[1] ?? root
  const base = `${home}/Desktop/claude-pet-${pr.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'pet'}`
  await $.fs.write(`${base}.svg`, svg)
  if (/^[A-Za-z]:/.test(home)) {
    try {
      await $.fs.write(`${base}.html`, `<!doctype html><html><body style="margin:0;background:#151413">${svg}</body></html>`)
      const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      const r = await $.process.run([edge, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-first-run', `--screenshot=${base.replace(/\//g, '\\')}.png`, '--window-size=1200,630', `file:///${base}.html`], { timeoutMs: 30_000 })
      if (r.exitCode === 0) return `${base}.png`.replace(/\//g, '\\')
    } catch { /* sin Edge: queda el SVG */ }
  }
  return `${base}.svg`
}

// segundo plano: procesos que Claude dejó corriendo y cuándo se despierta solo
let background = 0
let wakeAt = ''
let needing = false     // está esperando algo de ti (permiso, pregunta, plan)
const pendingAsks = new Set<string>()   // llamadas (tool_use_id) que esperan permiso
let callSeq = 0
const ASK_DELAY_MS = 4000   // en modo auto el permiso se resuelve solo antes de esto

/** Campanita (solo con «/pet sonido on»); si el sistema no puede reproducirla, no pasa nada. */
async function chime($: Engine, which: 'necesita' | 'listo') {
  try {
    if (!(await read($, prefs)).sound) return
    const root = String($.plugin.root)
    if (/^[A-Za-z]:[\\/]/.test(root)) {
      // Windows: el reproductor de audio de la API no suena aquí; se usa el del sistema
      const wav = `${root}\\sounds\\${which}.wav`.replace(/\//g, '\\').replace(/'/g, "''")
      await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer '${wav}').PlaySync()`], { timeoutMs: 10_000 })
    } else {
      await $.audio.play({ asset: `sounds/${which}.wav` })
    }
  } catch { /* sin reproductor de audio en este sistema */ }
}

/** Borra del radar los archivos de conversaciones cerradas o viejas (más de un día sin señal). */
async function cleanRadar($: Engine) {
  try {
    const d = await sessionsDir($)
    const now = await $.clock.now()
    const stale: string[] = []
    for (const f of await $.fs.list(d)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name === `${selfId}.json`) continue
      try {
        const o = JSON.parse(await $.fs.read(`${d}/${f.name}`)) as Other
        if (!(o.at > 0) || now - o.at > 86_400_000) stale.push(`${d}/${f.name}`)
      } catch { stale.push(`${d}/${f.name}`) }
    }
    if (!stale.length) return
    if (/^[A-Za-z]:/.test(d)) {
      const list = stale.map(x => `'${x.replace(/\//g, '\\').replace(/'/g, "''")}'`).join(',')
      await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath ${list} -Force -ErrorAction SilentlyContinue`], { timeoutMs: 15_000 })
    } else {
      await $.process.run(['rm', '-f', ...stale], { timeoutMs: 15_000 })
    }
  } catch { /* la limpieza es opcional */ }
}

/** Te necesita: Clawd en alerta, aviso en el radar de las demás y campanita. */
async function needYou($: Engine, text: string) {
  if (needing) return
  needing = true
  await show($, 'attention', text)
  await publish($)
  void chime($, 'necesita')
}

/** Ya respondiste: vuelve a trabajar. */
async function answered($: Engine, text: string) {
  if (!needing) return
  needing = false
  await show($, 'think', text)
}

// lo que se cuenta en el turno (no se dibuja: cambiarlo no redibuja)
let turnStart = 0
let tools = 0
let errors = 0
let edited = new Set<string>()
let model = ''

// la lista de tareas de Claude (TaskCreate / TaskUpdate) y los subagentes en vuelo
type Task = { subject: string; active: string; status: string }
let tasks = new Map<string, Task>()
let taskSeq = 0
let agents = 0
let agentNow = ''

function taskFields(): Partial<View> {
  const list = [...tasks.values()]
  const now = list.find(t => t.status === 'in_progress')
  return {
    tasksTotal: list.length, tasksDone: list.filter(t => t.status === 'completed').length,
    taskNow: now ? now.active || now.subject : '', agents, agentNow, background, wakeAt,
  }
}

/** Escribe tareas y subagentes en la vista (sin tocar el estado de Clawd). */
async function syncWork($: Engine) {
  const f = taskFields()
  await update($, view, v => {
    const w = { ...v, ...f }
    return visual(w) === visual(v) ? v : w
  })
}

/** «/pet demo»: pasa por todas las animaciones, ~4 s cada una, y deja todo como estaba. */
async function demo($: Engine) {
  const steps: [Mood, string, Partial<View>][] = [
    ['idle', 'Demo · así te espera', {}],
    ['think', 'Demo · pensando', {}],
    ['write', 'Demo · escribiendo la respuesta', {}],
    ['work', 'Demo · Editando register.tsx', {}],
    ['work', 'Demo · subagentes en corona', { agents: 3, agentNow: 'Explorando el repo' }],
    ['work', 'Demo · lista de tareas', { tasksTotal: 7, tasksDone: 3, taskNow: 'Implementando el radar' }],
    ['attention', 'Necesita tu permiso · Bash', {}],
    ['love', '¡Aww, gracias! (le dijiste gracias)', {}],
    ['sad', '¿Por qué me gritas? :(', {}],
    ['work', 'Demo · segundo plano', { background: 2, wakeAt: '18:40' }],
    ['vibe', 'Vibe coding · 15 pasos sin errores', {}],
    ['fine', 'This is fine · 3 errores', {}],
    ['cinema', 'Absolute cinema · 6 archivos', {}],
    ['walk', 'Me voy a las montañas…', {}],
    ['sad', 'Demo · una herramienta falló', {}],
    ['dizzy', 'Demo · compactando memoria', {}],
    ['sleep', 'Demo · dormido (tras 90 s sin actividad)', {}],
  ]
  for (const [mood, say, extra] of steps) {
    await show($, mood, say)
    const f = { ...taskFields(), ...extra }
    await update($, view, v => ({ ...v, ...f }))
    await $.clock.sleep(mood === 'walk' ? 4500 : 3800)
  }
  await show($, 'idle', 'Demo terminada', true)
  await syncWork($)
}

// radar
let selfId = ''
let dir = ''
let topic = ''          // de qué trata esta conversación (su primer mensaje)
let topicTried = false
let doneAt = 0          // terminó su turno y no le has vuelto a escribir
let activeAt = 0        // la última vez que pasó algo aquí
let published = ''      // lo último que se escribió (si no cambia, solo late cada 15 s)
let beatAt = 0
let ticks = 0
const BEAT_MS = 15_000

/** Lo que se ve (sin relojes internos): si no cambia, la banda no se redibuja (evita el parpadeo). */
function visual(v: View): string {
  const { lastActivity, until, base, baseSay, ...seen } = v
  return JSON.stringify(seen)
}

/** Los datos de la sesión: contexto, costo, límite de 5 h, proyecto y rama. */
async function meta($: Engine): Promise<Partial<View>> {
  const out: Partial<View> = {}
  try {
    const u = await $.session.usage()
    out.pct = u.context.percent ?? -1
    out.tokens = u.context.tokens ?? -1
    out.window = u.context.window ?? 0
    const five = u.rateLimits.find(r => /five|5h|5_hour/i.test(r.kind))
    const week = u.rateLimits.find(r => /seven|week|7d|7_day/i.test(r.kind))
    out.limit5h = five ? five.percentUsed : -1
    out.reset5h = five ? clockAt(five.resetsAt) : ''
    out.week = week ? week.percentUsed : -1
  } catch { /* sin datos de uso todavía */ }
  try {
    const cwd = String(await $.session.cwd())
    out.project = cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''
    if (!(await $.fs.exists(`${cwd}/.git/HEAD`))) throw new Error('sin git')
    const head = (await $.fs.read(`${cwd}/.git/HEAD`)).trim()
    out.branch = head.startsWith('ref:') ? head.split('/').slice(2).join('/') : head.slice(0, 7)
  } catch { out.branch = '' }
  if (model) out.model = model
  return out
}

/** Cambia el estado (y, si se pide, los datos de la sesión) en una sola escritura: un solo redibujado. */
async function show($: Engine, mood: Mood, say?: string, withMeta = false) {
  const now = (await $.clock.now())
  const m = withMeta ? await meta($) : {}
  await update($, view, v => {
    const w = { ...setMood(v, mood, now, say), ...m }
    return visual(w) === visual(v) ? { ...v, lastActivity: now } : w
  })
}

// el paso del tiempo: lo momentáneo termina y, sin actividad, Clawd se duerme; el radar late y mira
async function poll($: Engine) {
  const now = (await $.clock.now())
  await update($, view, v => {
    const w = tick(v, now)
    return visual(w) === visual(v) ? v : w
  })
  await publish($)
  if (++ticks % 2 === 0) await scan($)
}

/** La carpeta compartida por todas las conversaciones: ~/.claude/claude-pet/sesiones. */
async function sessionsDir($: Engine): Promise<string> {
  if (!dir) {
    // la carpeta de usuario sale de la ruta del plugin (C:/Users/<tú>/…, /home/<tú>/…, /Users/<tú>/…)
    const root = String($.plugin.root).replace(/\\/g, '/')
    const home = root.match(/^([A-Za-z]:\/Users\/[^/]+|\/home\/[^/]+|\/Users\/[^/]+)\//)?.[1]
    dir = home ? `${home}/.claude/claude-pet/sesiones` : `${root}/.radar`
  }
  return dir
}

/** «Arregla el sensor de luz…»: el primer mensaje de la conversación, limpio. */
function cleanTopic(text: string): string {
  return text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/[#*`>_\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

async function resolveTopic($: Engine) {
  if (topic || topicTried) return
  topicTried = true
  try {
    // el primer mensaje tuyo de verdad: se salta el resumen que deja una compactación y los avisos del sistema
    const isMine = (t: string) => !!cleanTopic(t) && !/^\s*(This session is being continued|<(system|command|local-command))/i.test(t)
    const first = (await $.session.messages()).find(m => m.role === 'user' && isMine(m.text))
    if (first) topic = cleanTopic(first.text)
  } catch { /* sin historial todavía */ }
}

/** Deja el estado de esta conversación para las demás (solo si cambió, o cada 15 s para decir «sigo viva»). */
async function publish($: Engine, closing = false) {
  try {
    if (!selfId) selfId = String(await $.session.id())
    await resolveTopic($)
    const v = await read($, view)
    const now = (await $.clock.now())
    const sig = `${v.mood}|${v.say}|${topic}|${v.project}|${turnStart}|${doneAt}`
    if (!closing && sig === published && now - beatAt < BEAT_MS) return
    published = sig; beatAt = now
    const me: Other = { id: selfId, project: v.project, topic, mood: v.mood, say: v.say, at: closing ? 0 : now, busySince: turnStart, doneAt, activeAt }
    await $.fs.write(`${await sessionsDir($)}/${selfId}.json`, JSON.stringify(me))
  } catch { /* sin carpeta todavía: el radar espera */ }
}

/** Lee el estado de las otras conversaciones; solo redibuja si algo visible cambió. */
async function scan($: Engine) {
  try {
    const d = await sessionsDir($)
    const now = (await $.clock.now())
    const found: Other[] = []
    for (const f of await $.fs.list(d)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name === `${selfId}.json`) continue
      try {
        const o = JSON.parse(await $.fs.read(`${d}/${f.name}`)) as Other
        if (now - o.at < ALIVE_MS) found.push(o)
      } catch { /* a medio escribir: la próxima vuelta */ }
    }
    const list = radarItems(found, now, selfId)   // los textos llevan los minutos: cambia una vez por minuto
    await update($, others, prev => JSON.stringify(prev) === JSON.stringify(list) ? prev : list)
  } catch { /* la carpeta aún no existe */ }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pet', description: 'Claude Pet · /pet ayuda: nombre, color, accesorio, sonido, demo…' })
    await update($, view, v => ({ ...initialView(), ...v }))  // un estado de una versión anterior recibe los campos nuevos
    try { const saved = cleanPrefs(await $.store.get('prefs')); await update($, prefs, () => saved) } catch { /* sin preferencias guardadas */ }
    try { const pg = cleanProgress(await $.store.get('progress')); await update($, progress, () => pg) } catch { /* sin progreso guardado */ }
    $.clock.every(1000, () => void poll($))
    if (Math.random() < 1 / 256) {
      await update($, view, v => ({ ...v, shiny: true }))
      void gain($, { type: 'secret', id: 'shiny' })
      void show($, 'happy', '¡Salió shiny! (1 de cada 256)')
    }
    void cleanRadar($)
    void show($, 'idle', '', true)
    return next(e)
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const args = e.args.trim()
    const p = await read($, prefs)
    if (args === 'demo') {
      await update($, hidden, () => false)
      void demo($)
      return { text: `${p.name} va a mostrar todas sus animaciones (~60 s).` }
    }
    if (args === 'ayuda' || args === 'help') return { text: PET_HELP }
    if (args === 'baila' || args === 'dance') {
      await update($, hidden, () => false)
      await show($, 'happy', '♪ ♫ ♪ ¡A bailar! ♪ ♫ ♪')
      void gain($, { type: 'secret', id: 'bailarin' })
      return { text: `${p.name} está bailando.` }
    }
    if (args === 'acaricia' || args === 'pet') {
      await update($, hidden, () => false)
      await show($, 'love', 'Prrr… :3')
      return { text: `A ${p.name} le encantó.` }
    }
    if (args === 'nivel' || args === 'logros') {
      const pg = cleanProgress(await $.store.get('progress'))
      const st = stageOf(pg.tokens), next = STAGES.find(x => x.min > pg.tokens && !x.secret)
      const got = ACHIEVEMENTS.filter(a => pg.achievements.includes(a.id) && !a.secret)
      const secrets = ACHIEVEMENTS.filter(a => a.secret)
      const secretGot = secrets.filter(a => pg.achievements.includes(a.id))
      return { text: [
        `${p.name} · Nivel ${levelOf(pg.tokens)}${levelOf(pg.tokens) > 10 ? '' : '/10'} · ${st.name} · ${fmtBig(pg.tokens)} tokens${next ? ` (${fmtBig(next.min - pg.tokens)} para ${next.name})` : ' (forma final)'}`,
        `${pg.turns} turnos · ${pg.edits} archivos · ${pg.agents} subagentes · racha ${pg.streak} días`,
        'Etapas: ' + STAGES.map((x, i) => x.secret && pg.tokens < x.min ? `${i + 1} ??? (???)` : `${i + 1} ${x.name} (${fmtBig(x.min)})`).join(' · '),
        `Logros ${got.length}/${ACHIEVEMENTS.length - secrets.length}:`,
        ...ACHIEVEMENTS.filter(a => !a.secret).map(a => `${pg.achievements.includes(a.id) ? '★' : '·'} ${a.name} — ${a.desc}`),
        `Secretos ${secretGot.length}/${secrets.length}:`,
        ...secrets.map(a => pg.achievements.includes(a.id) ? `★ ${a.name} — ${a.desc}` : '· ??? — logro secreto'),
      ].join('\n') }
    }
    if (args === 'tarjeta' || args === 'card') {
      const file = await makeCard($)
      return { text: `Tarjeta lista: ${file}` }
    }
    if (args) {
      const r = applyPetCommand(p, args)
      if (!r) return { text: `No entendí «${args}».\n${PET_HELP}` }
      const [np, msg] = r
      await update($, prefs, () => np)
      try { await $.store.set('prefs', np) } catch { /* no se pudo guardar: vale para esta sesión */ }
      return { text: msg }
    }
    const isHidden = await update($, hidden, h => !h)
    return { text: isHidden ? `${p.name} se escondió. Escribe /pet para que vuelva.` : `${p.name} está de vuelta arriba del chat.` }
  })

  // ----- arriba del chat: la banda con Clawd -----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hidden))) return next(e)
    const v = await read($, view)
    const pr = await read($, prefs)
    const pg = await read($, progress)
    const st = stageOf(pg.tokens)
    const today = new Date(await $.clock.now())
    const season = seasonal(today.getMonth() + 1, today.getDate())
    const look = pr.accessory === 'ninguno' && season ? { ...pr, accessory: season } : pr
    const rad = pr.radar ? await read($, others) : []
    if (e.surface === 'desktop' || e.surface === 'mobile' || e.surface === 'vscode') {
      // Clawd es un Svg aparte (su markup solo cambia con su estado: la animación no se reinicia);
      // los textos son texto nativo y se actualizan sin tocarlo
      const { Box, Svg, Text } = $.ui.resolve(e)
      const say = v.say || (v.mood === 'sleep' ? 'Zzz…' : '')
      const parts = metaParts(v)
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg key={petKey(v, look, st.id)} width={110} height={84} source={petScene(v, look, st.id)} alt={pr.name} isInteractive />
          <Box flexDirection="column" flexShrink={1} minWidth={0}>
            <Box flexDirection="row" gap={1} alignItems="center">
              <Text size="heading" weight="bold" color={pr.color}>{pr.name}</Text>
              <Text size="footnote" color={COLORS.MUTED}>Nv {levelOf(pg.tokens)} · {st.name}</Text>
              {v.shiny ? <Text size="footnote" weight="bold" color="#f2c14e">✦ shiny</Text> : null}
              <Text weight="semibold" color={COLORS.CREAM} wrap="truncate-end">{v.project || 'Claude'}</Text>
              {v.branch ? <Text size="footnote" color={COLORS.MUTED} wrap="truncate-end">⎇ {v.branch}</Text> : null}
            </Box>
            {parts.length ? (
              <Box flexDirection="row" gap={1}>
                {parts.map(([t, col], i) => <Text key={String(i)} size="footnote" tabular color={col}>{i ? '· ' : ''}{t}</Text>)}
              </Box>
            ) : null}
            <Text color={v.mood === 'attention' ? '#f5c451' : COLORS.CREAM} weight={v.mood === 'attention' ? 'semibold' : 'regular'} wrap="truncate-end">{say}</Text>
            {pr.comments && v.quip ? <Text size="footnote" italic color={pr.color} wrap="truncate-end">«{v.quip}»</Text> : null}
            {v.tasksTotal ? (
              <Box flexDirection="row" gap={1}>
                <Text size="footnote" color={v.tasksDone >= v.tasksTotal ? '#7fd67f' : COLORS.ORANGE}>◆</Text>
                <Text size="footnote" tabular color={COLORS.MUTED} wrap="truncate-end">{taskLine(v)}</Text>
              </Box>
            ) : null}
            {v.agents > 0 ? (
              <Box flexDirection="row" gap={1}>
                <Text size="footnote" color="#6ac4e0">◇</Text>
                <Text size="footnote" color="#6ac4e0" wrap="truncate-end">{v.agents === 1 ? '1 subagente' : `${v.agents} subagentes`} · {v.agentNow}</Text>
              </Box>
            ) : null}
            {v.background > 0 || v.wakeAt ? (
              <Box flexDirection="row" gap={1}>
                <Text size="footnote" color={COLORS.MUTED}>⏳</Text>
                <Text size="footnote" color={COLORS.MUTED} wrap="truncate-end">{[
                  v.background ? `${v.background} en segundo plano` : '',
                  v.wakeAt ? `despierta ${v.wakeAt}` : '',
                ].filter(Boolean).join(' · ')}</Text>
              </Box>
            ) : null}
            {rad.length ? (
              <Box flexDirection="column" marginTop={1}>
                {rad.slice(0, 3).map(o => (
                  <Box key={o.id} flexDirection="row" gap={1}>
                    <Text size="footnote" color={o.color}>●</Text>
                    <Text size="footnote" color={COLORS.CREAM} wrap="truncate-end">{o.title}</Text>
                    <Text size="footnote" color={COLORS.MUTED} wrap="truncate-end">{o.project}</Text>
                    <Text size="footnote" tabular color={o.color} wrap="truncate-end">{o.status}</Text>
                  </Box>
                ))}
                {rad.length > 3 ? <Text size="footnote" color={COLORS.MUTED}>y {rad.length - 3} más</Text> : null}
              </Box>
            ) : null}
          </Box>
        </Box>
      )
    }
    const { Text } = $.ui.resolve(e)  // la terminal no dibuja SVG: una línea de texto
    const need = rad.filter(o => o.kind === 'need').length, busy = rad.filter(o => o.kind === 'busy').length
    const radarText = [need ? `${need} te necesita` : '', busy ? `${busy} trabajando` : ''].filter(Boolean).join(', ')
    return <Text dimColor>{pr.name} · {v.say || v.mood}{v.pct >= 0 ? ` · ctx ${v.pct}%` : ''}{radarText ? ` · otras: ${radarText}` : ''}</Text>
  })

  on('prompt.submit', async ($, e, next) => {
    turnStart = (await $.clock.now()); tools = 0; errors = 0; edited = new Set(); doneAt = 0
    needing = false; background = 0; wakeAt = ''
    activeAt = turnStart   // actividad real: le escribiste
    if (tasks.size && [...tasks.values()].every(t => t.status === 'completed')) { tasks = new Map(); await syncWork($) }
    if (!topic) topic = cleanTopic(String((e as unknown as { text?: string }).text ?? ''))
    await show($, 'think', 'Leyendo tu mensaje…', true)
    recent = []
    await update($, view, v => v.quip ? { ...v, quip: '' } : v)
    // cómo le hablas (local, sin tokens): felicitarlo lo enamora; insultarlo o gritarle lo hace llorar
    const said = String((e as unknown as { text?: string }).text ?? '')
    const egg = easterEgg(said)
    if (egg) { await show($, egg[1], egg[2]); void gain($, { type: 'secret', id: egg[0] }); return next(e) }
    const tone = toneOf(said)
    if (tone === 'praise') { await show($, 'love', '¡Aww, gracias!'); void gain($, { type: 'praise' }) }
    else if (tone === 'insult') await show($, 'sad', '¿Por qué me gritas? :(')
    return next(e)
  })

  // la respuesta llega en pedazos: pensando → escribiendo, en vivo
  on('turn.step', async function* ($, e, next) {
    const main = !e.agentId
    if (main && e.model) model = prettyModel(e.model)
    if (!e.agentId) pendingAsks.clear()   // el modelo principal siguió: los permisos pendientes ya se resolvieron
    const it = next(e)
    let phase = ''
    while (true) {
      const r = await it.next()
      if (r.done) return r.value
      const c = r.value
      if (c.kind === 'stop' && c.usage) {
        const u = c.usage
        const n = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        if (n > 0) void gain($, { type: 'tokens', n })
      }
      if (main && (c.kind === 'thinking' || c.kind === 'text') && phase !== c.kind) {
        phase = c.kind
        void show($, c.kind === 'text' ? 'write' : 'think', c.kind === 'text' ? 'Escribiendo respuesta…' : 'Pensando…')
      }
      yield c
    }
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    // solo la conversación principal (los permisos de subagentes no cuentan) y solo si el usuario no la apagó
    if (r.decision === 'ask' && !e.agentId && (await read($, prefs)).permissions) {
      // solo alerta si a los pocos segundos esa misma llamada sigue esperando: en modo auto se aprueba sola
      const id = e.tool_use_id ?? `c${++callSeq}`
      pendingAsks.add(id)
      const label = `Necesita tu permiso · ${e.tool.startsWith('mcp__') ? e.tool.split('__').slice(1).join(': ') : e.tool}`
      void $.clock.sleep(ASK_DELAY_MS).then(() => { if (pendingAsks.has(id)) void needYou($, label) })
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const [mood, text] = describeTool(e.tool, input)
    tools++
    activeAt = await $.clock.now()
    const isAgent = e.tool === 'Agent' || e.tool === 'Task'
    if (isAgent) { agents++; agentNow = String(input.description ?? 'Subagente'); void gain($, { type: 'agent', concurrent: agents }) }
    else void gain($, { type: 'tool' })
    recent.push(text)
    void comment($)
    // formularios y planes: Claude espera tu respuesta
    const asks = e.tool === 'AskUserQuestion' ? 'Te hizo una pregunta' : e.tool === 'ExitPlanMode' ? 'Plan listo · revísalo' : ''
    if (asks) await needYou($, asks)
    else await show($, mood, text)
    // segundo plano
    if ((e.tool === 'Bash' || e.tool === 'PowerShell' || e.tool === 'Agent') && input.run_in_background === true || e.tool === 'Monitor') { background++; await syncWork($) }
    if (e.tool === 'ScheduleWakeup' && typeof input.delaySeconds === 'number') {
      wakeAt = clockAt((await $.clock.now()) + input.delaySeconds * 1000); await syncWork($)
    }
    if (isAgent) await syncWork($)
    let result: Awaited<ReturnType<typeof next>>
    try {
      result = await next(e)
    } finally {
      if (e.tool_use_id) pendingAsks.delete(e.tool_use_id)   // esta llamada terminó: su permiso ya se resolvió
      if (isAgent) { agents = Math.max(0, agents - 1); await syncWork($) }
      await answered($, asks ? 'Leyendo tu respuesta…' : 'Continuando…')   // aprobaste, respondiste o rechazaste
    }
    // la lista de tareas de Claude: «3/7 · Implementando…»
    if (e.tool === 'TaskCreate') {
      const id = String((result as { text?: string }).text ?? '').match(/#(\d+)/)?.[1] ?? String(++taskSeq)
      taskSeq = Math.max(taskSeq, Number(id) || 0)
      tasks.set(id, { subject: String(input.subject ?? ''), active: String(input.activeForm ?? ''), status: 'pending' })
      await syncWork($)
    } else if (e.tool === 'TaskUpdate') {
      const id = String(input.taskId ?? '')
      const t = tasks.get(id)
      if (input.status === 'deleted') tasks.delete(id)
      else if (t) tasks.set(id, {
        subject: String(input.subject ?? t.subject), active: String(input.activeForm ?? t.active),
        status: String(input.status ?? t.status),
      })
      await syncWork($)
    }
    const file = (e as unknown as { file_path?: string }).file_path
    if ((e.tool === 'Edit' || e.tool === 'Write') && file) { edited.add(file); void gain($, { type: 'edit' }) }
    const memes = (await read($, prefs)).memes
    if ((result as { isError?: boolean }).isError) {
      errors++
      if (errors === 3 && memes) await show($, 'fine', `This is fine · ${errors} errores`)   // meme: todo arde, Clawd tranquilo
      else await show($, 'sad', 'Falló; reintentando…')
    } else if (tools === 15 && errors === 0 && memes) {
      await show($, 'vibe', `Vibe coding · ${tools} pasos sin errores`)            // meme: lentes «deal with it»
      void gain($, { type: 'vibe' })
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    needing = false
    const memes = (await read($, prefs)).memes
    const elapsed = turnStart ? (await $.clock.now()) - turnStart : 0
    const took = turnStart ? fmtDuration((await $.clock.now()) - turnStart) : ''
    const files = edited.size ? ` · ${filesLine([...edited])}` : ''
    if (e.reason === 'aborted') {
      await show($, 'idle', 'Detenido', true)
      if (memes) await show($, 'walk', 'Me voy a las montañas…')                               // meme: el pingüino nihilista
    } else if (e.reason === 'error' || e.reason === 'refusal') {
      await show($, 'idle', 'No pude terminar', true)
      await show($, 'sad', 'No pude terminar')
    } else {
      await show($, 'idle', `Tu turno${took ? ' · ' + took : ''}${files}`, true)    // tranquilo, sin fiesta
      if (edited.size >= 5 && errors === 0 && memes) await show($, 'cinema', `Absolute cinema${files}`)  // meme: solo en turnos grandes
    }
    if (elapsed >= 20_000) void chime($, 'listo')   // solo turnos largos: los cortos no suenan
    if (e.reason === 'answer') {
      const d = new Date(await $.clock.now())
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      await gain($, { type: 'turn', day, hour: d.getHours(), ms: elapsed })
      void comment($, true)
    }
    turnStart = 0
    doneAt = e.reason === 'aborted' ? 0 : await $.clock.now()   // si la detuviste tú, ya la viste
    activeAt = await $.clock.now()
    await publish($)
    return r
  })

  // abriste esta conversación: lo que terminó ya lo viste
  on('session.attach', async ($, e, next) => {
    doneAt = 0
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await publish($, true)   // las demás la quitan del radar
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    await show($, 'dizzy')
    const r = await next(e)
    await show($, 'idle', 'Memoria compactada', true)
    return r
  })
}
