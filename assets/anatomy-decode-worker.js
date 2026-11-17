self.onmessage=async({data})=>{
 const {id,buffer,meshes}=data;
 try{
  const raw=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const decoded=[],transfer=[];
  for(const meta of meshes){
   const positions=new Float32Array(raw,meta.offset,meta.vertices*3).slice();
   const encoded=new Int16Array(raw,meta.normalOffset,meta.vertices*3),normals=new Float32Array(encoded.length);
   for(let i=0;i<encoded.length;i++)normals[i]=encoded[i]/32767;
   const indices=(meta.indexWidth===2?new Uint16Array(raw,meta.indexOffset,meta.indices):new Uint32Array(raw,meta.indexOffset,meta.indices)).slice();
   decoded.push({id:meta.id,group:meta.group,positions,normals,indices});
   transfer.push(positions.buffer,normals.buffer,indices.buffer);
  }
  self.postMessage({id,meshes:decoded},transfer);
 }catch(error){self.postMessage({id,error:error.message});}
};
