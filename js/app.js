/* V4.2: visor reconstruido con PageFlip en modo imágenes (canvas).
   Un solo motor para giros táctiles y botones; PDF.js solo rasteriza páginas.
   No se entregan nodos PDF a PageFlip ni se usa flip.update() durante resize. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const stage=$('stage'),book=$('book'),reader=document.querySelector('.reader');
 const controlIds=['first','prev','next','last','zoom-in','zoom-out','mobile-prev','mobile-next'];
 const progressKey='periodico_last_page_v3', counterOffset=496;
 let pdf=null,flip=null,pages=[],count=0,ratio=.72,current=0,portrait=null,resizeTimer=null,resizeGeneration=0;
 let zoom=1,panX=0,panY=0,soundEnabled=true,audioContext=null,turning=false,loadGeneration=0,lastDimensions='';
 const status=$('status');
 const showStatus=(message,error=false)=>{status.hidden=false;status.classList.toggle('error',error);$('status-text').textContent=message;};
 const hideStatus=()=>{status.hidden=true;};
 const isMobile=()=>matchMedia('(max-width:650px)').matches;
 function setControls(yes){for(const id of controlIds)$(id).disabled=!yes;$('page-input').disabled=!yes;}
 function dimensions(){
   const w=Math.max(180,stage.clientWidth-18),h=Math.max(220,stage.clientHeight-18);
   const pageWidth=Math.max(120,Math.floor(Math.min(w/(isMobile()?1:2),h*ratio)));
   return {width:pageWidth,height:Math.floor(pageWidth/ratio)};
 }
 function updateUi(){
   if(!flip)return;
   current=Math.max(0,Math.min(count-1,flip.getCurrentPageIndex()));
   $('page-input').value=current+1;$('total-pages').textContent=`/ ${count}`;
   for(const id of ['first','prev','mobile-prev'])$(id).disabled=current===0;
   for(const id of ['last','next','mobile-next'])$(id).disabled=current>=count-1;
   document.querySelectorAll('.thumb').forEach(el=>el.classList.toggle('active',Number(el.dataset.index)===current));
   try{localStorage.setItem(progressKey,String(current));}catch(_){}
 }
 function applyZoom(){
   // El contenedor de PageFlip conserva su geometría; solo zoom voluntario.
   book.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;
   reader.classList.toggle('zoomed',zoom>1.01);
   $('zoom-value').textContent=`${Math.round(zoom*100)}%`;
 }
 function createFlip(index=0){
   if(!pages.length)return;
   if(flip){try{flip.destroy();}catch(e){console.warn('Destroy',e);}flip=null;}
   book.replaceChildren();book.style.width='';book.style.height='';
   const dim=dimensions();portrait=isMobile();lastDimensions=`${dim.width}x${dim.height}:${portrait}`;
   flip=new St.PageFlip(book,{
     width:dim.width,height:dim.height,size:'fixed',autoSize:false,
     showCover:!portrait,usePortrait:portrait,
     flippingTime:850,drawShadow:true,maxShadowOpacity:.55,
     mobileScrollSupport:false,swipeDistance:20
   });
   // El renderer de imágenes es independiente del DOM y utiliza ambas caras.
   flip.loadFromImages(pages);
   flip.on('flip',e=>{const previous=current;current=e.data;turning=false;if(previous!==current)playSound();updateUi();});
   flip.on('changeOrientation',()=>updateUi());
   flip.turnToPage(Math.min(count-1,Math.max(0,index)));
   current=Math.min(count-1,Math.max(0,index));
   updateUi();applyZoom();
 }
 function scheduleResize(){
   clearTimeout(resizeTimer);
   const ticket=++resizeGeneration;
   resizeTimer=setTimeout(()=>{
     if(ticket!==resizeGeneration||!flip||!pages.length)return;
     const dim=dimensions();const signature=`${dim.width}x${dim.height}:${isMobile()}`;
     if(signature===lastDimensions)return;
     const index=flip.getCurrentPageIndex();
     // Reconstrucción controlada desde URLs inmutables. No hay canvases DOM que perder.
     turning=false;createFlip(index);
   },300);
 }
 window.addEventListener('resize',scheduleResize);
 window.addEventListener('orientationchange',scheduleResize);
 document.addEventListener('fullscreenchange',()=>{
   const active=document.fullscreenElement===reader;
   $('fullscreen').textContent=active?'⛶ Salir de pantalla completa':'⛶ Ver en pantalla completa';
   $('fullscreen-toolbar').innerHTML=active?'⛶ <span>Salir de pantalla completa</span>':'⛶ <span>Ampliar vista</span>';
   scheduleResize();
 });
 function navigate(direction){
   if(!flip||turning)return;
   if(direction<0&&flip.getCurrentPageIndex()===0)return;
   if(direction>0&&flip.getCurrentPageIndex()>=count-1)return;
   turning=true;
   // El motor PageFlip decide la geometría, exactamente igual que al arrastrar.
   if(direction>0)flip.flipNext('bottom');else flip.flipPrev('bottom');
   setTimeout(()=>{turning=false;},950);
 }
 for(const id of ['prev','mobile-prev'])$(id).addEventListener('click',()=>navigate(-1));
 for(const id of ['next','mobile-next'])$(id).addEventListener('click',()=>navigate(1));
 $('first').addEventListener('click',()=>flip?.turnToPage(0));
 $('last').addEventListener('click',()=>flip?.turnToPage(count-1));
 $('page-input').addEventListener('change',e=>{if(flip)flip.turnToPage(Math.max(0,Math.min(count-1,(Number(e.target.value)||1)-1)));});
 $('zoom-in').addEventListener('click',()=>{zoom=Math.min(3,+(zoom+.2).toFixed(2));applyZoom();});
 $('zoom-out').addEventListener('click',()=>{zoom=Math.max(1,+(zoom-.2).toFixed(2));if(zoom===1){panX=0;panY=0;}applyZoom();});
 async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await reader.requestFullscreen();}catch(e){console.warn(e);}}
 $('fullscreen').addEventListener('click',fullscreen);$('fullscreen-toolbar').addEventListener('click',fullscreen);
 function playSound(){
   if(!soundEnabled)return;
   try{
     const Ctx=window.AudioContext||window.webkitAudioContext;if(!Ctx)return;
     audioContext ||=new Ctx();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
     const duration=.22,rate=audioContext.sampleRate,buffer=audioContext.createBuffer(1,Math.floor(rate*duration),rate),data=buffer.getChannelData(0);
     for(let i=0;i<data.length;i++){const t=i/rate;data[i]=(Math.random()*2-1)*.2*Math.sin(Math.PI*t/duration);}
     const source=audioContext.createBufferSource(),gain=audioContext.createGain();gain.gain.value=.18;source.buffer=buffer;source.connect(gain);gain.connect(audioContext.destination);source.start();source.stop(audioContext.currentTime+duration);
   }catch(e){console.warn(e);}
 }
 $('sound-toggle').addEventListener('click',()=>{soundEnabled=!soundEnabled;$('sound-toggle').setAttribute('aria-pressed',String(soundEnabled));$('sound-toggle').title=soundEnabled?'Desactivar sonido':'Activar sonido';});
 document.addEventListener('keydown',e=>{if(!flip||['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;if(e.key==='ArrowRight'){navigate(1);e.preventDefault();}if(e.key==='ArrowLeft'){navigate(-1);e.preventDefault();}});
 const thumbs=$('thumbnails-panel');
 function closeThumbs(){thumbs.hidden=true;$('thumbnails-toggle').setAttribute('aria-expanded','false');}
 $('thumbnails-toggle').addEventListener('click',()=>{thumbs.hidden=!thumbs.hidden;$('thumbnails-toggle').setAttribute('aria-expanded',String(!thumbs.hidden));});
 $('thumbnails-close').addEventListener('click',closeThumbs);
 function buildThumbs(){const grid=$('thumbnails-grid');grid.replaceChildren();pages.forEach((url,i)=>{const b=document.createElement('button');b.className='thumb';b.type='button';b.dataset.index=i;const img=new Image();img.src=url;img.alt=`Página ${i+1}`;img.loading='lazy';const label=document.createElement('span');label.textContent=`Página ${i+1}`;b.append(img,label);b.addEventListener('click',()=>{flip?.turnToPage(i);closeThumbs();});grid.append(b);});updateUi();}
 // Pellizcar para ampliar y arrastrar la página ampliada.
 const touches=new Map();let pinch=null,drag=null;
 stage.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===2){const [a,b]=[...touches.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};drag=null;}else if(zoom>1.01){drag={x:e.clientX,y:e.clientY,panX,panY};stage.setPointerCapture(e.pointerId);}});
 stage.addEventListener('pointermove',e=>{if(!touches.has(e.pointerId))return;touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(touches.size===2&&pinch){const [a,b]=[...touches.values()];zoom=Math.max(1,Math.min(3,pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance)));if(zoom===1){panX=0;panY=0;}applyZoom();}else if(touches.size===1&&drag&&zoom>1){const maxX=stage.clientWidth*(zoom-1)/2,maxY=stage.clientHeight*(zoom-1)/2;panX=Math.max(-maxX,Math.min(maxX,drag.panX+e.clientX-drag.x));panY=Math.max(-maxY,Math.min(maxY,drag.panY+e.clientY-drag.y));applyZoom();}});
 function endTouch(e){touches.delete(e.pointerId);if(touches.size<2)pinch=null;drag=null;}
 stage.addEventListener('pointerup',endTouch);stage.addEventListener('pointercancel',endTouch);
 stage.addEventListener('dblclick',()=>{zoom=zoom>1?1:2;panX=panY=0;applyZoom();});
 async function loadCounter(){
   const endpoint=window.PERIODICO_COUNTER_ENDPOINT;if(!endpoint||!/^https:\/\//.test(endpoint))return;
   try{let visitorId;try{visitorId=localStorage.getItem('periodico_visitor_id_v1');if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem('periodico_visitor_id_v1',visitorId);}}catch(_){visitorId=crypto.randomUUID();}
     const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({visitorId}),cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
     const result=await response.json();if(!Number.isSafeInteger(result.count)||result.count<1)throw Error('Contador inválido');
     $('visitor-number').textContent=new Intl.NumberFormat('es-MX').format(Math.max(500,result.count+counterOffset));$('visitor-counter').hidden=false;
   }catch(e){console.warn('Contador:',e);}
 }
 async function loadPdf(){
   const ticket=++loadGeneration;showStatus('Cargando periódico…');setControls(false);
   try{
     if(!window.pdfjsLib||!window.St?.PageFlip)throw Error('No se cargaron PDF.js y PageFlip. Comprueba tu conexión.');
     pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
     const response=await fetch('Periodico.pdf');if(!response.ok)throw Error('No se encontró Periodico.pdf (HTTP '+response.status+')');
     const data=new Uint8Array(await response.arrayBuffer());if(new TextDecoder().decode(data.subarray(0,5))!=='%PDF-')throw Error('El archivo recibido no es un PDF válido');
     pdf=await pdfjsLib.getDocument({data}).promise;count=pdf.numPages;
     const first=await pdf.getPage(1),view=first.getViewport({scale:1});ratio=view.width/view.height;
     pages=new Array(count);
     // Todas las caras se preparan antes de activar el giro. El PDF tiene 12 páginas;
     // evita reversos blancos por carreras de renderizado o cambios de tamaño.
     for(let i=0;i<count;i++){
       if(ticket!==loadGeneration)return;
       showStatus(`Preparando páginas… ${i+1} de ${count}`);
       const page=await pdf.getPage(i+1),v=page.getViewport({scale:Math.min(2,1300/Math.max(page.view[2]-page.view[0],page.view[3]-page.view[1]))});
       const canvas=document.createElement('canvas');canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);
       const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
       await page.render({canvasContext:ctx,viewport:v}).promise;
       pages[i]=canvas.toDataURL('image/jpeg',.88);canvas.width=canvas.height=0;page.cleanup();
     }
     // Decodificar imágenes antes de entregarlas al motor: ningún giro tendrá una cara pendiente.
     await Promise.all(pages.map(url=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(Error('No se pudo preparar una página'));image.src=url;})));
     let saved=0;try{saved=Math.max(0,Math.min(count-1,Number(localStorage.getItem(progressKey))||0));}catch(_){}
     createFlip(saved);buildThumbs();$('download').href='Periodico.pdf';hideStatus();setControls(true);updateUi();
   }catch(e){console.error(e);showStatus('No se pudo abrir el periódico: '+e.message,true);}
 }
 loadCounter();loadPdf();
})();
