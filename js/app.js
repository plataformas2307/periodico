/* V4.5: actualización de dimensiones sin reconstruir PageFlip. Bibliotecas externas: PDF.js 3.11.174 y StPageFlip 2.0.7 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const bookEl = $('book'), stage = $('stage'), status = $('status'), statusText = $('status-text');
  const controls = ['first','prev','next','last','zoom-out','zoom-in','mobile-prev','mobile-next'];
  let flip = null, pdf = null, zoom = 1, pdfUrl = 'Periodico.pdf';
  let soundEnabled = true, audioContext = null, lastPageIndex = -1;
  let pageCount = 0, loadingToken = 0;
  let masterCanvases = [];
  let pageElements = [], displayCanvases = [], renderJobs = new Map(), rendered = new Set(), renderGeneration = 0;
  let panX=0, panY=0, pinchStart=null;
  const progressKey = 'periodico_last_page_v3';
  let pageRatio = .72, resizeTimer = null, lastFitKey = "";
  let fullscreenTransitionUntil = 0, fullscreenScale = 1, bookPageWidth = 0, bookPageHeight = 0;
  let responsiveScale = 1, coverShift = 0, lastPortrait = null, pageTurnPending = false;
  // Base pública de 500: 4 visitas ya registradas equivalen a 500.
  // MySQL conserva su conteo real y la deduplicación existente.
  const VISITOR_DISPLAY_OFFSET = 496;
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
    $('mobile-prev').disabled = current <= 1; $('mobile-next').disabled = current >= pageCount;
    try { localStorage.setItem(progressKey, String(current-1)); } catch (_) {}
    markActiveThumb(current-1); ensureNearPages(current-1); updateCoverAlignment();
  }
  function clearBook() {
    pageTurnPending=false;
    if (flip) { try { flip.destroy(); } catch(e) { console.warn(e); } flip = null; }
    bookEl.innerHTML = '';
    masterCanvases = []; pageElements = []; displayCanvases = []; rendered.clear(); renderJobs.clear(); renderGeneration++;
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
      // Crear la estructura completa sin rasterizar el PDF entero.
      // PDF.js dibuja primero las páginas visibles y luego las próximas.
      const first = await pdf.getPage(1);
      const vp = first.getViewport({scale:1});
      pageRatio = vp.width / vp.height;
      masterCanvases = []; pageElements = []; displayCanvases = []; rendered.clear();
      bookEl.replaceChildren();
      for (let n=1; n<=pageCount; n++) {
        // El lienzo maestro vive fuera del DOM y no puede ser destruido por PageFlip.
        const canvas=document.createElement('canvas'); canvas.width=2; canvas.height=2;
        masterCanvases.push(canvas);
      }
      if (token !== loadingToken) return;
      let saved=0;
      try { saved=Math.max(0,Math.min(pageCount-1,Number(localStorage.getItem(progressKey))||0)); } catch (_) {}
      initFlip(saved);
      zoom=1;panX=0;panY=0;applyZoom();
      // Las primeras páginas se pintan antes de ocultar el indicador de carga.
      await Promise.all([renderOnePage(saved),renderOnePage(Math.min(saved+1,pageCount-1))]);
      if (token !== loadingToken) return;
      hideStatus(); setControls(true); updateCounter();
      buildThumbs(); ensureNearPages(saved);
      // En segundo plano, cargar todas las caras para evitar hojas blancas.
      (async()=>{for(let i=0;i<pageCount && token===loadingToken;i++) await renderOnePage(i);})().catch(console.warn);
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
  // Los lienzos maestros nunca se entregan a PageFlip: la librería puede
  // desmontar y destruir su DOM al cambiar la orientación o el tamaño.
  function paintDisplay(index) {
    if (!rendered.has(index)) return;
    const target=displayCanvases[index], source=masterCanvases[index];
    if (!target || !source || !target.isConnected) return;
    if (target.width!==source.width || target.height!==source.height) {
      target.width=source.width; target.height=source.height;
    }
    target.getContext('2d',{alpha:false}).drawImage(source,0,0);
    // Mantener una imagen real en la hoja incluso cuando el motor voltea su reverso.
    const page = pageElements[index];
    if (page) {
      const url = source.toDataURL('image/jpeg', .90);
      page.style.backgroundImage = `url(\"${url}\")`;
      page.style.backgroundSize = '100% 100%';
      page.style.backgroundColor = '#fff';
      const content = page.querySelector('.page-content');
      if (content) { content.style.backgroundImage = `url(\"${url}\")`; content.style.backgroundSize = '100% 100%'; }
    }
  }
  function initFlip(pageIndex = 0) {
    if (!pageCount || !masterCanvases.length) return;
    if (flip) {
      try { flip.destroy(); } catch(e) { console.warn('Reinicio del visor:', e); }
      flip = null;
    }
    bookEl.replaceChildren();
    const fragment=document.createDocumentFragment();
    pageElements=[]; displayCanvases=[];
    masterCanvases.forEach((source,index) => {
      const wrapper=document.createElement('div');wrapper.className='page';
      const content=document.createElement('div');content.className='page-content';
      const display=document.createElement('canvas');display.width=2;display.height=2;
      content.appendChild(display);
      wrapper.appendChild(content);fragment.appendChild(wrapper);
      pageElements.push(wrapper);displayCanvases.push(display);
    });
    bookEl.appendChild(fragment);
    const dims = fitDimensions();
    bookPageWidth = dims.width; bookPageHeight = dims.height;
    lastFitKey=`${dims.width}x${dims.height}:${singlePageMode()}`;
    lastPortrait=singlePageMode();
    flip = new St.PageFlip(bookEl, {
      width:dims.width, height:dims.height, size:'fixed',
      maxShadowOpacity:.55, showCover:!singlePageMode(), mobileScrollSupport:false,
      usePortrait:singlePageMode(), flippingTime:850, drawShadow:true, autoSize:false
    });
    flip.loadFromHTML(bookEl.querySelectorAll('.page'));
    // Pintar DESPUÉS de que PageFlip termine de envolver las páginas.
    rendered.forEach(paintDisplay);
    flip.on('flip', () => { const idx = flip.getCurrentPageIndex(); if (lastPageIndex >= 0 && idx !== lastPageIndex) playPageSound(); lastPageIndex = idx; updateCounter(); requestAnimationFrame(updateResponsiveScale); });
    flip.on('changeOrientation', () => setTimeout(updateCounter,100));
    if (pageIndex > 0) flip.turnToPage(Math.min(pageIndex,pageCount-1));
    lastPageIndex = Math.min(pageIndex,pageCount-1);
    updateCounter();
    updateResponsiveScale();
  }
  // V4.5: no destruir el motor durante cambios de tamaño.
  // PageFlip.update recalcula la geometría conservando sus páginas y canvases.
  let resizingBook = false;
  function refitBook() {
    if (!flip || !pageCount || resizingBook || pageTurnPending) {
      if (pageTurnPending) scheduleRefit(500);
      return;
    }
    const dims=fitDimensions();
    const portrait=singlePageMode();
    const key=`${dims.width}x${dims.height}:${portrait}`;
    if (key===lastFitKey) return;
    resizingBook=true;
    try {
      if (portrait !== lastPortrait) {
        // El modo portada cambia únicamente al cruzar el breakpoint.
        // En este caso es necesario regenerar hojas HTML una sola vez.
        const current=flip.getCurrentPageIndex();
        initFlip(current);
      } else {
        flip.update({width:dims.width,height:dims.height,size:'fixed',
          showCover:!portrait,usePortrait:portrait,autoSize:false});
        bookPageWidth=dims.width;
        bookPageHeight=dims.height;
        lastFitKey=key;
        updateCoverAlignment();
      }
    } catch(error) {
      console.error('Error al adaptar el visor:',error);
      showStatus('No se pudo ajustar la vista. Actualiza la página.',true);
    } finally {resizingBook=false;}
  }
  function updateResponsiveScale() {
    // La geometría se calcula dentro de PageFlip, no mediante un CSS scale
    // externo que puede desplazar las hojas fuera del contenedor.
    responsiveScale=1;
    updateCoverAlignment();
  }
  function updateCoverAlignment() {
    if (!flip || !pageCount) return;
    const current=flip.getCurrentPageIndex();
    coverShift=(!singlePageMode() && (current===0 || current===pageCount-1))
      ? (current===0 ? -bookPageWidth/2 : bookPageWidth/2) : 0;
    applyZoom();
  }
  function scheduleRefit(delay=360) {
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>requestAnimationFrame(refitBook),delay);
  }
  window.addEventListener('resize',()=>scheduleRefit());
  window.addEventListener('orientationchange',()=>scheduleRefit(550));
  if(window.ResizeObserver) {
    const stageObserver=new ResizeObserver(()=>scheduleRefit(420));
    stageObserver.observe(stage);
  }
  function updateFullscreenScale() {
    if (!document.fullscreenElement || !bookPageWidth || !bookPageHeight) {
      fullscreenScale = 1;
    } else {
      const spreadWidth = bookPageWidth * (singlePageMode() ? 1 : 2);
      fullscreenScale = Math.max(1, Math.min(1.8,
        (stage.clientWidth - 28) / spreadWidth,
        (stage.clientHeight - 28) / bookPageHeight));
    }
    updateResponsiveScale();
  }
  document.addEventListener('fullscreenchange', () => {
    // El bug anterior ocurría porque resize/ResizeObserver destruían
    // y reconstruían PageFlip mientras el navegador cambiaba el layout.
    fullscreenTransitionUntil = Date.now() + 850;
    clearTimeout(resizeTimer);
    const active = document.fullscreenElement === reader;
    $('fullscreen').textContent = active ? '⛶ Salir de pantalla completa' : '⛶ Ver en pantalla completa';
    $('fullscreen-toolbar').innerHTML = active ? '⛶ <span>Salir de pantalla completa</span>' : '⛶ <span>Ampliar vista</span>';
    requestAnimationFrame(() => requestAnimationFrame(() => scheduleRefit(300)));
    setTimeout(() => scheduleRefit(450), 200);
  });
  function applyZoom() { bookEl.style.transform = `translate(${panX+coverShift*responsiveScale}px, ${panY}px) scale(${zoom * responsiveScale})`; reader.classList.toggle('zoomed',zoom>1.01); $('zoom-value').textContent = Math.round(zoom*100)+'%'; }
  // V3.7: un único giro nativo para flechas y gestos, precargando
  // las dos caras necesarias ANTES de iniciar la animación.
  async function turnOnePage(direction) {
    if (!flip || pageTurnPending) return;
    const current=flip.getCurrentPageIndex();
    const target=current+(singlePageMode()?direction:direction*2);
    if (target<0 || target>=pageCount) return;
    pageTurnPending=true;
    const thisFlip=flip;
    try {
      await Promise.all([current-1,current,current+1,target-1,target,target+1]
        .filter(i=>i>=0 && i<pageCount).map(renderOnePage));
      if (flip!==thisFlip) return;
      if (direction>0) flip.flipNext('bottom');
      else flip.flipPrev('bottom');
      await new Promise(resolve=>setTimeout(resolve,880));
    } finally { pageTurnPending=false; scheduleRefit(80); }
  }
  $('first').addEventListener('click', () => flip?.turnToPage(0));
  $('prev').addEventListener('click', () => turnOnePage(-1));
  $('next').addEventListener('click', () => turnOnePage(1));
  $('mobile-prev').addEventListener('click', () => turnOnePage(-1));
  $('mobile-next').addEventListener('click', () => turnOnePage(1));
  $('last').addEventListener('click', () => flip?.turnToPage(pageCount-1));
  $('page-input').addEventListener('change', e => {
    if (!flip) return;
    const n = Math.max(1, Math.min(pageCount, Number(e.target.value)||1));
    flip.turnToPage(n-1); updateCounter();
  });
  $('zoom-in').addEventListener('click', () => { zoom = Math.min(3, +(zoom+.2).toFixed(2)); applyZoom(); });
  $('zoom-out').addEventListener('click', () => { zoom = Math.max(1, +(zoom-.2).toFixed(2)); if(zoom===1){panX=0;panY=0;} applyZoom(); });
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
    if (e.key === 'ArrowRight') { turnOnePage(1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { turnOnePage(-1); e.preventDefault(); }
  });
  // Render progresivo: un canvas por página, con cola de trabajos y caché limitada.
  async function renderOnePage(index) {
    if (!pdf || index<0 || index>=pageCount || rendered.has(index)) return;
    if (renderJobs.has(index)) return renderJobs.get(index);
    const currentPdf=pdf, generation=renderGeneration;
    const job=(async()=>{
      const page=await currentPdf.getPage(index+1);
      if(generation!==renderGeneration) return;
      const v=page.getViewport({scale:Math.min(2.25,1500/Math.max(page.view[2]-page.view[0],page.view[3]-page.view[1]))});
      const canvas=masterCanvases[index];
      canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);
      await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport:v}).promise;
      if(generation===renderGeneration){rendered.add(index);paintDisplay(index);page.cleanup();}
    })().catch(e=>console.warn('Página '+(index+1),e)).finally(()=>renderJobs.delete(index));
    renderJobs.set(index,job);return job;
  }
  function ensureNearPages(index) {
    if(!pdf || !pageCount)return;
    const indices=[index,index+1,index-1,index+2,index-2,index+3];
    indices.forEach(i=>{if(i>=0&&i<pageCount)renderOnePage(i);});
  }
  function buildThumbs(){
    const grid=$('thumbnails-grid');grid.replaceChildren();
    for(let i=0;i<pageCount;i++){
      const b=document.createElement('button');b.type='button';b.className='thumb';b.dataset.index=i;
      const ph=document.createElement('span');ph.className='thumb-placeholder';ph.textContent='…';
      const label=document.createElement('span');label.textContent='Página '+(i+1);
      b.append(ph,label);b.addEventListener('click',()=>{flip?.turnToPage(i);ensureNearPages(i);closeThumbs();});grid.append(b);
    }
    markActiveThumb(flip?.getCurrentPageIndex()||0);
  }
  function markActiveThumb(i){document.querySelectorAll('.thumb').forEach(el=>el.classList.toggle('active',Number(el.dataset.index)===i));}
  async function loadThumb(index){
    const btn=$('thumbnails-grid').querySelector(`[data-index="${index}"]`);
    if(!btn || btn.querySelector('canvas') || !pdf)return;
    const page=await pdf.getPage(index+1), vp=page.getViewport({scale:1});
    const small=page.getViewport({scale:115/vp.height});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(small.width);canvas.height=Math.ceil(small.height);
    await page.render({canvasContext:canvas.getContext('2d'),viewport:small}).promise;
    const placeholder=btn.querySelector('.thumb-placeholder');if(placeholder)placeholder.replaceWith(canvas);
  }
  function closeThumbs(){$('thumbnails-panel').hidden=true;$('thumbnails-toggle').setAttribute('aria-expanded','false');}
  $('thumbnails-toggle').addEventListener('click',()=>{
    const open=$('thumbnails-panel').hidden;
    $('thumbnails-panel').hidden=!open;$('thumbnails-toggle').setAttribute('aria-expanded',String(open));
    if(open){const i=flip?.getCurrentPageIndex()||0;for(let j=Math.max(0,i-3);j<Math.min(pageCount,i+6);j++)loadThumb(j).catch(()=>{}); if(window.IntersectionObserver){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){loadThumb(Number(entry.target.dataset.index)).catch(()=>{});observer.unobserve(entry.target);}}),{root:$('thumbnails-grid'),rootMargin:'120px'});$('thumbnails-grid').querySelectorAll('.thumb').forEach(el=>observer.observe(el));}else{for(let j=0;j<pageCount;j++)setTimeout(()=>loadThumb(j).catch(()=>{}),j*80);}}
  });
  $('thumbnails-close').addEventListener('click',closeThumbs);
  // Pellizcar con dos dedos; arrastrar el documento ampliado con uno.
  const activeTouches=new Map();let dragPoint=null;
  stage.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;
    activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(activeTouches.size===2){const a=[...activeTouches.values()];pinchStart={distance:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),zoom};dragPoint=null;}
    else if(zoom>1.01){dragPoint={x:e.clientX,y:e.clientY,panX,panY};stage.setPointerCapture(e.pointerId);}
  });
  stage.addEventListener('pointermove',e=>{
    if(!activeTouches.has(e.pointerId))return;
    activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(activeTouches.size===2&&pinchStart){
      const a=[...activeTouches.values()];zoom=Math.max(1,Math.min(3,pinchStart.zoom*Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)/Math.max(1,pinchStart.distance)));
      if(zoom===1){panX=0;panY=0;}applyZoom();
    }else if(activeTouches.size===1&&dragPoint&&zoom>1){
      const boundX=stage.clientWidth*(zoom-1)/2,boundY=stage.clientHeight*(zoom-1)/2;
      panX=Math.max(-boundX,Math.min(boundX,dragPoint.panX+e.clientX-dragPoint.x));
      panY=Math.max(-boundY,Math.min(boundY,dragPoint.panY+e.clientY-dragPoint.y));applyZoom();
    }
  });
  function endPointer(e){activeTouches.delete(e.pointerId);if(activeTouches.size<2)pinchStart=null;dragPoint=null;}
  stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);
  stage.addEventListener('dblclick',()=>{zoom=zoom>1?1:2;panX=0;panY=0;applyZoom();});
  // El contador usa PHP + MySQL en un servidor HTTPS externo a GitHub Pages.
  // Configura la URL de contador.php en counter-config.js.
  async function loadVisitorCount() {
    const endpoint = window.PERIODICO_COUNTER_ENDPOINT;
    if (!endpoint || !/^https:\/\//.test(endpoint)) return;
    try {
      const storageKey = 'periodico_visitor_id_v1';
      let visitorId;
      try {
        visitorId = localStorage.getItem(storageKey);
        if (!visitorId) {
          visitorId = crypto.randomUUID();
          localStorage.setItem(storageKey, visitorId);
        }
      } catch (_) { visitorId = crypto.randomUUID(); }
      const response = await fetch(endpoint, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({visitorId}), cache:'no-store'
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const result = await response.json();
      if (!Number.isSafeInteger(result.count) || result.count < 1) throw new Error('Respuesta inválida');
      $('visitor-number').textContent = new Intl.NumberFormat('es-MX').format(Math.max(500, result.count + VISITOR_DISPLAY_OFFSET));
      $('visitor-counter').hidden = false;
    } catch (error) { console.warn('No se pudo consultar el contador:', error); }
  }
  loadVisitorCount();
  renderPdf(pdfUrl, 'Periodico.pdf');
})();
