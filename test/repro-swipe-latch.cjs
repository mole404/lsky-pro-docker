const {JSDOM}=require('jsdom');
const fs=require('fs');
function run(file, moves, label){
  const dom=new JSDOM('<!doctype html><body><ul id=g><li><img src="a.jpg" data-original="a.jpg"></li><li><img src="b.jpg" data-original="b.jpg"></li><li><img src="c.jpg" data-original="c.jpg"></li></ul></body>',{runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.ontouchstart=null;
  if(!w.PointerEvent){ w.PointerEvent=class extends w.MouseEvent{constructor(t,i={}){super(t,i);this.pointerId=i.pointerId||1;this.pointerType=i.pointerType||'touch';}}; }
  w.eval(fs.readFileSync(file,'utf8'));
  const v=new w.Viewer(w.document.getElementById('g'),{transition:false});
  v.show();
  // fake a loaded, fitted image
  v.viewed=true; v.viewing=false; v.showing=false;
  v.imageData={x:0,y:0,width:300,height:200}; v.viewerData={width:360,height:640};
  const idx0=v.index;
  const ev=(t,x,y)=>new w.PointerEvent(t,{bubbles:true,cancelable:true,pointerId:7,pointerType:'touch',clientX:x,clientY:y,view:w});
  const mk=(t,x,y)=>{const e=ev(t,x,y);Object.defineProperty(e,'pageX',{value:x});Object.defineProperty(e,'pageY',{value:y});return e;};
  const canvas=v.canvas;
  // ==== 阿罗娜的"松闩"补丁（从外面松开 Viewer 的 'switched' 闩锁）====
  let inV=false,lastA=null,swA=null;
  w.document.addEventListener('pointerdown',(e)=>{ inV=!!e.target.closest('.viewer-container'); lastA=null; },true);
  w.document.addEventListener('pointermove',()=>{
    if(!inV) return;
    const a=v.action;
    if(a==='switched'){ if(!swA&&lastA) swA=lastA; if(swA&&v.action!==swA) v.action=swA; }
    else if(a){ lastA=a; }
  },true);
  w.document.addEventListener('pointerup',()=>{ inV=false; },true);
  // ==== 补丁结束 ====
  canvas.dispatchEvent(mk('pointerdown',300,400));
  for(const [x,y] of moves) w.document.dispatchEvent(mk('pointermove',x,y));
  w.document.dispatchEvent(mk('pointerup',moves[moves.length-1][0],moves[moves.length-1][1]));
  console.log(label.padEnd(58),'index',idx0,'->',v.index, v.index!==idx0?'SWITCHED':'no switch');
}
const f=process.argv[2];
run(f,[[250,402],[200,405],[150,410]],'first move big & horizontal');
run(f,[[300,401],[250,402],[200,405],[150,410]],'first move dx=0,dy=1 (tiny, vertical noise)');
run(f,[[299,402],[250,402],[200,405],[150,410]],'first move dx=-1,dy=2');
run(f,[[298,403],[250,402],[200,405],[150,410]],'first move dx=-2,dy=3 (dy>dx)');
run(f,[[296,401],[250,402],[200,405],[150,410]],'first move dx=-4,dy=1 (ok)');
run(f,[[300,401],[300,402],[299,402],[250,402],[150,410]],'jitter 3 samples then swipe');
run(f,[[300,420],[300,450],[301,500]],'vertical drag (should NOT switch)');
run(f,[[299,405],[298,412],[250,415],[150,418]],'starts diagonal dy>dx, then horizontal');
run(f,[[330,401],[360,403],[400,405]],'swipe right (should go prev -> stays 0 at index 0 / no loop)');
