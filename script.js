/* script.js
   Core behaviors:
   - Start button enables audio context and reveals scene
   - WebAudio analyser used for a simple visualizer (or fallback oscillator)
   - Lollipop "hold to blow" logic: hold to inflate, release to pop -> creates hearts and increases mood
   - Heart particle system (simple DOM-based)
   - Mood value mapped to accent color and meter; when full, purple burst
   - Polaroid note export to PNG (uses an ephemeral canvas)
*/

(() => {
  // DOM refs
  const startOverlay = document.getElementById('startOverlay');
  const startBtn = document.getElementById('startBtn');
  const scene = document.getElementById('scene');
  const playPause = document.getElementById('playPause');
  const volume = document.getElementById('volume');
  const track = document.getElementById('track');
  const visualizer = document.getElementById('visualizer');
  const ctxVis = visualizer.getContext('2d');
  const heartLayer = document.getElementById('heartLayer');
  const lollipop = document.getElementById('lollipop');
  const bubbleEl = document.getElementById('bubble');
  const meterBar = document.getElementById('meterBar');
  const pillow = document.getElementById('pillow');
  const polaroidModal = document.getElementById('polaroidModal');
  const closeModal = document.getElementById('closeModal');
  const downloadPolaroid = document.getElementById('downloadPolaroid');
  const noteText = document.getElementById('noteText');

  // state
  let audioCtx = null, analyser = null, sourceNode = null, gainNode = null;
  let analyserData = null;
  let usingFile = false;
  let isPlaying = false;
  let animationId = null;

  // mood 0..100
  let mood = 18;
  const MOOD_MAX = 100;

  // particle list
  const particles = [];

  // bubble hold state
  let holdStart = 0;
  let holdInterval = null;
  let bubbleScale = 1;
  let isHolding = false;

  // helpers: linear color interpolation
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function hexToRgb(hex) {
    const h = hex.replace('#','');
    return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)];
  }
  function rgbToCss(rgb) { return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`; }
  function mixHex(hexA, hexB, t) {
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    return rgbToCss([Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))]);
  }

  // theme colors for mood mapping
  const colorBlue = '#BFE7FF';
  const colorRed = '#FF6B8A';
  const colorPurple = '#D8B9FF';

  function updateTheme() {
    // map mood 0..100 to a color: 0..50 blue->red, 50..100 red->purple
    let cssColor;
    if (mood <= 50) {
      cssColor = mixHex(colorBlue, colorRed, mood / 50);
    } else {
      cssColor = mixHex(colorRed, colorPurple, (mood - 50) / 50);
    }
    document.documentElement.style.setProperty('--accent', cssColor);
    // also update background blend subtly
    const bgBlend = mixHex(colorBlue, colorPurple, mood / 100);
    document.body.style.background = `linear-gradient(180deg, ${mixHex(colorBlue,colorPurple,mood/120)} , ${mixHex(colorRed, colorPurple, mood/120)})`;
    // update meter width
    meterBar.style.width = `${(mood / MOOD_MAX) * 100}%`;
  }

  // simple DOM particle: heart
  function spawnHeart(xRatio = 0.5, yRatio = 0.6, size = 14, color) {
    const heart = document.createElement('div');
    heart.className = 'heart-particle';
    heart.style.position = 'absolute';
    heart.style.left = `${xRatio * 100}%`;
    heart.style.top = `${yRatio * 100}%`;
    heart.style.width = `${size}px`;
    heart.style.height = `${size}px`;
    heart.style.pointerEvents = 'none';
    heart.style.transform = 'translate(-50%,-50%) rotate(15deg)';
    heart.style.opacity = '1';
    heart.style.transition = 'transform 1.6s cubic-bezier(.2,.8,.2,1), opacity 1.6s linear';
    heart.style.background = color || 'linear-gradient(45deg,#ff9ecb,#ff61a6)';
    heart.style.borderRadius = '10px';
    heart.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';
    // heart shaped via pseudo? Use clip-path for a heart-like shape
    heart.style.clipPath = 'path("M50 15 C 35 -5, 0 0, 0 37 C 0 60, 50 85, 50 85 C 50 85, 100 60, 100 37 C 100 0, 65 -5, 50 15 Z")';
    heartLayer.appendChild(heart);
    // animate upward
    requestAnimationFrame(() => {
      heart.style.transform = `translate(-50%,-220%) rotate(${Math.random()*60-30}deg) scale(${1 + Math.random()*0.4})`;
      heart.style.opacity = '0';
    });
    setTimeout(()=>heart.remove(), 1800);
  }

  // create multiple hearts
  function heartBurst(count=10) {
    for (let i=0;i<count;i++) {
      spawnHeart(0.2 + Math.random()*0.6, 0.5 + Math.random()*0.2, 12 + Math.random()*16);
    }
  }

  // bubble logic
  function startHold() {
    if (isHolding) return;
    isHolding = true;
    holdStart = performance.now();
    bubbleScale = 1;
    bubbleEl.style.transition = 'transform 60ms linear';
    holdInterval = setInterval(() => {
      bubbleScale = Math.min(2.6, bubbleScale + 0.06);
      bubbleEl.style.transform = `scale(${bubbleScale})`;
      // gentle wobble
      bubbleEl.style.filter = `saturate(${0.9 + (bubbleScale-1)*0.3}) blur(${Math.min(2,(bubbleScale-1)*2)}px)`;
    }, 60);
  }
  function releaseHold() {
    if (!isHolding) return;
    isHolding = false;
    clearInterval(holdInterval);
    // pop effect
    const heldFor = (performance.now() - holdStart) / 1000;
    bubbleEl.style.transform = 'scale(1)';
    bubbleEl.style.filter = 'none';
    // bigger burst if held longer
    const burst = Math.min(60, Math.round(8 + heldFor*32));
    heartBurst(burst);
    // increase mood
    mood = Math.min(MOOD_MAX, mood + Math.round(6 + heldFor*10));
    updateTheme();
    // small purple bloom if mood high
    if (mood >= MOOD_MAX) {
      heartBurst(120);
      // gentle reset after a moment
      setTimeout(()=>{ mood = 40; updateTheme(); }, 4500);
    }
  }

  // pointer handling for cursor light
  function onPointerMove(ev) {
    const r = ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : {left:0, top:0, width:window.innerWidth, height:window.innerHeight};
    const x = (ev.clientX - r.left) / r.width * 100;
    const y = (ev.clientY - r.top) / r.height * 100;
    // set CSS vars on bedroom container
    document.querySelector('.bedroom').style.setProperty('--light-x', `${x}%`);
    document.querySelector('.bedroom').style.setProperty('--light-y', `${y}%`);
  }

  // Visualizer draw
  function drawVisualizer() {
    if (!analyser) {
      // clear
      ctxVis.clearRect(0,0,visualizer.width, visualizer.height);
      return;
    }
    analyser.getByteFrequencyData(analyserData);
    const w = visualizer.width, h = visualizer.height;
    ctxVis.clearRect(0,0,w,h);
    const barCount = 30;
    const barWidth = w / barCount;
    for (let i=0;i<barCount;i++) {
      const idx = Math.floor(i / barCount * analyserData.length);
      const v = analyserData[idx] / 255;
      const bh = v * h * 0.9 + 2;
      const x = i * barWidth;
      ctxVis.fillStyle = 'rgba(255,255,255,0.9)';
      const radius = 8;
      // rounded rect/trick
      ctxVis.fillRect(x + 2, h - bh - 6, barWidth - 4, bh);
    }
    animationId = requestAnimationFrame(drawVisualizer);
  }

  // Setup audio / analyser
  async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserData = new Uint8Array(analyser.frequencyBinCount);

    gainNode = audioCtx.createGain();
    gainNode.gain.value = parseFloat(volume.value);

    // try to load <audio> file if it has a src that exists
    try {
      if (track && track.src) {
        await track.play().catch(()=>{/* Will start later */});
        sourceNode = audioCtx.createMediaElementSource(track);
        sourceNode.connect(gainNode).connect(analyser).connect(audioCtx.destination);
        usingFile = true;
      }
    } catch (e) {
      // fallback
      usingFile = false;
    }

    if (!usingFile) {
      // fallback: gentle oscillator + noise for ambience
      const o = audioCtx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 220;
      const lfo = audioCtx.createOscillator();
      lfo.frequency.value = 0.25;
      const lfoGain = audioCtx.createGain();
      lfoGain.gain.value = 20;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);
      o.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(audioCtx.destination);
      o.start();
      lfo.start();
      sourceNode = o;
    }
    drawVisualizer();
  }

  // play/pause toggles
  function togglePlay() {
    if (!audioCtx) initAudio();
    if (usingFile) {
      if (track.paused) {
        track.play(); isPlaying = true; playPause.textContent = '⏸';
        // reveal scene if hidden
        scene.setAttribute('aria-hidden','false');
      } else {
        track.pause(); isPlaying = false; playPause.textContent = '▶';
      }
    } else {
      // if oscillator is used, there's nothing to pause except reducing gain
      isPlaying = !isPlaying;
      gainNode.gain.value = isPlaying ? parseFloat(volume.value) : 0;
      playPause.textContent = isPlaying ? '⏸' : '▶';
    }
  }

  // polaroid download
  function downloadPolaroidImage() {
    const text = noteText.value || 'For you';
    const w = 800, h = 900;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d');
    // polaroid style
    cx.fillStyle = '#fff'; cx.fillRect(0,0,w,h);
    cx.fillStyle = '#f8f0f4'; cx.fillRect(40,40,w-80,h-220);
    // photo area (placeholder gradient)
    const grad = cx.createLinearGradient(40,40,w-40,h-220);
    grad.addColorStop(0,mixHex(colorBlue,colorPurple, mood/100));
    grad.addColorStop(1,mixHex(colorRed,colorPurple, mood/100));
    cx.fillStyle = grad; cx.fillRect(40,40,w-80,h-420);
    // handwriting text
    cx.font = '30px Pacifico, serif';
    cx.fillStyle = '#2e2e2e';
    wrapText(cx, text, 80, h-140, w-160, 34);
    // footer small
    cx.font = '16px Comfortaa, sans-serif';
    cx.fillStyle = '#7b7b7b';
    cx.fillText('— made with a daydream', 80, h-90);
    // create download
    const url = c.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'daydream-polaroid.png';
    a.click();
  }
  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line, x, y);
        line = words[n] + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, y);
  }

  // event bindings
  startBtn.addEventListener('click', async () => {
    // reveal scene and init audio
    startOverlay.style.display = 'none';
    scene.style.visibility = 'visible';
    scene.setAttribute('aria-hidden','false');
    await initAudio();
    togglePlay();
  });

  playPause.addEventListener('click', togglePlay);

  volume.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (gainNode) gainNode.gain.value = v;
    if (track) track.volume = v;
  });

  // pointer tracking for thumb light
  document.querySelector('.bedroom').addEventListener('pointermove', onPointerMove);
  // support pointerdown/up for bubble hold
  const startHoldHandler = (e) => { e.preventDefault(); startHold(); };
  const endHoldHandler = (e) => { e.preventDefault(); releaseHold(); };
  // add pointer events to lollipop and keyboard activation
  lollipop.addEventListener('pointerdown', startHoldHandler);
  window.addEventListener('pointerup', endHoldHandler);
  lollipop.addEventListener('keydown', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { startHold(); }});
  lollipop.addEventListener('keyup', (ev) => { if (ev.key === ' ' || ev.key === 'Enter') { releaseHold(); }});

  // touch fallback ensures pointer events handled
  lollipop.addEventListener('touchstart', startHoldHandler);
  window.addEventListener('touchend', endHoldHandler);

  // pillow open modal
  pillow.addEventListener('click', () => {
    polaroidModal.classList.remove('hidden');
    polaroidModal.setAttribute('aria-hidden','false');
  });
  closeModal.addEventListener('click', () => {
    polaroidModal.classList.add('hidden');
    polaroidModal.setAttribute('aria-hidden','true');
  });
  downloadPolaroid.addEventListener('click', downloadPolaroidImage);

  // initialize theme and small heart drift every few seconds
  updateTheme();
  setInterval(()=> {
    // subtle heart drift to keep scene lively
    spawnHeart(0.2 + Math.random()*0.6, 0.7 + Math.random()*0.15, 12 + Math.random()*10);
  }, 1400);

  // ensure visualizer canvas resizes
  function fitVisualizer() {
    visualizer.width = visualizer.clientWidth * devicePixelRatio;
    visualizer.height = visualizer.clientHeight * devicePixelRatio;
  }
  window.addEventListener('resize', fitVisualizer);
  fitVisualizer();

  // accessibility: keyboard controls
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  });

  // expose a small debug function in console if needed
  window.__daydream = {
    addMood: (n) => { mood = Math.min(MOOD_MAX, mood + n); updateTheme(); },
    spawnHeart,
  };

})();
