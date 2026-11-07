import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useChat } from '../context/ChatContext'
import { useUser } from '../context/UserContext'
import { api } from '../lib/api'
import { BOT_NAME } from '../lib/brand'
import { callName } from '../lib/format'
import { isNo, isYes, phrases } from '../lib/phrases'
import type { ProposedAction } from '../lib/types'

// Call mode: talk to the assistant hands-free. Browser speech recognition listens, the same grounded assistant answers in a
// short spoken style, and ElevenLabs speaks the reply (through the backend; the browser voice is the fallback).
type Phase = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'
const STATUS: Record<Phase, string> = { connecting: 'Connecting…', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking · tap to interrupt', error: 'Call not available' }
const CODES: Record<string, string> = { English: 'en-GB', Español: 'es-ES', Polski: 'pl-PL', Português: 'pt-PT', Français: 'fr-FR', Italiano: 'it-IT', Română: 'ro-RO', العربية: 'ar-SA', हिन्दी: 'hi-IN', 'Bengali (বাংলা)': 'bn-BD', 'Urdu (اردو)': 'ur-PK' }

/* eslint-disable @typescript-eslint/no-explicit-any */
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

export function CallOverlay({ onClose }: { onClose: () => void }) {
  const { user } = useUser()
  const chat = useChat()
  const [phase, setPhase] = useState<Phase>('connecting')
  const [status, setStatus] = useState(STATUS.connecting)
  const [you, setYou] = useState('')
  const [bot, setBot] = useState('')
  const [muted, setMuted] = useState(false)
  const [talkOver, setTalkOver] = useState(true)
  const [pending, setPending] = useState<ProposedAction | null>(null)
  const orb = useRef<HTMLButtonElement>(null)
  const chatRef = useRef(chat); chatRef.current = chat
  const name = useRef(user ? callName(user) : 'there'); name.current = user ? callName(user) : 'there'
  const talkOverRef = useRef(true); talkOverRef.current = talkOver
  const ctl = useRef({ interrupt: () => { }, toggleMute: () => { }, yes: () => { }, no: () => { } })

  useEffect(() => {
    let alive = true // StrictMode runs effects twice in dev; each run owns its own flag
    const s = { phase: 'connecting' as Phase, gen: 0, muted: false, fatal: false, eleven: false, pending: null as ProposedAction | null, since: 0 }
    let rec: any = null
    let audio: HTMLAudioElement | null = null
    let stream: MediaStream | null = null
    let actx: AudioContext | null = null
    let raf = 0

    const setP = (p: Phase, text?: string) => { s.phase = p; setPhase(p); setStatus(text ?? STATUS[p]) }
    const setPend = (a: ProposedAction | null) => { s.pending = a; setPending(a) }
    const lang = () => chatRef.current.language

    const fail = (msg: string) => { s.fatal = true; setBot(msg); setP('error') }

    async function openMic() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return }
      actx = new AudioContext()
      const an = actx.createAnalyser(); an.fftSize = 512
      actx.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.fftSize)
      const tick = () => {
        if (!alive) return
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x }
        const level = Math.sqrt(sum / buf.length)
        orb.current?.style.setProperty('--lvl', s.muted ? '0' : String(Math.min(1, level * 6)))
        // talk over the assistant: sustained loud input while it speaks interrupts it
        if (s.phase === 'speaking' && talkOverRef.current && !s.muted && level > 0.1) {
          s.since ||= performance.now()
          if (performance.now() - s.since > 450) { interrupt(); s.since = 0 }
        } else s.since = 0
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    function stopSpeaking() {
      if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null }
      speechSynthesis.cancel()
    }
    function stopListening() {
      if (rec) { rec.onresult = rec.onend = rec.onerror = null; try { rec.abort() } catch { /* already stopped */ } rec = null }
    }

    async function say(text: string) {
      const my = ++s.gen
      stopSpeaking(); stopListening()
      setBot(text); setP('speaking')
      let played = false
      if (s.eleven) {
        try {
          const blob = await api.speak(text, lang())
          if (my !== s.gen || !alive) return
          const url = URL.createObjectURL(blob)
          await new Promise<void>((res, rej) => {
            const a = new Audio(url); audio = a
            a.onended = () => res(); a.onerror = () => rej(new Error('audio')); a.play().catch(rej)
          })
          URL.revokeObjectURL(url); played = true
        } catch { s.eleven = false /* use the browser voice for the rest of the call */ }
      }
      if (my !== s.gen || !alive) return
      if (!played) {
        await new Promise<void>((res) => {
          const u = new SpeechSynthesisUtterance(text); u.lang = CODES[lang()] || 'en-GB'
          u.onend = () => res(); u.onerror = () => res(); speechSynthesis.speak(u)
        })
      }
      if (my !== s.gen || !alive) return
      listen()
    }

    function interrupt() { if (s.phase !== 'speaking') return; s.gen++; stopSpeaking(); listen() }

    function listen() {
      if (!alive || s.fatal) return
      stopListening(); setP('listening')
      if (s.muted) { setP('listening', 'Muted · tap the mic to talk'); return }
      rec = new SR(); rec.lang = CODES[lang()] || 'en-GB'; rec.interimResults = true; rec.continuous = false
      let got = false
      rec.onresult = (e: any) => {
        const r = e.results[e.results.length - 1], t = String(r[0].transcript).trim()
        setYou(t)
        if (r.isFinal && t && !got) { got = true; stopListening(); void handle(t) }
      }
      rec.onerror = (e: any) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fail('Microphone is blocked. Allow it in the address bar, then try again.') }
      rec.onend = () => { if (alive && !got && !s.fatal && s.phase === 'listening' && !s.muted) setTimeout(listen, 150) }
      try { rec.start() } catch { setTimeout(listen, 300) }
    }

    async function confirm(p: ProposedAction) {
      setP('thinking')
      const r = await chatRef.current.runAction(p)
      if (alive) await say(r.message)
    }

    async function handle(text: string) {
      setP('thinking'); setYou(text)
      const p = s.pending
      if (p) {
        setPend(null)
        if (isYes(text)) return confirm(p)
        if (isNo(text)) { chatRef.current.decline(p); return say(phrases(lang()).leave) }
        chatRef.current.decline(p) // they moved on to something else
      }
      const r = await chatRef.current.ask(text, { voice: true })
      if (!alive) return
      if (!r) return say(phrases(lang()).lost)
      const a = r.actions[0]
      if (a) setPend(a)
      await say(a && !/[?؟？]\s*$/.test(r.reply) ? `${r.reply} ${phrases(lang()).ahead}` : r.reply)
    }

    ctl.current = {
      interrupt,
      toggleMute: () => {
        s.muted = !s.muted; setMuted(s.muted)
        if (s.muted) { stopListening(); if (s.phase === 'listening') setP('listening', 'Muted · tap the mic to talk') }
        else if (s.phase === 'listening') listen()
      },
      yes: () => { const p = s.pending; if (!p) return; setPend(null); stopListening(); s.gen++; stopSpeaking(); void confirm(p) },
      no: () => { const p = s.pending; if (!p) return; setPend(null); stopListening(); s.gen++; stopSpeaking(); chatRef.current.decline(p); void say(phrases(lang()).leave) },
    }

    ;(async () => {
      if (!SR || !navigator.mediaDevices) return fail('Calls need speech recognition. Please use Chrome or Edge on this device.')
      try { s.eleven = (await api.voiceStatus()).elevenlabs } catch { s.eleven = false }
      try { await openMic() } catch { return alive ? fail('I could not use the microphone. Allow it in the address bar and try again.') : undefined }
      if (!alive) return
      await say(phrases(lang()).greet(name.current, BOT_NAME))
    })()

    return () => {
      alive = false; s.gen++
      stopSpeaking(); stopListening(); cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void actx?.close().catch(() => { })
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  return (
    <div className="call" data-state={phase} role="dialog" aria-modal="true" aria-label={`Call with ${BOT_NAME}`}>
      <div>
        <p className="who">{BOT_NAME}</p>
        <p className="callstatus" aria-live="polite">{status}</p>
      </div>
      <button ref={orb} className="orb" onClick={() => ctl.current.interrupt()} aria-label={`${BOT_NAME}. Tap to interrupt while it is speaking`} />
      <div className="caps" aria-live="polite">
        <div className="you">{you}</div>
        <div className="bot">{bot}</div>
      </div>
      {pending && (
        <div className="pend">
          <p>{pending.label}</p>
          <div><button className="btn" onClick={() => ctl.current.yes()}>Yes, do it</button><button className="btn secondary" onClick={() => ctl.current.no()}>No thanks</button></div>
        </div>
      )}
      <div>
        <label className="tog"><input type="checkbox" checked={talkOver} onChange={(e) => setTalkOver(e.target.checked)} /> Let me talk over it</label>
        <div className="ctl">
          <button onClick={() => ctl.current.toggleMute()} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>{muted ? <MicOff size={26} /> : <Mic size={26} />}</button>
          <button className="end" onClick={onClose} aria-label="End call"><PhoneOff size={28} /></button>
        </div>
      </div>
    </div>
  )
}
