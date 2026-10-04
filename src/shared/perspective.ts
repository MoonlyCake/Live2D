/** Shared desk-plane mapping for key graphics and actual hand targets. */
export type Point2 = [number,number];
export type Quad = [Point2,Point2,Point2,Point2]; // top-left, top-right, bottom-right, bottom-left
export type Homography = [number,number,number,number,number,number,number,number,number];

export function homography(width:number,height:number,quad:Quad):Homography {
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!quad.flat().every(Number.isFinite))throw Error('Invalid desk plane');
 const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=quad;
 const dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2;
 const sx=x0-x1+x2-x3,sy=y0-y1+y2-y3;
 let g=0,h=0;
 if(Math.abs(sx)+Math.abs(sy)>1e-9){
  const determinant=dx1*dy2-dx2*dy1;
  if(Math.abs(determinant)<1e-9)throw Error('Degenerate desk plane');
  g=(sx*dy2-dx2*sy)/determinant;
  h=(dx1*sy-sx*dy1)/determinant;
 }
 const matrix:Homography=[(x1-x0+g*x1)/width,(x3-x0+h*x3)/height,x0,(y1-y0+g*y1)/width,(y3-y0+h*y3)/height,y0,g/width,h/height,1];
 if(Math.abs((x1-x0)*(y3-y0)-(y1-y0)*(x3-x0))<1e-9)throw Error('Degenerate desk plane');
 return matrix;
}

export function projectPoint(h:Homography,x:number,y:number):Point2 {
 const w=h[6]*x+h[7]*y+h[8];
 if(Math.abs(w)<1e-9)throw Error('Desk projection crosses infinity');
 return[(h[0]*x+h[1]*y+h[2])/w,(h[3]*x+h[4]*y+h[5])/w];
}

/** Subdivided real mesh approximates the perspective UV mapping on both supported backends. */
export function perspectiveGrid(h:Homography,width:number,height:number,origin:Point2,cols=32,rows=16){
 const vertices=new Float32Array((cols+1)*(rows+1)*4),indices=new Uint32Array(cols*rows*6);
 for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++){
  const u=x/cols,v=y/rows,p=projectPoint(h,u*width,v*height),i=(y*(cols+1)+x)*4;
  vertices.set([p[0]-origin[0],p[1]-origin[1],u,v],i);
 }
 let i=0;
 for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
  const a=y*(cols+1)+x,b=a+1,c=a+cols+1,d=c+1;
  indices.set([a,b,c,b,d,c],i);i+=6;
 }
 return{vertices,indices};
}
