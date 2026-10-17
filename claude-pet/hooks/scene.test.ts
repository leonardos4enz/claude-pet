import { expect, test } from 'claude-code/testing'

import type { Mood } from '../types'
import { ACCESSORIES, applyPetCommand, award, cardSvg, cleanPrefs, cleanProgress, clockAt, defaultPrefs, defaultProgress, describeTool, easterEgg, fmtBig, levelOf, seasonal, stageOf, toneOf, filesLine, fmtDuration, fmtTokens, initialView, metaParts, taskLine, petKey, petScene, prettyModel, radarItems, setMood, tick } from './scene'

const ALL: Mood[] = ['sleep', 'idle', 'think', 'write', 'work', 'sad', 'dizzy', 'happy', 'attention', 'love', 'vibe', 'fine', 'cinema', 'walk']

test('los momentos meme terminan y vuelven al estado y texto de base', () => {
  let v = setMood(initialView(), 'idle', 0, 'Tu turno · 12s')
  v = setMood(v, 'cinema', 100, 'Absolute cinema')
  expect(v.mood).toBe('cinema')
  v = tick(v, 100 + 10_000)
  expect(v.mood).toBe('idle')
  expect(v.say).toBe('Tu turno · 12s')
})

test('al escribir la respuesta mueve la boca', () => {
  const v = setMood(initialView(), 'write', 0)
  expect(v.talking).toBe(true)
  expect(v.say).toBe('Escribiendo respuesta…')
  expect(setMood(v, 'work', 1, 'Editando x').talking).toBe(false)
})

test('formatos de los datos de la sesión', () => {
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(prettyModel('claude-haiku-5-5')).toBe('Haiku 5.5')
  expect(fmtTokens(84_321)).toBe('84k')
  expect(fmtDuration(72_000)).toBe('1m 12s')
  const parts = metaParts({ ...initialView(), pct: 92, tokens: 184_000, window: 200_000, model: 'Opus 5.5', cost: 1.234, limit5h: 40 })
  expect(parts.map(p => p[0])).toEqual(['ctx 92% · 184k/200k', 'compacta pronto', '5h 40%'])  // sin costo ni modelo
})

test('Clawd no se redibuja cuando solo cambia el texto', () => {
  const a = setMood(initialView(), 'work', 0, 'Editando a.ts')
  const b = setMood(a, 'work', 1, 'Leyendo b.ts')
  expect(petKey(a)).toBe(petKey(b))
  expect(petScene(a)).toBe(petScene(b))
  expect(petScene(a).includes('animateMotion')).toBe(true)  // la red neuronal circular
})

test('las herramientas se describen', () => {
  expect(describeTool('Edit', { file_path: 'C:/x/src/main.cpp' })).toEqual(['work', 'Editando main.cpp'])
  expect(describeTool('Read', { file_path: '/a/b.py' })).toEqual(['work', 'Leyendo b.py'])
})

test('todos los estados: curvas válidas (0..1) y tamaño dentro del límite', () => {
  for (const m of ALL) {
    const svg = petScene({ ...setMood(initialView(), m, 0), model: 'Opus 5.5' })
    expect(svg.length < 131072).toBe(true)
    for (const [, splines] of svg.matchAll(/keySplines="([^"]+)"/g))
      for (const n of splines.split(/[ ;]/).map(Number)) expect(n >= 0 && n <= 1).toBe(true)
  }
})

test('radar: las últimas 3 con actividad real en la última hora', () => {
  const now = 10_000_000
  const o = (id: string, mood: Mood, activeAgo: number, extra: Record<string, number | string> = {}) =>
    ({ id, project: 'ESP32', topic: 'arregla el sensor de luz', mood, say: '', at: now, busySince: 0, doneAt: 0, activeAt: now - activeAgo, ...extra })
  const list = radarItems([
    o('yo', 'work', 0),                                                  // esta misma: no sale
    o('vieja', 'idle', 2 * 3_600_000),                                   // quieta hace 2 h: no sale
    o('muerta', 'work', 1000, { at: now - 60_000 }),                     // cerrada: no sale
    o('pausa', 'idle', 40 * 60_000),                                     // la 4.ª más reciente: no cabe
    o('lista', 'idle', 5 * 60_000, { doneAt: now - 5 * 60_000 }),
    o('trabaja', 'write', 30_000, { busySince: now - 3 * 60_000 }),
    o('pensando', 'idle', 20 * 60_000),
  ], now, 'yo')
  expect(list.map(i => i.id)).toEqual(['trabaja', 'lista', 'pensando'])
  expect(list[0].status).toBe('escribiendo · 3m')
  expect(list[1].status).toBe('te espera · terminó hace 5m')
  expect(list[2].status).toBe('en pausa · hace 20m')
  // recién abierta: sin actividad real todavía, no sale
  expect(radarItems([{ ...o('nueva', 'idle', 0), activeAt: 0 }], now, 'yo')).toEqual([])
})

test('datos nuevos: reinicio del límite, semana, aviso de contexto', () => {
  const v = { ...initialView(), pct: 88, tokens: 176_000, window: 200_000, limit5h: 37, reset5h: '18:40', week: 64 }
  expect(metaParts(v).map(p => p[0])).toEqual(['ctx 88% · 176k/200k', 'compacta pronto', '5h 37% · reinicia 18:40', 'semana 64%'])
  expect(metaParts({ ...v, pct: 40, week: 30 }).map(p => p[0])).toEqual(['ctx 40% · 176k/200k', '5h 37% · reinicia 18:40'])
  expect(clockAt('2026-10-15T18:40:00')).toBe('18:40')
  expect(clockAt(undefined)).toBe('')
})

test('tareas y archivos del turno, con límite', () => {
  expect(taskLine({ ...initialView(), tasksTotal: 7, tasksDone: 3, taskNow: 'Implementando el radar' })).toBe('3/7 · Implementando el radar')
  expect(taskLine({ ...initialView(), tasksTotal: 4, tasksDone: 4 })).toBe('4/4 tareas listas')
  expect(taskLine(initialView())).toBe('')
  expect(filesLine(['C:/a/register.tsx', '/b/scene.ts'])).toBe('register.tsx, scene.ts')
  expect(filesLine(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'])).toBe('a.ts, b.ts +3')
})

test('subagentes: mini-Clawds orbitando la mente, uno por subagente (máx. 4)', () => {
  const base = setMood(initialView(), 'work', 0)
  const count = (svg: string) => (svg.match(/width="16" height="9"/g) ?? []).length
  expect(count(petScene(base))).toBe(0)
  expect(count(petScene({ ...base, agents: 2 }))).toBe(2)
  expect(count(petScene({ ...base, agents: 9 }))).toBe(4)
  expect(petKey({ ...base, agents: 2 })).not.toBe(petKey(base))
})

test('personalización: comandos de /pet', () => {
  let p = defaultPrefs()
  p = applyPetCommand(p, 'nombre Pixel')![0]
  expect(p.name).toBe('Pixel')
  p = applyPetCommand(p, 'color azul')![0]
  expect(p.color).toBe('#5b8def')
  p = applyPetCommand(p, 'color #0f0')![0]
  expect(p.color).toBe('#00ff00')
  expect(applyPetCommand(p, 'color fucsia-neón')![0].color).toBe('#00ff00')   // color inválido: no cambia
  p = applyPetCommand(p, 'accesorio corona')![0]
  expect(p.accessory).toBe('corona')
  p = applyPetCommand(p, 'sonido on')![0]
  expect(p.sound).toBe(true)
  p = applyPetCommand(p, 'memes off')![0]
  expect(p.memes).toBe(false)
  expect(applyPetCommand(p, 'baila')).toBe(null)
  expect(cleanPrefs({ name: '', color: 'nope', accessory: 'capa', sound: 'x' })).toEqual(defaultPrefs())
})

test('accesorios y color: cambian el dibujo y su llave', () => {
  const v = setMood(initialView(), 'idle', 0)
  const base = petScene(v)
  for (const a of ACCESSORIES.filter(a => a !== 'ninguno')) {
    const pr = { ...defaultPrefs(), accessory: a }
    expect(petScene(v, pr)).not.toBe(base)
    expect(petKey(v, pr)).not.toBe(petKey(v))
  }
  expect(petScene(v, { ...defaultPrefs(), color: '#5b8def' }).includes('#5b8def')).toBe(true)
})

test('radar: «te necesita» va primero', () => {
  const now = 10_000_000
  const o = (id: string, mood: Mood, activeAgo: number, extra: Record<string, number | string> = {}) =>
    ({ id, project: 'ESP32', topic: 'tema', mood, say: '', at: now, busySince: 0, doneAt: 0, activeAt: now - activeAgo, ...extra })
  const list = radarItems([o('trabaja', 'work', 1000, { busySince: now - 5000 }), o('permiso', 'attention', 50_000, { busySince: now - 60_000, say: 'Necesita tu permiso · Bash' })], now, 'yo')
  expect(list[0].id).toBe('permiso')
  expect(list[0].kind).toBe('need')
  expect(list[0].status).toBe('te necesita · Necesita tu permiso · Bash')
})

test('tono del mensaje (local): felicitar, insultar, gritar', () => {
  expect(toneOf('muchas gracias, quedó genial')).toBe('praise')
  expect(toneOf('eres un crack')).toBe('praise')
  expect(toneOf('otra vez mal, inútil')).toBe('insult')
  expect(toneOf('POR QUÉ NO FUNCIONA ESTO')).toBe('insult')
  expect(toneOf('arregla el bug del sensor')).toBe(null)
})

test('evolución: 10 etapas por tokens trabajados, y logros', () => {
  let p = defaultProgress()
  expect(stageOf(p.tokens).id).toBe('huevo')
  expect(levelOf(p.tokens)).toBe(1)
  let got: { id: string }[]
  ;[p, got] = award(p, { type: 'turn', day: '2026-10-14', hour: 2, ms: 700_000 })
  expect(got.map(g => g.id).sort()).toEqual(['buho', 'hola', 'maraton'])
  ;[p, got] = award(p, { type: 'tokens', n: 150_000 })
  expect(stageOf(p.tokens).name).toBe('Cría')
  expect(got.map(g => g.id)).toContain('eclosion')
  ;[p] = award(p, { type: 'tokens', n: 15_000_000 })
  expect(stageOf(p.tokens).name).toBe('Ninja')
  expect(levelOf(p.tokens)).toBe(5)
  ;[p, got] = award(p, { type: 'tokens', n: 400_000_000 })
  expect(levelOf(p.tokens)).toBe(10)
  expect(got.map(g => g.id)).toContain('leyenda')
  ;[p, got] = award(p, { type: 'agent', concurrent: 4 })
  expect(got.map(g => g.id)).toContain('ejercito')
  ;[p] = award(p, { type: 'turn', day: '2026-10-15', hour: 12, ms: 1000 })
  ;[p, got] = award(p, { type: 'turn', day: '2026-10-16', hour: 12, ms: 1000 })
  expect(p.streak).toBe(3)
  expect(got.map(g => g.id)).toContain('racha')
  expect(cleanProgress({ xp: -5, achievements: 'x' })).toEqual(defaultProgress())
  expect(fmtBig(2_500_000)).toBe('2.5M')
})

test('etapas dibujan distinto; la tarjeta trae nombre, nivel y logros', () => {
  const v = setMood(initialView(), 'idle', 0)
  const scenes = (['huevo', 'cria', 'aprendiz', 'hacker', 'ninja', 'samurai', 'sensei', 'maestro', 'leyenda', 'deidad', 'singularidad'] as const).map(st => petScene(v, defaultPrefs(), st))
  expect(new Set(scenes).size).toBe(11)
  const [p] = award(defaultProgress(), { type: 'turn', day: '2026-10-16', hour: 12, ms: 1000 })
  const card = cardSvg(v, { ...defaultPrefs(), name: 'Luffy', accessory: 'paja' }, p)
  expect(card.startsWith('<svg')).toBe(true)
  expect(card.includes('Luffy')).toBe(true)
  expect(card.includes('Hola mundo')).toBe(true)
  expect(applyPetCommand(defaultPrefs(), 'comentarios on')![0].comments).toBe(true)
  expect(defaultPrefs().comments).toBe(false)                 // apagado por defecto
})

test('easter eggs: nivel 11 secreto, frases, temporada y shiny', () => {
  let [p, got] = award(defaultProgress(), { type: 'tokens', n: 10_000_000_000_000 })
  expect(levelOf(p.tokens)).toBe(11)
  expect(stageOf(p.tokens).name).toBe('Singularidad')
  expect(got.map(g => g.id)).toContain('singularidad')
  expect(easterEgg('42')?.[0]).toBe('respuesta')
  expect(easterEgg('sudo arregla todo')?.[2]).toBe('¡Sí, mi capitán!')
  expect(easterEgg('Hola mundo')?.[0]).toBe('hola')
  expect(easterEgg('arregla el bug 42 del sensor')).toBe(null)
  expect(seasonal(10, 31)).toBe('calabaza')
  expect(seasonal(12, 25)).toBe('santa')
  expect(seasonal(7, 4)).toBe(null)
  const v = setMood(initialView(), 'idle', 0)
  expect(petScene({ ...v, shiny: true })).not.toBe(petScene(v))
  expect(petKey({ ...v, shiny: true })).not.toBe(petKey(v))
  expect(petScene(v, { ...defaultPrefs(), accessory: 'santa' })).not.toBe(petScene(v))
})

test('/pet atuendo off: desde el nivel 5 se ve como el 4', () => {
  const v = setMood(initialView(), 'idle', 0)
  const sin = { ...defaultPrefs(), stageLook: false }
  expect(applyPetCommand(defaultPrefs(), 'atuendo off')![0].stageLook).toBe(false)
  expect(petScene(v, sin, 'deidad')).toBe(petScene(v, sin, 'hacker'))     // sin alas ni aureola
  expect(petScene(v, sin, 'ninja')).not.toBe(petScene(v, defaultPrefs(), 'ninja'))   // sin bufanda
  expect(petScene(v, sin, 'cria')).toBe(petScene(v, defaultPrefs(), 'cria'))        // antes del 5 no cambia
})
