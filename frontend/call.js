// Call mode: talk to Finance Buddy hands-free. Browser speech recognition (listening) -> the same RAG assistant
// (voice style) -> ElevenLabs voice (speaking, via the backend; falls back to the browser voice without a key).
// Uses globals from app.js: $, api, post, history, bubble, firstName.
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const CODES = { 'English': 'en-GB', 'Español': 'es-ES', 'Polski': 'pl-PL', 'Português': 'pt-PT', 'Français': 'fr-FR', 'العربية': 'ar-SA', 'Română': 'ro-RO', 'Bengali (বাংলা)': 'bn-BD', 'Urdu (اردو)': 'ur-PK' };
  const YES = /^\s*(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please do|confirm|sounds good|s[ií]|vale|claro|tak|oui|d'accord|sim|pode|ndio)\b/i;
  const NO = /^\s*(no|nope|nah|don't|do not|cancel that|leave it|not now|never mind|nie|non|n[aã]o)\b/i;
  const el = { box: $('#call'), orb: $('#orb'), status: $('#callStatus'), you: $('#callYou'), bot: $('#callBot'), pend: $('#callPending'), pendText: $('#callPendingText'), talkOver: $('#talkOver') };
  let active = false, state = 'idle', rec = null, audio = null, stream = null, ctxA = null, analyser = null, level = 0, muted = false, pending = null, eleven = false, gen = 0, bargeSince = 0, raf = 0;

  const setState = (s, text) => { state = s; el.box.dataset.state = s; el.status.textContent = text || ({ listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking · tap to interrupt', idle: '' }[s] || ''); };
  const showErr = m => { el.bot.textContent = m; setState('idle', 'Call not available'); };

  // ---- microphone level (also proves the mic works) + talk-over detection ----
  async function openMic() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    ctxA = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ctxA.createAnalyser(); analyser.fftSize = 512;
    ctxA.createMediaStreamSource(stream).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!active) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
      level = Math.sqrt(sum / buf.length);
      el.orb.style.setProperty('--lvl', muted ? 0 : Math.min(1, level * 6).toFixed(2));
      // talk over the assistant: sustained loud input while it speaks interrupts it
      if (state === 'speaking' && el.talkOver.checked && !muted && level > 0.1) {
        bargeSince = bargeSince || performance.now();
        if (performance.now() - bargeSince > 450) { interrupt(); bargeSince = 0; }
      } else bargeSince = 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // ---- speaking ----
  function stopSpeaking() { if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; } speechSynthesis.cancel(); }
  async function say(text) {
    const my = ++gen; stopSpeaking(); stopListening();
    el.bot.textContent = text; setState('speaking');
    const lang = $('#lang').value;
    let played = false;
    if (eleven) {
      try {
        const r = await post('/api/voice/speak', { text, language: lang });
        if (!r.ok) throw new Error(r.status);
        const url = URL.createObjectURL(await r.blob());
        if (my !== gen) return;
        await new Promise((res, rej) => { audio = new Audio(url); audio.onended = res; audio.onerror = rej; audio.play().catch(rej); });
        played = true; URL.revokeObjectURL(url);
      } catch { eleven = false; /* fall through to the browser voice for the rest of the call */ }
    }
    if (my !== gen) return;
    if (!played) await new Promise(res => { const u = new SpeechSynthesisUtterance(text); u.lang = CODES[lang] || 'en-GB'; u.onend = u.onerror = res; speechSynthesis.speak(u); });
    if (my !== gen || !active) return;
    listen();
  }
  function interrupt() { if (state !== 'speaking') return; gen++; stopSpeaking(); listen(); }

  // ---- listening ----
  function stopListening() { if (rec) { rec.onresult = rec.onend = rec.onerror = null; try { rec.abort(); } catch { } rec = null; } }
  function listen() {
    if (!active) return;
    stopListening(); setState('listening');
    if (muted) { setState('listening', 'Muted · tap the mic to talk'); return; }
    rec = new SR(); rec.lang = CODES[$('#lang').value] || 'en-GB'; rec.interimResults = true; rec.continuous = false;
    let got = false;
    rec.onresult = e => {
      const r = e.results[e.results.length - 1], t = r[0].transcript.trim();
      el.you.textContent = t;
      if (r.isFinal && t && !got) { got = true; stopListening(); handle(t); }
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { active = false; showErr('Microphone is blocked. Allow it in the address bar, then try again.'); }
    };
    rec.onend = () => { if (active && !got && state === 'listening' && !muted) setTimeout(listen, 150); };
    try { rec.start(); } catch { setTimeout(listen, 300); }
  }

  // ---- conversation ----
  async function handle(text) {
    setState('thinking'); el.you.textContent = text;
    if (pending) {
      const p = pending;
      if (YES.test(text)) { pending = null; el.pend.hidden = true; return confirmPending(p); }
      if (NO.test(text)) { pending = null; el.pend.hidden = true; history.push({ role: 'user', content: '[I declined: ' + p.label + ']' }); return say('No problem, I\'ll leave it.'); }
      pending = null; el.pend.hidden = true; // they moved on
    }
    bubble('me', text); history.push({ role: 'user', content: text });
    try {
      const r = await post(api('/chat'), { messages: history.slice(-20), language: $('#lang').value, plain: $('#plain').checked, voice: true });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      history.push({ role: 'assistant', content: j.reply });
      bubble('bot', j.reply);
      const a = (j.actions || [])[0];
      if (a) { pending = a; el.pendText.textContent = a.label; el.pend.hidden = false; }
      await say(a && !/\?\s*$/.test(j.reply) ? j.reply + ' Shall I go ahead?' : j.reply);
    } catch {
      history.pop();
      await say('Sorry, I lost the connection for a second. Could you say that again?');
    }
  }
  async function confirmPending(p) {
    setState('thinking');
    const r = await post(api('/actions'), { action: p.action }), j = await r.json();
    history.push({ role: 'user', content: '[I ' + (j.ok ? 'confirmed and it was done' : 'tried but it failed') + ': ' + p.label + ']' });
    bubble('bot', (j.ok ? '✓ ' : '') + j.message);
    loadHome(); if (!$('#money').hidden) loadMoney();
    await say(j.message);
  }

  // ---- start / end ----
  async function start() {
    if (active) return;
    el.box.hidden = false; document.body.style.overflow = 'hidden'; el.you.textContent = ''; el.bot.textContent = ''; el.pend.hidden = true; pending = null; muted = false;
    $('#callMute').setAttribute('aria-pressed', 'false');
    if (!SR || !navigator.mediaDevices) return showErr('Calls need speech recognition. Please use Chrome or Edge on this device.');
    try { eleven = (await (await fetch('/api/voice/status')).json()).elevenlabs; } catch { eleven = false; }
    setState('thinking', 'Connecting…');
    active = true;
    try { await openMic(); } catch { active = false; return showErr('I could not use the microphone. Allow it in the address bar and try again.'); }
    await say(`Hi ${firstName || 'there'}, it's Finance Buddy. What's on your mind?`);
  }
  function end() {
    active = false; gen++; stopSpeaking(); stopListening(); cancelAnimationFrame(raf); raf = 0;
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = null;
    if (ctxA) ctxA.close().catch(() => { }); ctxA = null;
    el.box.hidden = true; document.body.style.overflow = ''; setState('idle');
  }

  $('#callBtn').onclick = start;
  $('#callEnd').onclick = end;
  el.orb.onclick = () => { if (state === 'speaking') interrupt(); };
  $('#callMute').onclick = e => {
    muted = !muted; e.currentTarget.setAttribute('aria-pressed', String(muted));
    if (muted) { stopListening(); if (state === 'listening') setState('listening', 'Muted · tap the mic to talk'); } else if (state === 'listening') listen();
  };
  $('#callYes').onclick = () => { if (pending) { const p = pending; pending = null; el.pend.hidden = true; stopListening(); gen++; stopSpeaking(); confirmPending(p); } };
  $('#callNo').onclick = () => { if (pending) { const p = pending; pending = null; el.pend.hidden = true; stopListening(); gen++; stopSpeaking(); history.push({ role: 'user', content: '[I declined: ' + p.label + ']' }); say('No problem, I\'ll leave it.'); } };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) end(); });
})();
