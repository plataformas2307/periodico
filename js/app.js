/* Flipbook PDF. Bibliotecas externas: PDF.js 3.11.174 y StPageFlip 2.0.7 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const bookEl = $('book'), stage = $('stage'), status = $('status'), statusText = $('status-text');
  const controls = ['first','prev','next','last','zoom-out','zoom-in'];
  let flip = null, pdf = null, zoom = 1, pdfUrl = 'Periodico.pdf', objectUrl = null;
  let pageCount = 0, loadingToken = 0;
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
  }
  async function renderPdf(url, displayName) {
    const token = ++loadingToken;
    showStatus('Abriendo ' + displayName + '…'); setControls(false); clearBook();
    $('document-name').textContent = displayName;
    try {
      if (!window.pdfjsLib || !window.St || !window.St.PageFlip) {
        throw new Error('No se pudieron cargar las bibliotecas. Revisa tu conexión a internet.');
      }
      const task = pdfjsLib.getDocument({url});
      pdf = await task.promise;
      if (token !== loadingToken) return;
      pageCount = pdf.numPages;
      if (!pageCount) throw new Error('El archivo no contiene páginas.');
      $('total-pages').textContent = `/ ${pageCount}`;
      // Renderizar páginas a una resolución suficiente para lectura y zoom moderado.
      const first = await pdf.getPage(1);
      const vp = first.getViewport({scale:1});
      const ratio = vp.width / vp.height;
      const baseHeight = 850;
      const baseWidth = Math.round(baseHeight * ratio);
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
        page.cleanup();
      }
      if (token !== loadingToken) return;
      flip = new St.PageFlip(bookEl, {
        width:baseWidth, height:baseHeight, size:'stretch', minWidth:150, maxWidth:baseWidth,
        minHeight:210, maxHeight:baseHeight, maxShadowOpacity:.45,
        showCover:false, mobileScrollSupport:false, usePortrait:true,
        flippingTime:650, drawShadow:true, autoSize:true
      });
      flip.loadFromHTML(bookEl.querySelectorAll('.page'));
      flip.on('flip', updateCounter);
      flip.on('changeOrientation', () => setTimeout(updateCounter, 100));
      zoom = 1; applyZoom(); hideStatus(); setControls(true); updateCounter();
      $('download').href = url; $('download').download = displayName;
    } catch(err) {
      console.error(err); clearBook();
      const isDefault = url === 'Periodico.pdf';
      showStatus(isDefault
        ? 'No se pudo abrir Periodico.pdf. También puedes usar «Abrir PDF».'
        : 'No se pudo leer el PDF: ' + (err.message || 'archivo inválido'), true);
    }
  }
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
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await stage.requestFullscreen(); }
    catch(e) { console.warn('Pantalla completa no disponible', e); }
  });
  $('pdf-file').addEventListener('change', e => {
    const file = e.target.files?.[0]; if (!file) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file); pdfUrl = objectUrl;
    renderPdf(pdfUrl, file.name);
  });
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(document.activeElement.tagName) || !flip) return;
    if (e.key === 'ArrowRight') { flip.flipNext(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { flip.flipPrev(); e.preventDefault(); }
  });
  window.addEventListener('beforeunload', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
  renderPdf(pdfUrl, 'Periodico.pdf');
})();
