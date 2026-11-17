const services=new WeakMap();
export async function sharedResponse(service,key,work){
 if(!service)return work();
 let jobs=services.get(service);if(!jobs){jobs=new Map();services.set(service,jobs);}
 let job=jobs.get(key);
 if(!job){job=Promise.resolve().then(work);jobs.set(key,job);}
 try{return (await job).clone();}finally{if(jobs.get(key)===job)jobs.delete(key);}
}
