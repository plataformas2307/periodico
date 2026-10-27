/* Flipbook PDF. Bibliotecas externas: PDF.js 3.11.174 y StPageFlip 2.0.7 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const bookEl = $('book'), stage = $('stage'), status = $('status'), statusText = $('status-text');
  const controls = ['first','prev','next','last','zoom-out','zoom-in'];
  let flip = null, pdf = null, zoom = 1, pdfUrl = 'Periodico.pdf';
  let soundEnabled = true, audioContext = null, lastPageIndex = -1;
  let pageCount = 0, loadingToken = 0;
  let masterCanvases = [];
  let pageRatio = .72, resizeTimer = null;
  const reader = document.querySelector('.reader');
  const worker = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = worker;
  function showStatus(message, error = false) {
    status.hidden = false; status.classList.toggle('error', error); statusText.textContent = message;
  }
  function hideStatus() { status.hidden = true; }
  function setControls(enabled) { controls.forEach(id => $(id).disabled = !enabled); $('page-input').disabled = !enabled; }
  function updateCounter() {
    if (!flip) return;
    const current = flip.getCurrentPageIndex() + 1;
    $('page-input').value = Math.min(current, pageCount);
    $('total-pages').textContent = `/ ${pageCount}`;
    $('first').disabled = current <= 1; $('prev').disabled = current <= 1;
    $('next').disabled = current >= pageCount; $('last').disabled = current >= pageCount;
  }
  function clearBook() {
    if (flip) { try { flip.destroy(); } catch(e) { console.warn(e); } flip = null; }
    bookEl.innerHTML = '';
    masterCanvases = [];
  }
  async function renderPdf(url, displayName) {
    const token = ++loadingToken;
    showStatus('Abriendo ' + displayName + '…'); setControls(false); clearBook();
    $('document-name').textContent = displayName;
    try {
      if (!window.pdfjsLib || !window.St || !window.St.PageFlip) {
        throw new Error('No se pudieron cargar las bibliotecas. Revisa tu conexión a internet.');
      }
      // Diagnóstico explícito: GitHub Pages puede devolver HTML 404 o un puntero Git LFS.
      let source = url;
      if (!url.startsWith('blob:')) {
        const response = await fetch(url, {cache:'no-store'});
        if (!response.ok) throw new Error(`HTTP ${response.status}: no se encontró el PDF en ${new URL(url, location.href).pathname}. Revisa mayúsculas, ruta y publicación de GitHub Pages.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 180)));
        if (header.startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('GitHub está sirviendo un puntero Git LFS, no el PDF real. Sube el PDF directamente al repositorio sin LFS.');
        if (!header.startsWith('%PDF-')) throw new Error(`El servidor no entregó un PDF válido (${response.headers.get('content-type') || 'tipo desconocido'}). Comprueba que el archivo no sea una página HTML o un enlace de Git LFS.`);
        source = {data:bytes};
      }
      const task = pdfjsLib.getDocument(source);
      pdf = await task.promise;
      if (token !== loadingToken) return;
      pageCount = pdf.numPages;
      if (!pageCount) throw new Error('El archivo no contiene páginas.');
      $('total-pages').textContent = `/ ${pageCount}`;
      // Renderizar páginas a una resolución suficiente para lectura y zoom moderado.
      masterCanvases = [];
      const first = await pdf.getPage(1);
      const vp = first.getViewport({scale:1});
      const ratio = vp.width / vp.height;
      pageRatio = ratio;
      // La proporción original del PDF se conserva en cada página.
      for (let n=1; n<=pageCount; n++) {
        if (token !== loadingToken) return;
        showStatus(`Preparando páginas… ${n} de ${pageCount}`);
        const page = n === 1 ? first : await pdf.getPage(n);
        const viewport = page.getViewport({scale:1});
        const targetScale = Math.min(2, 1200 / Math.max(viewport.width, viewport.height));
        const renderViewport = page.getViewport({scale:targetScale});
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(renderViewport.width); canvas.height = Math.ceil(renderViewport.height);
        const context = canvas.getContext('2d', {alpha:false});
        await page.render({canvasContext:context, viewport:renderViewport}).promise;
        const wrapper = document.createElement('div'); wrapper.className = 'page';
        const content = document.createElement('div'); content.className = 'page-content';
        content.appendChild(canvas); wrapper.appendChild(content); bookEl.appendChild(wrapper);
        masterCanvases.push(canvas);
        page.cleanup();
      }
      if (token !== loadingToken) return;
      initFlip(0);
      zoom = 1; applyZoom(); hideStatus(); setControls(true); updateCounter();
      $('download').href = url; $('download').download = displayName;
    } catch(err) {
      console.error(err); clearBook();
      showStatus('No se pudo abrir ' + displayName + ': ' + (err.message || 'Error desconocido'), true);
    }
  }
  // Dimensiones calculadas para que se vean las páginas completas, sin cortes.
  function fitDimensions() {
    const w = Math.max(240, stage.clientWidth - 18);
    const h = Math.max(260, stage.clientHeight - 18);
    const single = window.matchMedia('(max-width: 650px)').matches; // Sólo móvil: una página; escritorio: doble página
    const pageWidth = Math.floor(Math.min(w / (single ? 1 : 2), h * pageRatio));
    return { width: Math.max(120,pageWidth), height: Math.max(170,Math.floor(pageWidth/pageRatio)) };
  }
  function singlePageMode() { return window.matchMedia('(max-width: 650px)').matches; }
  // Recrear el libro desde canvases maestros que NUNCA pertenecen al DOM de PageFlip.
  // Esto evita que destroy() borre o invalide las páginas al salir de pantalla completa.
  function initFlip(pageIndex = 0) {
    if (!pageCount || !masterCanvases.length) return;
    if (flip) {
      try { flip.destroy(); } catch(e) { console.warn('Reinicio del visor:', e); }
      flip = null;
    }
    bookEl.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const original of masterCanvases) {
      const canvas = document.createElement('canvas');
      canvas.width = original.width; canvas.height = original.height;
      canvas.getContext('2d', {alpha:false}).drawImage(original, 0, 0);
      const wrapper = document.createElement('div'); wrapper.className = 'page';
      const content = document.createElement('div'); content.className = 'page-content';
      content.appendChild(canvas); wrapper.appendChild(content); fragment.appendChild(wrapper);
    }
    bookEl.appendChild(fragment);
    const dims = fitDimensions();
    flip = new St.PageFlip(bookEl, {
      width:dims.width, height:dims.height, size:'fixed',
      maxShadowOpacity:.35, showCover:false, mobileScrollSupport:false,
      usePortrait:singlePageMode(), flippingTime:600, drawShadow:true, autoSize:false
    });
    flip.loadFromHTML(bookEl.querySelectorAll('.page'));
    flip.on('flip', () => { const idx = flip.getCurrentPageIndex(); if (lastPageIndex >= 0 && idx !== lastPageIndex) playPageSound(); lastPageIndex = idx; updateCounter(); });
    flip.on('changeOrientation', () => setTimeout(updateCounter,100));
    if (pageIndex > 0) flip.turnToPage(Math.min(pageIndex,pageCount-1));
    lastPageIndex = Math.min(pageIndex,pageCount-1);
    updateCounter();
  }
  function refitBook() {
    if (!flip || !pageCount || !masterCanvases.length) return;
    const current = flip.getCurrentPageIndex();
    initFlip(current);
    applyZoom();
  }
  function scheduleRefit(delay=160) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(refitBook)), delay);
  }
  window.addEventListener('resize', () => scheduleRefit());
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => scheduleRefit(100));
    ro.observe(stage);
  }
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === reader;
    $('fullscreen').textContent = active ? '⛶ Salir de pantalla completa' : '⛶ Ver en pantalla completa';
    $('fullscreen-toolbar').innerHTML = active ? '⛶ <span>Salir de pantalla completa</span>' : '⛶ <span>Ampliar vista</span>';
    scheduleRefit(220);
  });
  function applyZoom() { bookEl.style.transform = `scale(${zoom})`; $('zoom-value').textContent = Math.round(zoom*100)+'%'; }
  $('first').addEventListener('click', () => flip?.turnToPage(0));
  $('prev').addEventListener('click', () => flip?.flipPrev());
  $('next').addEventListener('click', () => flip?.flipNext());
  $('last').addEventListener('click', () => flip?.turnToPage(pageCount-1));
  $('page-input').addEventListener('change', e => {
    if (!flip) return;
    const n = Math.max(1, Math.min(pageCount, Number(e.target.value)||1));
    flip.turnToPage(n-1); updateCounter();
  });
  $('zoom-in').addEventListener('click', () => { zoom = Math.min(1.6, +(zoom+.1).toFixed(2)); applyZoom(); });
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(.7, +(zoom-.1).toFixed(2)); applyZoom(); });
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await reader.requestFullscreen();
    } catch(e) { console.warn('Pantalla completa no disponible', e); }
  }
  $('fullscreen').addEventListener('click', toggleFullscreen);
  $('fullscreen-toolbar').addEventListener('click', toggleFullscreen);
  // Sonido original sintetizado con Web Audio: no requiere MP3 ni archivos externos.
  // Se reproduce sólo después de una interacción del usuario y al cambiar de página.
  function playPageSound() {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext ||= new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume().catch(()=>{});
      const duration = .24, sampleRate = audioContext.sampleRate;
      const buffer = audioContext.createBuffer(1, Math.floor(duration * sampleRate), sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let i=0; i<data.length; i++) {
        const t=i/sampleRate, envelope=Math.pow(Math.sin(Math.PI*t/duration),1.4);
        const noise=(Math.random()*2-1);
        previous = previous*.72 + noise*.28;
        data[i] = (noise*.42+previous*.58)*envelope;
      }
      const source=audioContext.createBufferSource(); source.buffer=buffer;
      const filter=audioContext.createBiquadFilter(); filter.type='bandpass'; filter.frequency.value=950; filter.Q.value=.65;
      const gain=audioContext.createGain(); gain.gain.value=.20;
      source.connect(filter); filter.connect(gain); gain.connect(audioContext.destination);
      source.start(); source.stop(audioContext.currentTime+duration);
    } catch (e) { console.warn('Audio no disponible:',e); }
  }
  $('sound-toggle').addEventListener('click', () => {
    soundEnabled=!soundEnabled;
    $('sound-toggle').textContent=soundEnabled?'♪':'♪̸';
    $('sound-toggle').setAttribute('aria-pressed',String(soundEnabled));
    $('sound-toggle').setAttribute('aria-label',soundEnabled?'Desactivar sonido de páginas':'Activar sonido de páginas');
    $('sound-toggle').title=soundEnabled?'Desactivar sonido de páginas':'Activar sonido de páginas';
  });
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName) || !flip) return;
    if (e.key === 'ArrowRight') { flip.flipNext(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { flip.flipPrev(); e.preventDefault(); }
  });
  renderPdf(pdfUrl, 'Periodico.pdf');
})();
