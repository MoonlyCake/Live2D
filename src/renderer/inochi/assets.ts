import {parseContainer,SubsetModel,decodeTGA,type InochiTexture} from '../../shared/inochi-runtime.mjs';

export async function readInochiAssets(url:string){
 const response=await fetch(url);
 if(!response.ok)throw Error('模型读取失败');
 const parsed=parseContainer(await response.arrayBuffer());
 const model=new SubsetModel(parsed.model,parsed.textures.length),textures:InochiTexture[]=[];
 for(const item of parsed.textures){
  let texture:InochiTexture;
  if(item.type===1)texture=decodeTGA(item.bytes);
  else{
   const image=await createImageBitmap(new Blob([item.bytes as BlobPart],{type:'image/png'}));
   try{
    if(image.width*image.height>16777216)throw Error('纹理过大');
    const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d')!;
    context.drawImage(image,0,0);
    texture={width:image.width,height:image.height,pixels:context.getImageData(0,0,image.width,image.height).data};
   }finally{image.close();}
  }
  for(let i=0;i<texture.pixels.length;i+=4)for(let channel=0;channel<3;channel++)texture.pixels[i+channel]=Math.round(texture.pixels[i+channel]*texture.pixels[i+3]/255);
  textures.push(texture);
 }
 return {model,textures};
}
