function filteredList(encoded,hidden,largest,docStride){
 const bytes=atob(encoded||''),spans=[];let offset=0,spanStart=0,absolute=0,lastKept=0,skipping=false,changed=false,kept=0;
 while(offset<bytes.length){
  const start=offset;let delta=0,multiplier=1,byte;
  do{byte=bytes.charCodeAt(offset++);delta+=(byte&127)*multiplier;multiplier*=128;}while(byte&128);
  absolute+=delta;const docId=Math.floor(absolute/docStride);
  if(hidden.has(docId)){if(!skipping)spans.push(bytes.slice(spanStart,start));skipping=true;changed=true;spanStart=offset;continue;}
  kept++;
  if(skipping){let adjusted=absolute-lastKept,binary='';while(adjusted>=128){binary+=String.fromCharCode((adjusted&127)|128);adjusted=Math.floor(adjusted/128);}binary+=String.fromCharCode(adjusted);spans.push(binary);spanStart=offset;skipping=false;}
  lastKept=absolute;
  if(docId>largest)break;
 }
 if(!changed)return encoded;
 if(!kept&&spanStart===bytes.length)return null;
 spans.push(bytes.slice(spanStart));return btoa(spans.join(''));
}
export function filterPublicPostings(postings,hiddenDocIds,docStride=524288){
 const hidden=hiddenDocIds instanceof Set?hiddenDocIds:new Set(hiddenDocIds||[]);if(!hidden.size)return {...postings};
 const largest=Math.max(...hidden),result={};for(const [term,encoded]of Object.entries(postings||{})){const value=filteredList(encoded,hidden,largest,docStride);if(value)result[term]=value;}return result;
}
