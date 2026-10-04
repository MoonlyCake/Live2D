import test from'node:test';import assert from'node:assert/strict';
import{homography,projectPoint,perspectiveGrid,type Quad}from'../src/shared/perspective';
import layout from'../assets/keyboard.layout.json';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test('shared perspective transform exactly maps all four ordered corners',()=>{
 for(const q of [[[10,20],[560,20],[560,190],[10,190]],[[860,670],[1600,825],[1520,1080],[630,850]]] as Quad[]){
  const h=homography(550,170,q);
  for(const [i,p]of[[0,0],[550,0],[550,170],[0,170]].entries())projectPoint(h,p[0],p[1]).forEach((v,j)=>close(v,q[i][j]));
 }
});

test('all83 key centers and four-pixel presses use the same projection as their keycaps',()=>{
 const h=homography(550,170,[[860,670],[1600,825],[1520,1080],[630,850]]);
 const targets=new Set<string>();
 for(const key of layout.keys){
  const unpressed=projectPoint(h,key.x-360,key.y-820),pressed=projectPoint(h,key.x-360,key.y-820+4);
  assert.ok(unpressed.every(Number.isFinite)&&pressed.every(Number.isFinite));
  targets.add(unpressed.join(','));assert.notDeepEqual(unpressed,pressed);
 }
 assert.equal(targets.size,83);
});

test('subdivided projected mesh stays within half a display pixel at600px scene width',()=>{
 const h=homography(550,170,[[860,670],[1600,825],[1520,1080],[630,850]]),cols=32,rows=16;
 const mesh=perspectiveGrid(h,550,170,[836,546.5],cols,rows);let maximum=0;
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  // Centroid of each of the two UV triangles in every cell.
  for(const local of [[1/3,1/3],[2/3,2/3]]){
   const triangle=local[0]<.5?[y*(cols+1)+x,y*(cols+1)+x+1,(y+1)*(cols+1)+x]:[y*(cols+1)+x+1,(y+1)*(cols+1)+x+1,(y+1)*(cols+1)+x];
   const actual=projectPoint(h,(x+local[0])/cols*550,(y+local[1])/rows*170);
   const approx=[0,1].map(k=>triangle.reduce((s,id)=>s+mesh.vertices[id*4+k],0)/3+[836,546.5][k]);
   maximum=Math.max(maximum,Math.hypot(actual[0]-approx[0],actual[1]-approx[1])*600/1672);
  }
 }
 assert.ok(maximum<.5,`projected texture error ${maximum}px`);
});

test('degenerate plane rejects rather than silently drawing or driving NaN',()=>{
 assert.throws(()=>homography(550,170,[[0,0],[1,0],[2,0],[3,0]]),/Degenerate/);
});
